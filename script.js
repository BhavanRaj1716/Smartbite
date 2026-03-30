import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
  query, where, doc, updateDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─── Firebase Config ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDxHZJ1BX4alB8LLbT9kskyqm-jKVFipUo",
  authDomain:        "smart-canteen-e44e9.firebaseapp.com",
  projectId:         "smart-canteen-e44e9",
  storageBucket:     "smart-canteen-e44e9.firebasestorage.app",
  messagingSenderId: "509602872969",
  appId:             "1:509602872969:web:c30a4eb11a448b9084d058",
  measurementId:     "G-35J29T7499"
};

const UPI_ID   = "b1869452@oksbi";
const UPI_NAME = "Bhavan+Raj";

const app      = initializeApp(firebaseConfig);
const db       = getFirestore(app);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── State ─────────────────────────────────────────────────────────
let cart                  = [];
let ordersListenerStarted = false;
let ordersUnsubscribe     = null;
let upiPaymentConfirmed   = false;

// Track previous order statuses to detect changes for notifications
// Map of orderId → last known status
const prevStatuses = new Map();

// ══════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════

function showToast(msg, duration = 3500) {
  const t = document.getElementById("toast");
  t.innerText     = msg;
  t.style.display = "block";
  t.style.opacity = "1";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => { t.style.display = "none"; }, 400);
  }, duration);
}

function showAuthError(msg, color = "") {
  const el = document.getElementById("authError");
  el.innerText     = msg;
  el.style.display = "block";
  el.style.color   = color || "";
}
function clearAuthError() {
  const el = document.getElementById("authError");
  el.innerText = ""; el.style.display = "none"; el.style.color = "";
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled  = loading;
  btn.innerText = loading ? "Please wait..." : label;
}

function friendlyError(code) {
  const map = {
    "auth/invalid-credential":      "Incorrect email or password. Please try again.",
    "auth/user-not-found":          "No account found. Please sign up first.",
    "auth/wrong-password":          "Incorrect password. Please try again.",
    "auth/email-already-in-use":    "Email already registered. Please login.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/invalid-email":           "Invalid email address.",
    "auth/too-many-requests":       "Too many attempts. Wait a few minutes and retry.",
    "auth/network-request-failed":  "Network error. Check your connection.",
    "auth/user-disabled":           "This account has been disabled.",
    "auth/operation-not-allowed":   "Sign-in method not enabled in Firebase Console.",
    "auth/popup-closed-by-user":    "Google sign-in was cancelled.",
    "auth/popup-blocked":           "Popup blocked. Please allow popups for this site.",
    "auth/cancelled-popup-request": "Only one popup at a time. Please try again.",
  };
  return map[code] || `Something went wrong (${code || "unknown"}). Please try again.`;
}

// ══════════════════════════════════════════════════════════════════
//  CUSTOMER BROWSER NOTIFICATIONS
//  Fires when admin changes order status to "Preparing" (payment
//  confirmed) or "Ready" (food is ready to collect).
// ══════════════════════════════════════════════════════════════════

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function fireCustomerNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: "https://cdn-icons-png.flaticon.com/512/3075/3075977.png",
      badge: "https://cdn-icons-png.flaticon.com/512/3075/3075977.png",
    });
  }
}

// Called every time the orders snapshot updates.
// Compares current status against last known status and fires notification
// only when something genuinely changed.
function checkStatusChanges(orders) {
  orders.forEach((data) => {
    const prev = prevStatuses.get(data._id);

    // Only fire if we already had a previous state (skip on first render)
    if (prev !== undefined && prev !== data.status) {

      if (data.status === "Preparing" && prev === "Pending Payment") {
        // Admin confirmed UPI payment → kitchen started
        fireCustomerNotification(
          "✅ Payment Confirmed — Token #" + data.token,
          "Your payment was verified! Your order is now being prepared. 🍳"
        );
        showToast("✅ Payment confirmed! Your order is being prepared.", 6000);
      }

      if (data.status === "Ready") {
        // Admin marked order ready
        fireCustomerNotification(
          "🍽 Order Ready — Token #" + data.token,
          "Your order is ready! Please come and collect it. 🎉"
        );
        showToast("🍽 Your order Token #" + data.token + " is READY! Come collect it.", 8000);
      }

      if (data.status === "Delivered") {
        fireCustomerNotification(
          "✓ Order Delivered — Token #" + data.token,
          "Your order has been marked as delivered. Enjoy your meal! 😊"
        );
      }
    }

    // Update tracked status
    prevStatuses.set(data._id, data.status);
  });
}

