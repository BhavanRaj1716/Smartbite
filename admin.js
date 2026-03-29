import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, doc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─── Firebase Config ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDxHZJ1BX4alB8LLbT9kskyqm-jKVFipUo",
  authDomain: "smart-canteen-e44e9.firebaseapp.com",
  projectId: "smart-canteen-e44e9",
  storageBucket: "smart-canteen-e44e9.firebasestorage.app",
  messagingSenderId: "509602872969",
  appId: "1:509602872969:web:c30a4eb11a448b9084d058",
  measurementId: "G-35J29T7499"
};

// ─── ⚠ SET YOUR ADMIN GMAIL HERE ──────────────────────────────────
// Only this Google account will be allowed to access the admin panel.
// Everyone else gets "Access denied" and is signed out immediately.
const ADMIN_EMAIL = "bhavanraj503@gmail.com"; // ← change this

// ─── Init ──────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── State ─────────────────────────────────────────────────────────
let allOrders = [];
let currentFilter = "All";
let knownOrderIds = new Set();
let isFirstLoad = true;
let ordersUnsub = null;

// ══════════════════════════════════════════════════════════════════
//  ADMIN AUTH GUARD
// ══════════════════════════════════════════════════════════════════

function showAdminLogin(errorMsg = "") {
  document.getElementById("adminLoginScreen").style.display = "flex";
  document.getElementById("adminDashboard").style.display = "none";
  if (errorMsg) {
    document.getElementById("adminLoginError").innerText = errorMsg;
  }
}

function showAdminDashboard(user) {
  document.getElementById("adminLoginScreen").style.display = "none";
  document.getElementById("adminDashboard").style.display = "block";
  const emailEl = document.getElementById("adminUserEmail");
  if (emailEl) emailEl.innerText = user.email;
  startOrdersListener();
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Not logged in — show login screen
    if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
    showAdminLogin();
    return;
  }

  // Logged in — check if they are the admin
  if (user.email !== ADMIN_EMAIL) {
    // Wrong account — sign them out and show error
    signOut(auth);
    showAdminLogin("⛔ Access denied. This panel is restricted to the admin account only.");
    return;
  }

  // Correct admin account
  showAdminDashboard(user);
});

// ── Admin Google Sign-In button ────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const googleBtn = document.getElementById("adminGoogleBtn");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      document.getElementById("adminLoginError").innerText = "";
      googleBtn.disabled = true;
      googleBtn.innerText = "Signing in...";
      try {
        await signInWithPopup(auth, provider);
        // onAuthStateChanged handles the rest
      } catch (err) {
        document.getElementById("adminLoginError").innerText =
          "Sign-in failed. Please try again.";
        googleBtn.disabled = false;
        googleBtn.innerText = "Sign in with Google";
      }
    });
  }

  const logoutBtn = document.getElementById("adminLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
      await signOut(auth);
    });
  }

  // Live clock
  const clockEl = document.getElementById("liveClock");
  if (clockEl) {
    const tick = () => {
      clockEl.innerText = new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  // Filter buttons
  const filterMap = {
    btnAll: "All",
    btnPreparing: "Preparing",
    btnReady: "Ready",
    btnDelivered: "Delivered",
    btnToday: "Today",
    btnCancelled: "Cancelled",
  };

  Object.entries(filterMap).forEach(([id, status]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", () => {
      currentFilter = status;
      document.querySelectorAll(".filters button").forEach(b => b.classList.remove("active"));
      el.classList.add("active");
      renderOrders();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════

if (Notification.permission === "default") Notification.requestPermission();

function sendNotification(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: "https://cdn-icons-png.flaticon.com/512/3075/3075977.png"
    });
  }
}

// ══════════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════════

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.innerText = msg;
  toast.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = "none"; }, 3000);
}

// ══════════════════════════════════════════════════════════════════
//  LIVE ORDERS LISTENER
// ══════════════════════════════════════════════════════════════════

function startOrdersListener() {
  if (ordersUnsub) return; // already listening

  ordersUnsub = onSnapshot(collection(db, "orders"), (snapshot) => {
    console.log("[Admin] Snapshot received, docs:", snapshot.size);
    allOrders = [];
    let totalRevenue = 0;
    let pendingRevenue = 0;

    snapshot.forEach((docItem) => {
      const data = docItem.data();
      data.id = docItem.id;
      allOrders.push(data);

      if (data.status === "Delivered") {
        totalRevenue += data.total;
      }
      if (data.status !== "Delivered" && data.status !== "Cancelled" && data.payment === "UPI") {
        pendingRevenue += data.total;
      }

      // Notify on new orders only (not on page load)
      if (!isFirstLoad && !knownOrderIds.has(docItem.id) && data.status === "Preparing") {
        sendNotification(
          "🍽 New Order — Token #" + data.token,
          `${data.name}: ${data.items.map(i => i.name + " x" + i.qty).join(", ")} — ₹${data.total} via ${data.payment}`
        );
      }
      knownOrderIds.add(docItem.id);
    });

    isFirstLoad = false;

    // FIFO sort — oldest first
    allOrders.sort((a, b) => {
      const tA = a.time?.toMillis ? a.time.toMillis() : (a.token || 0);
      const tB = b.time?.toMillis ? b.time.toMillis() : (b.token || 0);
      return tA - tB;
    });

    // Update stats
    document.getElementById("totalOrders").innerText = allOrders.filter(o => o.status !== "Cancelled").length;
    document.getElementById("totalRevenue").innerText = "₹" + totalRevenue;
    const pendingEl = document.getElementById("pendingRevenue");
    if (pendingEl) pendingEl.innerText = "₹" + pendingRevenue;

    renderOrders();
    renderHistory();
  }, (err) => {
    console.error("[Admin] Firestore error:", err.code, err.message);
  });
}

