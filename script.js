import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
  query, where, doc, updateDoc, runTransaction, setDoc, getDoc
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
import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";

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

// ─── VAPID Key — Get from Firebase Console ─────────────────────────
// Go to: Firebase Console → Project Settings → Cloud Messaging
// → Web Push Certificates → Generate Key Pair → copy the key below
const VAPID_KEY = "YOUR_VAPID_KEY_HERE";

const UPI_ID   = "b1869452@oksbi";
const UPI_NAME = "Bhavan+Raj";

const app       = initializeApp(firebaseConfig);
const db        = getFirestore(app);
const auth      = getAuth(app);
const provider  = new GoogleAuthProvider();
const messaging = getMessaging(app);

// ─── State ─────────────────────────────────────────────────────────
let cart                  = [];
let ordersListenerStarted = false;
let ordersUnsubscribe     = null;
let upiPaymentConfirmed   = false;

// ══════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATION SETUP
// ══════════════════════════════════════════════════════════════════

// Register service worker and get FCM token
async function setupPushNotifications(user) {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;

  try {
    // Register the service worker
    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    console.log("[FCM] Service Worker registered:", registration.scope);

    // Ask user for notification permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[FCM] Notification permission denied.");
      return;
    }

    // Get FCM token (only if VAPID key is set)
    if (VAPID_KEY === "YOUR_VAPID_KEY_HERE") {
      console.warn("[FCM] VAPID key not set. Skipping FCM token fetch. See Firebase Console → Project Settings → Cloud Messaging.");
      return;
    }

    const fcmToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (fcmToken) {
      console.log("[FCM] Token obtained:", fcmToken);
      // Save token to Firestore so admin can send targeted notifications
      await setDoc(doc(db, "fcmTokens", user.uid), {
        token:     fcmToken,
        uid:       user.uid,
        email:     user.email,
        updatedAt: new Date()
      }, { merge: true });
      console.log("[FCM] Token saved to Firestore.");
    }

    // Handle foreground messages (when app IS open)
    onMessage(messaging, (payload) => {
      console.log("[FCM] Foreground message:", payload);
      const title = payload.notification?.title || "SmartBite 🍔";
      const body  = payload.notification?.body  || "Order update!";
      showToast(`${title} — ${body}`, 6000);
    });

  } catch (err) {
    console.error("[FCM] Push setup error:", err.message);
  }
}

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

  // Ask for standard notification permission (old method fallback)
  requestNotificationPermission();

  // Ask for Web Push / FCM notifications
  setupPushNotifications(user);

  updateCartUI();
  startMenuListener();
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
      await signOut(auth); // Force manual login — no auto-entry after signup
      showToast("✅ Account created! Please log in to continue.", 7000);
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

// ── Menu stock map (populated by startMenuListener) ────────────────
const menuStock = {};