// ══════════════════════════════════════════════════════════════════
//  TOKEN COUNTER — Firestore, resets daily
// ══════════════════════════════════════════════════════════════════

const TOKEN_DOC = doc(db, "meta", "tokenCounter");

async function getNextToken() {
  const today = new Date().toISOString().slice(0, 10);
  return await runTransaction(db, async (tx) => {
    const snap    = await tx.get(TOKEN_DOC);
    const data    = snap.exists() ? snap.data() : {};
    const current = (data.date === today) ? (data.current || 0) : 0;
    const next    = current + 1;
    tx.set(TOKEN_DOC, { current: next, date: today });
    return next;
  });
}

// ══════════════════════════════════════════════════════════════════
//  SCREEN CONTROL
// ══════════════════════════════════════════════════════════════════

function showScreen(id) {
  ["splashScreen", "authScreen", "mainApp"].forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    el.style.display = s === id
      ? (s === "authScreen" ? "flex" : "block")
      : "none";
  });
}

let splashDone   = false;
let authResolved = false;
let resolvedUser = null;
let firstFire    = true;

function tryTransition() {
  if (!splashDone || !authResolved) return;
  if (resolvedUser) { initApp(resolvedUser); showScreen("mainApp"); }
  else              { showScreen("authScreen"); }
}

setTimeout(() => { splashDone = true; tryTransition(); }, 2000);

onAuthStateChanged(auth, (user) => {
  if (firstFire) {
    firstFire    = false;
    resolvedUser = user;
    authResolved = true;
    tryTransition();
  } else {
    if (user) {
      initApp(user); showScreen("mainApp");
    } else {
      cart = [];
      updateCartUI();
      if (ordersUnsubscribe) { ordersUnsubscribe(); ordersUnsubscribe = null; }
      ordersListenerStarted = false;
      prevStatuses.clear();
      showScreen("authScreen");
    }
  }
});

function initApp(user) {
  const nameEl  = document.getElementById("navUserName");
  const emailEl = document.getElementById("navUserEmail");
  if (nameEl)  nameEl.innerText  = user.displayName || "Customer";
  if (emailEl) emailEl.innerText = user.email || "";
  requestNotificationPermission();
  startOrdersListener(user);
}

// ══════════════════════════════════════════════════════════════════
//  AUTH LISTENERS
// ══════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {

  getRedirectResult(auth).then((result) => {
    if (result && result.user) console.log("Google redirect sign-in:", result.user.email);
  }).catch((err) => { console.error("Redirect result error:", err.code); });

  // Google Sign-In
  document.getElementById("googleBtn").addEventListener("click", async () => {
    clearAuthError();
    setLoading("googleBtn", true, "Continue with Google");
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === "auth/popup-blocked" || err.code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, provider);
      } else {
        showAuthError(friendlyError(err.code));
        setLoading("googleBtn", false, "Continue with Google");
      }
    }
  });

  // Email Login
  document.getElementById("loginBtn").addEventListener("click", async () => {
    clearAuthError();
    const email    = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!email || !password) { showAuthError("Please enter both email and password."); return; }
    setLoading("loginBtn", true, "Login →");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showAuthError(friendlyError(err.code));
      setLoading("loginBtn", false, "Login →");
    }
  });

  // Email Signup
  document.getElementById("signupBtn").addEventListener("click", async () => {
    clearAuthError();
    const name     = document.getElementById("signupName").value.trim();
    const email    = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    if (!name || !email || !password) { showAuthError("Please fill in all fields."); return; }
    if (password.length < 6)          { showAuthError("Password must be at least 6 characters."); return; }
    if (!/\S+@\S+\.\S+/.test(email))  { showAuthError("Please enter a valid email address."); return; }
    setLoading("signupBtn", true, "Create Account →");
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: name });
      await sendEmailVerification(user);
      showToast("✅ Account created! Check your email to verify.", 7000);
      window.switchTab("login");
    } catch (err) {
      showAuthError(friendlyError(err.code));
    }
    setLoading("signupBtn", false, "Create Account →");
  });

  // Forgot Password
  const forgotLink = document.getElementById("forgotPassword");
  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();
      clearAuthError();
      const email = document.getElementById("loginEmail").value.trim();
      if (!email)                      { showAuthError("Type your email above first, then click Forgot Password."); return; }
      if (!/\S+@\S+\.\S+/.test(email)) { showAuthError("Please enter a valid email address."); return; }
      try {
        await sendPasswordResetEmail(auth, email);
        showAuthError("✅ Reset email sent to " + email + ". Check inbox & spam.", "#00e676");
      } catch (err) {
        showAuthError(err.code === "auth/user-not-found"
          ? "No account found with that email. Please sign up."
          : friendlyError(err.code));
      }
    });
  }
});