// ══════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════

function formatTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function isToday(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    return d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════════
//  RENDER ACTIVE ORDERS
// ══════════════════════════════════════════════════════════════════

function renderOrders() {
  const container = document.getElementById("adminOrders");
  if (!container) return;
  container.innerHTML = "";

  let filtered = [];

  if (currentFilter === "All") {
    filtered = allOrders.filter(o => o.status !== "Delivered" && o.status !== "Cancelled");
  } else if (currentFilter === "Today") {
    filtered = allOrders.filter(o => isToday(o.time) && o.status !== "Cancelled");
  } else if (currentFilter === "Cancelled") {
    filtered = allOrders.filter(o => o.status === "Cancelled");
  } else {
    filtered = allOrders.filter(o => o.status === currentFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `<p class="emptyMsg">No orders here.</p>`;
    return;
  }

  filtered.forEach((data) => {
    const card = document.createElement("div");
    card.className = "orderCard";

    const contact = data.email || data.phone || "";

    // Payment badge
    const payColors = { UPI: "#a78bfa", Cash: "#4ade80" };
    const pc = payColors[data.payment] || "#888";
    const payBadge = `<span class="payBadge" style="background:${pc}22; color:${pc}; border:1px solid ${pc}44;">${data.payment || "Cash"}</span>`;

    // UPI verify button
    const verifyHtml = data.payment === "UPI" && !data.paymentVerified
      ? `<button class="btnVerifyPayment" onclick="verifyPayment('${data.id}')">✓ Confirm Payment</button>`
      : data.paymentVerified ? `<span class="payVerified">✓ Paid</span>` : "";

    const info = document.createElement("div");
    info.className = "orderInfo";
    info.innerHTML = `
      <b>Token #${data.token} &nbsp;|&nbsp; ${data.name}</b>
      ${contact ? `<br><span class="orderContact">${contact}</span>` : ""}
      <br><span class="orderItems">${data.items.map(i => `${i.name} ×${i.qty}`).join(", ")}</span>
      <br><span class="orderMeta">₹${data.total} &nbsp;·&nbsp; ${payBadge} ${verifyHtml}</span>
      <br><span class="status${data.status}">${data.status}</span>
      ${data.time ? `<span class="orderTime"> &nbsp;·&nbsp; ${formatTime(data.time)}</span>` : ""}
    `;

    const btn = document.createElement("button");

    if (data.status === "Preparing") {
      btn.innerText = "Mark Ready ↑";
      btn.className = "btnReady";
      btn.onclick = async () => {
        btn.disabled = true;
        await updateDoc(doc(db, "orders", data.id), { status: "Ready" });
        showToast("Token #" + data.token + " marked Ready");
      };
    } else if (data.status === "Ready") {
      btn.innerText = "Deliver ✓";
      btn.className = "btnDeliver";
      btn.onclick = async () => {
        btn.disabled = true;
        await updateDoc(doc(db, "orders", data.id), { status: "Delivered" });
        showToast("Token #" + data.token + " delivered!");
      };
    } else if (data.status === "Cancelled") {
      btn.innerText = "Cancelled";
      btn.className = "btnDone";
      btn.disabled = true;
    } else {
      btn.innerText = "Done ✓";
      btn.className = "btnDone";
      btn.disabled = true;
    }

    card.appendChild(info);
    card.appendChild(btn);
    container.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════
//  VERIFY PAYMENT (Admin confirms UPI received)
// ══════════════════════════════════════════════════════════════════

window.verifyPayment = async function (orderId) {
  try {
    await updateDoc(doc(db, "orders", orderId), { paymentVerified: true });
    showToast("✅ Payment confirmed!");
  } catch (err) {
    showToast("❌ Error confirming payment.");
    console.error(err);
  }
};

// ══════════════════════════════════════════════════════════════════
//  RENDER HISTORY (Delivered orders only)
// ══════════════════════════════════════════════════════════════════

function renderHistory() {
  const container = document.getElementById("historyOrders");
  if (!container) return;
  container.innerHTML = "";

  const delivered = allOrders.filter(o => o.status === "Delivered");

  if (delivered.length === 0) {
    container.innerHTML = `<p class="emptyMsg">No delivered orders yet.</p>`;
    return;
  }

  delivered.forEach((data) => {
    const contact = data.email || data.phone || "";
    const card = document.createElement("div");
    card.className = "orderCard historyCard";
    card.innerHTML = `
      <div class="orderInfo">
        <b>Token #${data.token} &nbsp;|&nbsp; ${data.name}</b>
        ${contact ? `<br><span class="orderContact">${contact}</span>` : ""}
        <br><span class="orderItems">${data.items.map(i => `${i.name} ×${i.qty}`).join(", ")}</span>
        <br><span class="orderMeta">₹${data.total} &nbsp;·&nbsp; ${data.payment || "Cash"}</span>
        <br><span class="statusDelivered">Delivered ✓</span>
        ${data.time ? `<span class="orderTime"> &nbsp;·&nbsp; ${formatTime(data.time)}</span>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}