function createRipple(btn, e) {
  try {
    const rect   = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "rippleEffect";
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX - rect.left) - size/2}px;top:${(e.clientY - rect.top) - size/2}px;`;
    btn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  } catch (_) {}
}

window.addToCart = function (name, price, slug, event) {
  // Stock check
  if (slug && menuStock[slug] !== undefined) {
    const inCart = cart.find(i => i.name === name)?.qty || 0;
    if (menuStock[slug] - inCart <= 0) {
      showToast("⚠ " + name + " is out of stock!");
      return;
    }
  }
  const item = cart.find(i => i.name === name);
  if (item) item.qty++;
  else       cart.push({ name, price, qty: 1, slug });
  updateCartUI();
  handlePaymentChange();
  showToast("🛒 " + name + " added!");
  // Ripple + button feedback
  const btn = slug ? document.getElementById("addBtn-" + slug) : null;
  if (btn) {
    if (event) createRipple(btn, event);
    btn.classList.add("added");
    setTimeout(() => btn.classList.remove("added"), 700);
  }
  // FAB pulse
  const fab = document.getElementById("mobileCartFab");
  if (fab) { fab.classList.remove("pulse"); void fab.offsetWidth; fab.classList.add("pulse"); setTimeout(() => fab.classList.remove("pulse"), 700); }
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
  // Update nav badge + FAB badge
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  const navBadge = document.getElementById("navCartBadge");
  const fabBadge = document.getElementById("fabBadge");
  if (navBadge) navBadge.innerText = totalQty > 0 ? totalQty : "";
  if (fabBadge) fabBadge.innerText = totalQty > 0 ? totalQty : "";
}

function updateStockUI() {
  document.querySelectorAll(".card[data-item]").forEach(card => {
    const slug   = card.dataset.item;
    const qty    = menuStock[slug];
    const badge  = document.getElementById("stock-" + slug);
    const btn    = document.getElementById("addBtn-" + slug);
    if (qty === undefined) { if (badge) badge.innerHTML = ""; if (btn) { btn.disabled = false; btn.textContent = "+ Add"; } card.classList.remove("outOfStock"); return; }
    if (qty <= 0) {
      if (badge) badge.innerHTML = '<span class="stockPill outOfStockPill">⛔ Out of Stock</span>';
      if (btn)   { btn.disabled = true; btn.textContent = "Sold Out"; }
      card.classList.add("outOfStock");
    } else if (qty <= 5) {
      if (badge) badge.innerHTML = `<span class="stockPill lowStockPill">⚠ Only ${qty} left</span>`;
      if (btn)   { btn.disabled = false; btn.textContent = "+ Add"; }
      card.classList.remove("outOfStock");
    } else {
      if (badge) badge.innerHTML = `<span class="stockPill inStockPill">✓ ${qty} available</span>`;
      if (btn)   { btn.disabled = false; btn.textContent = "+ Add"; }
      card.classList.remove("outOfStock");
    }
  });
}

function startMenuListener() {
  onSnapshot(collection(db, "menu"), (snapshot) => {
    snapshot.forEach(d => { menuStock[d.id] = d.data().qty ?? 0; });
    updateStockUI();
  }, (err) => {
    console.warn("Menu listener failed (likely permission-denied):", err.message);
  });
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
      if(window.showReceipt) window.showReceipt(token);
      else showToast("⏳ Order placed! Waiting for admin to confirm your UPI payment. Token #" + token, 7000);
    } else {
      if(window.showReceipt) window.showReceipt(token);
      else showToast("✅ Order placed! Token #" + token, 5000);
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
//  DYNAMIC PHONE MOCKUP UPDATE
// ══════════════════════════════════════════════════════════════════

function updatePhoneMockup(activeOrders) {
  const pmLabel = document.getElementById("pmLabel");
  const pmItems = document.getElementById("pmItems");
  const pmTotal = document.getElementById("pmTotal");
  const pmToken = document.getElementById("pmToken");
  const pmEta   = document.getElementById("pmEta");

  if (!pmLabel || !pmItems || !pmTotal || !pmToken || !pmEta) return;

  if (activeOrders.length === 0) {
    // Default welcome state
    pmLabel.innerText = "READY TO DROP? 😋";
    pmItems.innerText = "Add items to your bag and secure your token!";
    pmTotal.innerText = "₹0";
    pmToken.innerText = "#--";
    pmEta.innerText   = "Quick pick-up from seat";

    // Set all steps to default/inactive
    const s1 = document.getElementById("pmStep1");
    const s2 = document.getElementById("pmStep2");
    const s3 = document.getElementById("pmStep3");
    const s4 = document.getElementById("pmStep4");
    if(s1) s1.className = "phone-step";
    if(s2) s2.className = "phone-step";
    if(s3) s3.className = "phone-step";
    if(s4) s4.className = "phone-step";
    return;
  }

  // Display the first (oldest/current) active order
  const order = activeOrders[0];
  pmLabel.innerText = "YOUR ACTIVE ORDER";
  pmItems.innerText = order.items.map(i => `${i.qty}x ${i.name}`).join(" + ");
  pmTotal.innerText = "₹" + order.total;
  pmToken.innerText = "#" + order.token;

  // Set steps dynamically
  const step1 = document.getElementById("pmStep1");
  const step2 = document.getElementById("pmStep2");
  const step3 = document.getElementById("pmStep3");
  const step4 = document.getElementById("pmStep4");

  // Step 1: Payment
  if (order.status === "Pending Payment") {
    if(step1) step1.className = "phone-step active";
    pmEta.innerText = "Waiting for payment verification...";
  } else {
    if(step1) step1.className = "phone-step done";
  }

  // Step 2: Preparing
  if (order.status === "Preparing") {
    if(step2) step2.className = "phone-step active";
    pmEta.innerText = "Est. wait: ~5-10 mins";
  } else if (order.status === "Ready" || order.status === "Delivered") {
    if(step2) step2.className = "phone-step done";
  } else {
    if(step2) step2.className = "phone-step";
  }

  // Step 3: Ready
  if (order.status === "Ready") {
    if(step3) step3.className = "phone-step active";
    pmEta.innerText = "Order is hot & ready to pick up! 🔔";
  } else if (order.status === "Delivered") {
    if(step3) step3.className = "phone-step done";
  } else {
    if(step3) step3.className = "phone-step";
  }

  // Step 4: Collected/Delivered
  if (order.status === "Delivered") {
    if(step4) step4.className = "phone-step done";
    pmEta.innerText = "Delivered! Hope you enjoy it 😊";
  } else {
    if(step4) step4.className = "phone-step";
  }
}

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
    console.warn("Query failed, falling back to client filter:", err.message);
    ordersUnsubscribe = onSnapshot(collection(db, "orders"), (snapshot) => {
      renderUserOrders(snapshot, user);
    }, (fallbackErr) => {
      console.error("Fallback failed too:", fallbackErr.message);
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

    // Split into active and past
    const activeOrders = userOrders.filter(o => 
      o.status === "Pending Payment" || o.status === "Preparing" || o.status === "Ready"
    );
    const pastOrders = userOrders.filter(o => 
      o.status === "Delivered" || o.status === "Cancelled"
    );

    // Dynamic Live-Update for phone mockup on landing page!
    updatePhoneMockup(activeOrders);

    ordersList.innerHTML = "";

    // ── Active orders ───────────────────────────────────────────────
    if (activeOrders.length === 0 && pastOrders.length === 0) {
      ordersList.innerHTML = `<li class="noOrders" style="text-align:center; color:rgba(255,255,255,0.4); padding:40px 20px; font-size:1rem;">No orders yet. Start ordering! 🍔</li>`;
      return;
    }

    if (activeOrders.length === 0 && pastOrders.length > 0) {
      ordersList.innerHTML += `<li style="text-align:center; color:rgba(255,255,255,0.4); padding:20px 0; font-size:0.95rem;">No active orders right now.</li>`;
    }

    const now = Date.now();

    activeOrders.forEach((data) => {
      const li = document.createElement("li");
      li.className = "liveOrderItem";

      const orderTime  = data.time?.toMillis ? data.time.toMillis() : 0;
      const ageSeconds = (now - orderTime) / 1000;
      const canCancel  = (data.status === "Preparing" || data.status === "Pending Payment") && ageSeconds < 60;

      const cancelHtml = canCancel
        ? `<button class="cancelOrderBtn" onclick="cancelOrder('${data._id}', this)">✕ Cancel</button>`
        : "";

      const pendingHint = data.status === "Pending Payment"
        ? `<div class="pendingHint">⏳ Waiting for admin to confirm your UPI payment</div>`
        : "";

      const statusClass = data.status === "Pending Payment" ? "status-Pending" :
                          data.status === "Preparing" ? "status-Preparing" :
                          data.status === "Ready" ? "status-Ready" : "status-Delivered";

      li.innerHTML = `
        <div class="loHeader">
          <div>
            <div class="loToken">#${data.token}</div>
            <div class="loItems">${data.items.map(i => `${i.qty}× ${i.name}`).join(", ")}</div>
          </div>
          <div style="text-align:right;">
            <div class="loTotal">₹${data.total}</div>
            ${cancelHtml}
          </div>
        </div>
        ${pendingHint}
        <div class="order-tracker ${statusClass}">
          <div class="tracker-line"></div>
          <div class="tracker-progress"></div>
          <div class="tracker-step step-1">
            <div class="step-icon">💳</div>
            <div class="step-label">Payment<br>Confirmed</div>
          </div>
          <div class="tracker-step step-2">
            <div class="step-icon">🔥</div>
            <div class="step-label">Preparing</div>
          </div>
          <div class="tracker-step step-3">
            <div class="step-icon">✅</div>
            <div class="step-label">Ready</div>
          </div>
          <div class="tracker-step step-4">
            <div class="step-icon">🛍</div>
            <div class="step-label">Delivered</div>
          </div>
        </div>
      `;
      ordersList.appendChild(li);
    });

    // ── Past orders (history) ───────────────────────────────────────
    if (pastOrders.length > 0) {
      const historySection = document.createElement("li");
      historySection.style.listStyle = "none";
      historySection.innerHTML = `
        <div class="historyToggle" onclick="this.parentElement.querySelector('.historyList').classList.toggle('open'); this.querySelector('.historyArrow').classList.toggle('flipped')">
          <span>📋 Order History (${pastOrders.length})</span>
          <span class="historyArrow">▼</span>
        </div>
        <ul class="historyList">
          ${pastOrders.reverse().map(data => `
            <li class="historyItem ${data.status === 'Cancelled' ? 'historyCancelled' : 'historyDelivered'}">
              <div class="hiLeft">
                <span class="hiToken">#${data.token}</span>
                <span class="hiItems">${data.items.map(i => `${i.qty}× ${i.name}`).join(", ")}</span>
              </div>
              <div class="hiRight">
                <span class="hiTotal">₹${data.total}</span>
                <span class="hiStatus">${data.status === 'Delivered' ? '✅ Delivered' : '✕ Cancelled'}</span>
              </div>
            </li>
          `).join("")}
        </ul>
      `;
      ordersList.appendChild(historySection);
    }
  }
}