// Logout
window.logout = async function () {
  if (ordersUnsubscribe) { ordersUnsubscribe(); ordersUnsubscribe = null; }
  await signOut(auth);
};

// ══════════════════════════════════════════════════════════════════
//  CART
// ══════════════════════════════════════════════════════════════════

window.addToCart = function (name, price) {
  const item = cart.find(i => i.name === name);
  if (item) item.qty++;
  else       cart.push({ name, price, qty: 1 });
  updateCartUI();
  handlePaymentChange();
  showToast("🛒 " + name + " added!");
};

window.changeQty = function (index, change) {
  cart[index].qty += change;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  updateCartUI();
  handlePaymentChange();
};

function updateCartUI() {
  const cartList = document.getElementById("cartList");
  const totalEl  = document.getElementById("totalPrice");
  const emptyMsg = document.getElementById("emptyCartMsg");
  cartList.innerHTML = "";
  let total = 0;
  cart.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "cartItem";
    li.innerHTML = `
      <span class="cartItemName">${item.name}</span>
      <span class="cartItemPrice">₹${item.price}</span>
      <div class="cartQty">
        <button onclick="changeQty(${index}, -1)">−</button>
        <span>${item.qty}</span>
        <button onclick="changeQty(${index},  1)">+</button>
      </div>`;
    cartList.appendChild(li);
    total += item.price * item.qty;
  });
  totalEl.innerText      = "₹" + total;
  emptyMsg.style.display = cart.length === 0 ? "block" : "none";
}

// ══════════════════════════════════════════════════════════════════
//  UPI PAYMENT FLOW
//
//  NEW FLOW for UPI:
//  User pays → clicks "I Have Paid" → checkout unlocks →
//  Order saved as "Pending Payment" →
//  Admin confirms payment in dashboard → status → "Preparing" →
//  Customer gets browser notification.
//
//  Cash: order goes directly to "Preparing" as before.
// ══════════════════════════════════════════════════════════════════

