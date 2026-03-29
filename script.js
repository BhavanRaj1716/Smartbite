import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
  query, where, doc, updateDoc, getDoc, setDoc, runTransaction
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

// ─── UPI Config — change to your real UPI ID ──────────────────────
const UPI_ID   = "b1869452@oksbi";
const UPI_NAME = "Bhavan+Raj";

// ─── Init ──────────────────────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
const db       = getFirestore(app);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── State ─────────────────────────────────────────────────────────
let cart                  = [];
let ordersListenerStarted = false;
let ordersUnsubscribe     = null;
let upiPaymentConfirmed   = false;

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
//  TOKEN COUNTER — stored in Firestore so it never resets
// ══════════════════════════════════════════════════════════════════

const TOKEN_DOC = doc(db, "meta", "tokenCounter");

// Get next token atomically — safe even with multiple simultaneous orders
async function getNextToken() {
  try {
    const newToken = await runTransaction(db, async (tx) => {
      const snap = await tx.get(TOKEN_DOC);
      const current = snap.exists() ? (snap.data().current || 0) : 0;
      const next = current + 1;
      tx.set(TOKEN_DOC, { current: next });
      return next;
    });
    return newToken;
  } catch (err) {
    console.error("Token counter error:", err);
    // Fallback to timestamp-based token if Firestore fails
    return Date.now() % 10000;
  }
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

// ── Splash + Auth coordination ─────────────────────────────────────
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
      showScreen("authScreen");
    }
  }
});

function initApp(user) {
  const nameEl  = document.getElementById("navUserName");
  const emailEl = document.getElementById("navUserEmail");
  if (nameEl)  nameEl.innerText  = user.displayName || "Customer";
  if (emailEl) emailEl.innerText = user.email || "";
  if (Notification && Notification.permission === "default") {
    Notification.requestPermission();
  }
  startOrdersListener(user);
}

// ══════════════════════════════════════════════════════════════════
//  AUTH LISTENERS
// ══════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {

  // Handle redirect result on page load (fallback from popup-blocked)
  getRedirectResult(auth).then((result) => {
    if (result && result.user) {
      console.log("Google redirect sign-in success:", result.user.email);
    }
  }).catch((err) => {
    console.error("Redirect result error:", err.code);
  });

  document.getElementById("googleBtn").addEventListener("click", async () => {
    clearAuthError();
    setLoading("googleBtn", true, "Continue with Google");
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === "auth/popup-blocked" || err.code === "auth/popup-closed-by-user") {
        // Fallback to redirect if popup is blocked
        await signInWithRedirect(auth, provider);
      } else {
        console.error("Google login error:", err.code, err.message);
        showAuthError(friendlyError(err.code));
        setLoading("googleBtn", false, "Continue with Google");
      }
    }
  });

  // ── Email Login ────────────────────────────────────────────────
  document.getElementById("loginBtn").addEventListener("click", async () => {
    clearAuthError();
    const email    = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!email || !password) { showAuthError("Please enter both email and password."); return; }

    setLoading("loginBtn", true, "Login →");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error("Login error:", err.code, err.message);
      showAuthError(friendlyError(err.code));
      setLoading("loginBtn", false, "Login →");
    }
  });

  // ── Email Signup ───────────────────────────────────────────────
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
      console.error("Signup error:", err.code, err.message);
      showAuthError(friendlyError(err.code));
    }
    setLoading("signupBtn", false, "Create Account →");
  });

  // ── Forgot Password ────────────────────────────────────────────
  const forgotLink = document.getElementById("forgotPassword");
  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();
      clearAuthError();
      const email = document.getElementById("loginEmail").value.trim();
      if (!email)                     { showAuthError("Type your email above first, then click Forgot Password."); return; }
      if (!/\S+@\S+\.\S+/.test(email)){ showAuthError("Please enter a valid email address."); return; }

      try {
        await sendPasswordResetEmail(auth, email);
        showAuthError(
          "✅ Reset email sent to " + email + ". Check your inbox & spam folder.",
          "#00e676"
        );
      } catch (err) {
        console.error("Password reset error:", err.code, err.message);
        showAuthError(err.code === "auth/user-not-found"
          ? "No account found with that email. Please sign up."
          : friendlyError(err.code)
        );
      }
    });
  }

});

// ── Logout ────────────────────────────────────────────────────────
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
// ══════════════════════════════════════════════════════════════════

window.handlePaymentChange = function () {
  const payment     = document.getElementById("paymentMethod").value;
  const upiSection  = document.getElementById("upiSection");
  const checkoutBtn = document.getElementById("checkoutBtn");

  if (upiSection) upiSection.style.display = "none";

  // Reset UPI state on payment method switch
  upiPaymentConfirmed       = false;
  checkoutBtn.innerText     = "Checkout →";
  checkoutBtn.disabled      = false;
  checkoutBtn.style.opacity = "1";

  if (payment === "UPI") {
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    if (total === 0) { showToast("⚠ Add items to cart first!"); return; }

    const upiLink = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&am=${total}&cu=INR`;
    const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const upiQR    = document.getElementById("upiQR");
    const payBtn   = document.getElementById("upiPayBtn");
    const upiLabel = document.getElementById("upiLabel");
    const upiNote  = document.getElementById("upiNote");

    document.getElementById("upiAmount").innerText = total;
    document.getElementById("upiIdText").innerText = UPI_ID;

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
  // Cash: checkout immediately available
};

window.confirmUpiPayment = function () {
  upiPaymentConfirmed = true;
  const confirmBtn  = document.getElementById("upiConfirmBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");
  if (confirmBtn) {
    confirmBtn.innerText         = "✅ Payment Confirmed";
    confirmBtn.disabled          = true;
    confirmBtn.style.background  = "#22c55e";
    confirmBtn.style.borderColor = "#22c55e";
    confirmBtn.style.color       = "#fff";
  }
  checkoutBtn.innerText     = "Place Order →";
  checkoutBtn.disabled      = false;
  checkoutBtn.style.opacity = "1";
  showToast("✅ Payment confirmed! Now click Place Order.", 4000);
};

// ══════════════════════════════════════════════════════════════════
//  CHECKOUT — uses Firestore token counter
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
    // Get a persistent token from Firestore (never resets on refresh)
    const token = await getNextToken();
    const total  = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

    await addDoc(collection(db, "orders"), {
      uid:              user.uid,
      name:             user.displayName || "Customer",
      email:            user.email       || "",
      phone:            user.phoneNumber || "",
      items:            JSON.parse(JSON.stringify(cart)),
      total,
      token,
      status:           "Preparing",
      payment,
      paymentConfirmed: payment === "Cash" ? true : upiPaymentConfirmed,
      time:             new Date(),
    });

    showToast("✅ Order placed! Token #" + token, 5000);

    // Reset cart & payment UI
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
//  ORDER CANCELLATION — within 60 seconds, only if Preparing
// ══════════════════════════════════════════════════════════════════

window.cancelOrder = async function (orderId, btnEl) {
  if (!confirm("Cancel this order?")) return;
  btnEl.disabled  = true;
  btnEl.innerText = "Cancelling...";
  try {
    await updateDoc(doc(db, "orders", orderId), { status: "Cancelled" });
    showToast("🚫 Order cancelled.");
  } catch (err) {
    console.error("Cancel error:", err);
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

    ordersList.innerHTML = "";
    if (userOrders.length === 0) {
      ordersList.innerHTML = `<li class="noOrders">No orders placed yet.</li>`;
      return;
    }

    const sc = {
      Preparing: "statusPreparing",
      Ready:     "statusReady",
      Delivered: "statusDelivered",
      Cancelled: "statusCancelled"
    };

    const now = Date.now();

    userOrders.forEach((data) => {
      const li = document.createElement("li");
      li.className = "liveOrderItem";

      // Cancel button: only if Preparing and placed within 60 seconds
      const orderTime  = data.time?.toMillis ? data.time.toMillis() : 0;
      const ageSeconds = (now - orderTime) / 1000;
      const canCancel  = data.status === "Preparing" && ageSeconds < 60;

      const cancelHtml = canCancel
        ? `<button class="cancelOrderBtn" onclick="cancelOrder('${data._id}', this)">✕ Cancel</button>`
        : "";

      li.innerHTML = `
        <div class="loLeft">
          <span class="loToken">Token #${data.token}</span>
          <span class="loItems">${data.items.map(i => `${i.name} ×${i.qty}`).join(", ")}</span>
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