window.handlePaymentChange = function () {
  const payment     = document.getElementById("paymentMethod").value;
  const upiSection  = document.getElementById("upiSection");
  const checkoutBtn = document.getElementById("checkoutBtn");

  if (upiSection) upiSection.style.display = "none";

  upiPaymentConfirmed       = false;
  checkoutBtn.innerText     = "Checkout →";
  checkoutBtn.disabled      = false;
  checkoutBtn.style.opacity = "1";

  if (payment === "UPI") {
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    if (total === 0) { showToast("⚠ Add items to cart first!"); return; }

    const upiLink  = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&am=${total}&cu=INR`;
    const qrUrl    = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    document.getElementById("upiAmount").innerText = total;
    document.getElementById("upiIdText").innerText = UPI_ID;

    const upiQR    = document.getElementById("upiQR");
    const payBtn   = document.getElementById("upiPayBtn");
    const upiLabel = document.getElementById("upiLabel");
    const upiNote  = document.getElementById("upiNote");

    if (isMobile) {
      upiQR.style.display  = "none";
      payBtn.href          = upiLink;
      payBtn.style.display = "block";
      upiLabel.innerText   = "Tap to Pay";
      upiNote.innerText    = "① Tap below → ② Pay ₹" + total + " in UPI app → ③ Click I Have Paid";
    } else {
      upiQR.src            = qrUrl;
      upiQR.style.display  = "block";
      payBtn.style.display = "none";
      upiLabel.innerText   = "Scan & Pay";
      upiNote.innerText    = "① Scan QR → ② Pay ₹" + total + " → ③ Click I Have Paid";
    }

    upiSection.style.display  = "block";
    checkoutBtn.innerText     = "Complete Payment First ↑";
    checkoutBtn.disabled      = true;
    checkoutBtn.style.opacity = "0.45";
  }
};

window.confirmUpiPayment = function () {
  upiPaymentConfirmed = true;
  const confirmBtn  = document.getElementById("upiConfirmBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");
  if (confirmBtn) {
    confirmBtn.innerText         = "✅ Payment Done";
    confirmBtn.disabled          = true;
    confirmBtn.style.background  = "#22c55e";
    confirmBtn.style.borderColor = "#22c55e";
    confirmBtn.style.color       = "#fff";
  }
  // ← for UPI the button now says "Place Order →"
  // Order will be saved as "Pending Payment" — admin must confirm
  checkoutBtn.innerText     = "Place Order →";
  checkoutBtn.disabled      = false;
  checkoutBtn.style.opacity = "1";
  showToast("✅ Payment done! Click Place Order — admin will verify & start your order.", 5000);
};

// ══════════════════════════════════════════════════════════════════
//  CHECKOUT
// ══════════════════════════════════════════════════════════════════

window.checkout = async function () {
  if (cart.length === 0) { showToast("⚠ Add at least one item first!"); return; }

  const payment = document.getElementById("paymentMethod").value;
  if (!payment)  { showToast("⚠ Please select a payment method!"); return; }

  if (payment === "UPI" && !upiPaymentConfirmed) {
    showToast("⚠ Please pay via UPI and click 'I Have Paid' first!");
    return;
  }

  const user = auth.currentUser;
  if (!user) { showToast("⚠ Session expired. Please login again."); return; }

  const btn = document.getElementById("checkoutBtn");
  btn.disabled  = true;
  btn.innerText = "Placing order...";

  try {
    const token = await getNextToken();
    const total  = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

    // ── KEY CHANGE ─────────────────────────────────────────────────
    // UPI orders start as "Pending Payment" — admin must verify payment
    // before kitchen starts. Cash goes directly to "Preparing".
    const initialStatus = payment === "UPI" ? "Pending Payment" : "Preparing";

    await addDoc(collection(db, "orders"), {
      uid:              user.uid,
      name:             user.displayName || "Customer",
      email:            user.email       || "",
      phone:            user.phoneNumber || "",
      items:            JSON.parse(JSON.stringify(cart)),
      total,
      token,
      status:           initialStatus,
      payment,
      paymentConfirmed: payment === "Cash",   // only pre-confirmed for Cash
      time:             new Date(),
    });

    if (payment === "UPI") {
      showToast("⏳ Order placed! Waiting for admin to confirm your UPI payment. Token #" + token, 7000);
    } else {
      showToast("✅ Order placed! Token #" + token, 5000);
    }

    // Reset
    cart                = [];
    upiPaymentConfirmed = false;
    updateCartUI();
    document.getElementById("paymentMethod").value = "";

    const upiSection = document.getElementById("upiSection");
    if (upiSection) upiSection.style.display = "none";

    const confirmBtn = document.getElementById("upiConfirmBtn");
    if (confirmBtn) {
      confirmBtn.innerText         = "✔ I Have Paid";
      confirmBtn.disabled          = false;
      confirmBtn.style.background  = "transparent";
      confirmBtn.style.borderColor = "#22c55e";
      confirmBtn.style.color       = "#22c55e";
    }

  } catch (err) {
    console.error("Checkout error:", err);
    showToast("❌ Failed to place order. Check your connection.");
  }

  btn.disabled      = false;
  btn.innerText     = "Checkout →";
  btn.style.opacity = "1";
};

// ══════════════════════════════════════════════════════════════════
//  ORDER CANCELLATION — within 60 seconds, Preparing or Pending Payment
// ══════════════════════════════════════════════════════════════════

window.cancelOrder = async function (orderId, btnEl) {
  if (!confirm("Cancel this order?")) return;
  btnEl.disabled  = true;
  btnEl.innerText = "Cancelling...";
  try {
    await updateDoc(doc(db, "orders", orderId), { status: "Cancelled" });
    showToast("🚫 Order cancelled.");
  } catch (err) {
    showToast("❌ Could not cancel. Try again.");
    btnEl.disabled  = false;
    btnEl.innerText = "Cancel";
  }
};

// ══════════════════════════════════════════════════════════════════
//  LIVE ORDERS LISTENER
// ══════════════════════════════════════════════════════════════════

function startOrdersListener(user) {
  if (ordersListenerStarted) return;
  ordersListenerStarted = true;

  const ordersList = document.getElementById("ordersList");
  const q = query(collection(db, "orders"), where("uid", "==", user.uid));

  ordersUnsubscribe = onSnapshot(q, (snapshot) => {
    renderUserOrders(snapshot, user);
  }, (err) => {
    console.warn("Falling back to client filter:", err.message);
    ordersUnsubscribe = onSnapshot(collection(db, "orders"), (snapshot) => {
      renderUserOrders(snapshot, user);
    });
  });

  function renderUserOrders(snapshot, user) {
    const userOrders = [];
    snapshot.forEach((docItem) => {
      const data = docItem.data();
      data._id = docItem.id;
      if (data.uid === user.uid || (user.email && data.email === user.email)) {
        userOrders.push(data);
      }
    });

    userOrders.sort((a, b) => {
      const tA = a.time?.toMillis ? a.time.toMillis() : (a.token || 0);
      const tB = b.time?.toMillis ? b.time.toMillis() : (b.token || 0);
      return tA - tB;
    });

    // ── Check for status changes → fire notifications ──────────────
    checkStatusChanges(userOrders);

    ordersList.innerHTML = "";
    if (userOrders.length === 0) {
      ordersList.innerHTML = `<li class="noOrders">No orders placed yet.</li>`;
      return;
    }

    const sc = {
      "Pending Payment": "statusPendingPayment",
      "Preparing":       "statusPreparing",
      "Ready":           "statusReady",
      "Delivered":       "statusDelivered",
      "Cancelled":       "statusCancelled",
    };

    const now = Date.now();

    userOrders.forEach((data) => {
      const li = document.createElement("li");
      li.className = "liveOrderItem";

      const orderTime  = data.time?.toMillis ? data.time.toMillis() : 0;
      const ageSeconds = (now - orderTime) / 1000;
      // Allow cancel within 60s for Preparing OR Pending Payment
      const canCancel  = (data.status === "Preparing" || data.status === "Pending Payment")
                          && ageSeconds < 60;

      const cancelHtml = canCancel
        ? `<button class="cancelOrderBtn" onclick="cancelOrder('${data._id}', this)">✕ Cancel</button>`
        : "";

      // Helpful hint for pending payment
      const pendingHint = data.status === "Pending Payment"
        ? `<span class="pendingHint">⏳ Waiting for admin to confirm your UPI payment</span>`
        : "";

      li.innerHTML = `
        <div class="loLeft">
          <span class="loToken">Token #${data.token}</span>
          <span class="loItems">${data.items.map(i => `${i.name} ×${i.qty}`).join(", ")}</span>
          ${pendingHint}
          ${cancelHtml}
        </div>
        <div class="loRight">
          <span class="loTotal">₹${data.total}</span>
          <span class="${sc[data.status] || 'statusPreparing'}">${data.status}</span>
        </div>`;
      ordersList.appendChild(li);
    });
  }
}