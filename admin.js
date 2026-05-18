import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, doc, updateDoc, setDoc,
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
  apiKey:            "AIzaSyDxHZJ1BX4alB8LLbT9kskyqm-jKVFipUo",
  authDomain:        "smart-canteen-e44e9.firebaseapp.com",
  projectId:         "smart-canteen-e44e9",
  storageBucket:     "smart-canteen-e44e9.firebasestorage.app",
  messagingSenderId: "509602872969",
  appId:             "1:509602872969:web:c30a4eb11a448b9084d058",
  measurementId:     "G-35J29T7499"
};

// ── Only this Gmail can access admin panel ─────────────────────────
const ADMIN_EMAIL = "bhavanraj503@gmail.com";

const app      = initializeApp(firebaseConfig);
const db       = getFirestore(app);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

let allOrders     = [];
let currentFilter = "All";
let knownOrderIds = new Set();
let isFirstLoad   = true;
let ordersUnsub   = null;

// ══════════════════════════════════════════════════════════════════
//  ADMIN AUTH GUARD
// ══════════════════════════════════════════════════════════════════

function showAdminLogin(errorMsg = "") {
  document.getElementById("adminLoginScreen").style.display = "flex";
  document.getElementById("adminDashboard").style.display   = "none";
  if (errorMsg) document.getElementById("adminLoginError").innerText = errorMsg;
}

function showAdminDashboard(user) {
  document.getElementById("adminLoginScreen").style.display = "none";
  document.getElementById("adminDashboard").style.display   = "block";
  const emailEl = document.getElementById("adminUserEmail");
  if (emailEl) emailEl.innerText = user.email;
  startOrdersListener();
  startInventoryListener();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
    showAdminLogin();
    return;
  }
  if (user.email !== ADMIN_EMAIL) {
    await signOut(auth);
    // Re-show the login screen with a friendly error and re-enable the button
    document.getElementById("adminLoginScreen").style.display = "flex";
    document.getElementById("adminDashboard").style.display   = "none";
    const errEl = document.getElementById("adminLoginError");
    if (errEl) errEl.innerText = "⛔ Access denied. Only the registered admin can log in here.";
    const btn = document.getElementById("adminGoogleBtn");
    if (btn) { btn.disabled = false; btn.innerText = "Sign in with Google"; }
    return;
  }
  showAdminDashboard(user);
});

// ══════════════════════════════════════════════════════════════════
//  DOM READY
// ══════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {

  // Admin Google Sign-In
  const googleBtn = document.getElementById("adminGoogleBtn");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      document.getElementById("adminLoginError").innerText = "";
      googleBtn.disabled  = true;
      googleBtn.innerText = "Signing in...";
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        document.getElementById("adminLoginError").innerText = "Sign-in failed. Please try again.";
        googleBtn.disabled  = false;
        googleBtn.innerText = "Sign in with Google";
      }
    });
  }

  // Admin Logout
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
    btnAll:            "All",
    btnPendingPayment: "Pending Payment",
    btnPreparing:      "Preparing",
    btnReady:          "Ready",
    btnDelivered:      "Delivered",
    btnToday:          "Today",
    btnCancelled:      "Cancelled",
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

  // Inventory toggle
  const invBtn = document.getElementById("btnInventory");
  if (invBtn) {
    invBtn.addEventListener("click", () => {
      const invPanel  = document.getElementById("inventoryPanel");
      const ordPanel  = document.getElementById("panelLayout");
      const showing   = invPanel.style.display !== "none";
      invPanel.style.display  = showing ? "none"  : "block";
      ordPanel.style.display  = showing ? "grid"  : "none";
      document.querySelectorAll(".filters button:not(#btnInventory)").forEach(b => {
        b.style.display = showing ? "" : "none";
      });
      invBtn.textContent = showing ? "\ud83d\udce6 Stock Manager" : "\u25c0 Back to Orders";
      invBtn.classList.toggle("active", !showing);
      if (!showing) renderInventory();
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  ADMIN BROWSER NOTIFICATIONS
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
  toast.innerText     = msg;
  toast.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = "none"; }, 3500);
}

// ══════════════════════════════════════════════════════════════════
//  LIVE ORDERS LISTENER
// ══════════════════════════════════════════���═══════════════════════

function startOrdersListener() {
  if (ordersUnsub) return;

  ordersUnsub = onSnapshot(collection(db, "orders"), (snapshot) => {
    allOrders = [];
    let totalRevenue   = 0;
    let pendingRevenue = 0;
    let pendingCount   = 0;

    snapshot.forEach((docItem) => {
      const data = docItem.data();
      data.id    = docItem.id;
      allOrders.push(data);

      if (data.status === "Delivered") totalRevenue += data.total;

      // UPI Pending Payment orders
      if (data.status === "Pending Payment") {
        pendingRevenue += data.total;
        pendingCount++;
      }

      // Notify admin of new UPI "Pending Payment" orders (needs action)
      if (!isFirstLoad && !knownOrderIds.has(docItem.id) && data.status === "Pending Payment") {
        sendNotification(
          "💳 UPI Payment to Verify — Token #" + data.token,
          `${data.name} paid ₹${data.total} via UPI. Check your UPI app and confirm!`
        );
      }

      // Notify admin of new Cash "Preparing" orders
      if (!isFirstLoad && !knownOrderIds.has(docItem.id) && data.status === "Preparing" && data.payment === "Cash") {
        sendNotification(
          "🍽 New Cash Order — Token #" + data.token,
          `${data.name}: ${data.items.map(i => i.name + " x" + i.qty).join(", ")} — ₹${data.total}`
        );
      }

      knownOrderIds.add(docItem.id);
    });

    isFirstLoad = false;

    // FIFO sort
    allOrders.sort((a, b) => {
      const tA = a.time?.toMillis ? a.time.toMillis() : (a.token || 0);
      const tB = b.time?.toMillis ? b.time.toMillis() : (b.token || 0);
      return tA - tB;
    });

    // Stats
    document.getElementById("totalOrders").innerText  = allOrders.filter(o => o.status !== "Cancelled").length;
    document.getElementById("totalRevenue").innerText = "₹" + totalRevenue;
    const pendingEl = document.getElementById("pendingRevenue");
    if (pendingEl) pendingEl.innerText = "₹" + pendingRevenue;

    // Badge on Pending Payment filter button
    const pendingBtn = document.getElementById("btnPendingPayment");
    if (pendingBtn) {
      pendingBtn.innerText = pendingCount > 0
        ? `⚠ Pending Payment (${pendingCount})`
        : "Pending Payment";
      // Highlight the button if there are pending payments waiting
      if (pendingCount > 0) {
        pendingBtn.style.borderColor = "#ffab00";
        pendingBtn.style.color       = "#ffab00";
      } else {
        pendingBtn.style.borderColor = "";
        pendingBtn.style.color       = "";
      }
    }

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
    const d   = ts?.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    return d.getDate()     === now.getDate()     &&
           d.getMonth()    === now.getMonth()    &&
           d.getFullYear() === now.getFullYear();
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════════
//  RENDER ACTIVE ORDERS
// ════════════════════════════════════════════���═════════════════════

function renderOrders() {
  const container = document.getElementById("adminOrders");
  if (!container) return;
  container.innerHTML = "";

  let filtered = [];
  if (currentFilter === "All") {
    // All active — exclude Delivered and Cancelled
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

    const payColors = { UPI: "#C850C0", Cash: "#A8FF3E" };
    const pc        = payColors[data.payment] || "#888";
    const payBadge  = `<span class="payBadge" style="background:${pc}22;color:${pc};border:1px solid ${pc}44;">${data.payment || "Cash"}</span>`;

    const info = document.createElement("div");
    info.className = "orderInfo";
    info.innerHTML = `
      <div class="orderTokenRow">
        <b>#${data.token}</b>
        <span class="orderName">${data.name} ${contact ? `(${contact})` : ""}</span>
      </div>
      <div class="orderItems">${data.items.map(i => `${i.qty}x ${i.name}`).join(", ")}</div>
      <div class="orderMetaRow">
        <span style="font-family:var(--font-display); font-weight:700; color:#FFBE00;">₹${data.total}</span>
        ${payBadge}
        <span class="status${data.status.replace(" ", "")}">${data.status}</span>
        ${data.time ? `<span style="color:#666; font-size:0.8rem;">${formatTime(data.time)}</span>` : ""}
      </div>
    `;

    const btn = document.createElement("button");

    if (data.status === "Pending Payment") {
      // ── KEY: Admin confirms UPI payment → moves to Preparing ──────
      btn.innerHTML = "✓ Confirm &amp; Prepare";
      btn.className = "btnConfirmPay";
      btn.title     = "Check your UPI app first, then click this";
      btn.onclick   = async () => {
        btn.disabled  = true;
        btn.innerText = "Confirming...";
        try {
          await updateDoc(doc(db, "orders", data.id), {
            status:          "Preparing",
            paymentVerified: true,
            paymentConfirmed: true,
          });
          showToast("✅ Payment confirmed! Token #" + data.token + " → Preparing");
        } catch (err) {
          console.error(err);
          showToast("❌ Error. Try again.");
          btn.disabled  = false;
          btn.innerText = "✓ Confirm & Prepare";
        }
      };

    } else if (data.status === "Preparing") {
      btn.innerText = "Mark Ready ↑";
      btn.className = "btnReady";
      btn.onclick   = async () => {
        btn.disabled = true;
        await updateDoc(doc(db, "orders", data.id), { status: "Ready" });
        showToast("Token #" + data.token + " marked Ready");
      };

    } else if (data.status === "Ready") {
      btn.innerText = "Deliver ✓";
      btn.className = "btnDeliver";
      btn.onclick   = async () => {
        btn.disabled = true;
        await updateDoc(doc(db, "orders", data.id), { status: "Delivered" });
        showToast("Token #" + data.token + " delivered!");
      };

    } else if (data.status === "Cancelled") {
      btn.innerText = "Cancelled";
      btn.className = "btnDone";
      btn.disabled  = true;

    } else {
      btn.innerText = "Done ✓";
      btn.className = "btnDone";
      btn.disabled  = true;
    }

    card.appendChild(info);
    card.appendChild(btn);
    container.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════
//  RENDER HISTORY
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
    const card    = document.createElement("div");
    card.className = "orderCard historyCard";
    card.innerHTML = `
      <div class="orderInfo">
        <div class="orderTokenRow">
          <b>#${data.token}</b>
          <span class="orderName">${data.name} ${contact ? `(${contact})` : ""}</span>
        </div>
        <div class="orderItems">${data.items.map(i => `${i.qty}x ${i.name}`).join(", ")}</div>
        <div class="orderMetaRow">
          <span style="font-family:var(--font-display); font-weight:700; color:#A8FF3E;">₹${data.total}</span>
          <span class="payBadge" style="border:1px solid #aaa; color:#aaa;">${data.payment || "Cash"}</span>
          <span class="statusDelivered">Delivered ✓</span>
          ${data.time ? `<span style="color:#666; font-size:0.8rem;">${formatTime(data.time)}</span>` : ""}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════
//  INVENTORY / STOCK MANAGEMENT
// ══════════════════════════════════════════════════════════════════

const MENU_ITEMS = [
  { name: "Drop Burger",       slug: "burger",         emoji: "🍔", category: "Main Course" },
  { name: "Loaded Pizza",      slug: "pizza",          emoji: "🍕", category: "Main Course" },
  { name: "Grill Sandwich",    slug: "sandwich",       emoji: "🥪", category: "Main Course" },
  { name: "Wok Fried Rice",    slug: "fried-rice",     emoji: "🍳", category: "Main Course" },
  { name: "Spicy Noodles",     slug: "noodles",        emoji: "🍝", category: "Main Course" },
  { name: "Butter Chicken",    slug: "butter-chicken", emoji: "���", category: "Main Course" },
  { name: "Neon Fries",        slug: "french-fries",   emoji: "🍟", category: "Snacks" },
  { name: "Classic Samosa",    slug: "samosa",         emoji: "🥟", category: "Snacks" },
  { name: "Crispy Tacos",      slug: "tacos",          emoji: "🌮", category: "Snacks" },
  { name: "Nachos Grande",     slug: "nachos",         emoji: "🧀", category: "Snacks" },
  { name: "Chicken Nuggets",   slug: "nuggets",        emoji: "🍗", category: "Snacks" },
  { name: "Thick Shake",       slug: "milkshake",      emoji: "🧋", category: "Drinks" },
  { name: "Black Coffee",      slug: "coffee",         emoji: "☕", category: "Drinks" },
  { name: "Cold Coffee",       slug: "cold-coffee",    emoji: "🧊", category: "Drinks" },
  { name: "Lemon Iced Tea",    slug: "iced-tea",       emoji: "🍹", category: "Drinks" },
  { name: "Fresh Lime Soda",   slug: "lime-soda",      emoji: "🥤", category: "Drinks" },
  { name: "Choco Lava Cake",   slug: "lava-cake",      emoji: "🍫", category: "Desserts" },
  { name: "Sizzling Brownie",  slug: "brownie",        emoji: "🥧", category: "Desserts" },
  { name: "Classic Waffles",   slug: "waffles",        emoji: "🧇", category: "Desserts" }
];

const currentStock = {};

function startInventoryListener() {
  onSnapshot(collection(db, "menu"), (snapshot) => {
    snapshot.forEach(d => { currentStock[d.id] = d.data().qty ?? 0; });
    // Live-update inputs if panel is open
    const panel = document.getElementById("inventoryPanel");
    if (panel && panel.style.display !== "none") {
      MENU_ITEMS.forEach(item => {
        const input    = document.getElementById("qty-" + item.slug);
        const statusEl = document.getElementById("invStatus-" + item.slug);
        if (input && currentStock[item.slug] !== undefined) {
          input.value = currentStock[item.slug];
          if (statusEl) updateInventoryStatus(statusEl, currentStock[item.slug]);
        }
      });
    }
  });
}

function updateInventoryStatus(el, qty) {
  el.className = "inventoryStatus";
  if (qty <= 0)      { el.textContent = "⛔ Out of Stock"; el.classList.add("red"); }
  else if (qty <= 5) { el.textContent = "⚠ Low — " + qty + " left"; el.classList.add("amber"); }
  else               { el.textContent = "✓ In Stock — " + qty + " units"; el.classList.add("green"); }
}

function renderInventory() {
  const grid = document.getElementById("inventoryGrid");
  if (!grid) return;
  grid.innerHTML = "";

  MENU_ITEMS.forEach((item, idx) => {
    const qty  = currentStock[item.slug] ?? "";
    const card = document.createElement("div");
    card.className = "inventoryCard";
    card.style.animationDelay = (idx * 0.04) + "s";
    card.innerHTML = `
      <div class="inventoryItemName">
        <span class="inventoryEmoji">${item.emoji}</span>
        <div>
          <div style="font-weight:700;">${item.name}</div>
          <div class="inventoryCategory">${item.category}</div>
        </div>
      </div>
      <div class="inventoryQtyRow">
        <input type="number" min="0" max="999" value="${qty}"
               class="inventoryQtyInput" id="qty-${item.slug}" placeholder="0" />
        <button class="inventorySaveBtn" id="saveBtn-${item.slug}"
                data-slug="${item.slug}" data-name="${item.name}">Save</button>
      </div>
      <div class="inventoryStatus ${qty === "" ? "" : qty <= 0 ? "red" : qty <= 5 ? "amber" : "green"}"
           id="invStatus-${item.slug}">
        ${qty === "" ? "Not set yet" : qty <= 0 ? "⛔ Out of Stock" : qty <= 5 ? "⚠ Low — " + qty + " left" : "✓ In Stock — " + qty + " units"}
      </div>
    `;
    grid.appendChild(card);

    // Live preview while typing
    const input    = document.getElementById("qty-" + item.slug);
    const statusEl = document.getElementById("invStatus-" + item.slug);
    if (input && statusEl) {
      input.addEventListener("input", () => {
        updateInventoryStatus(statusEl, parseInt(input.value) || 0);
      });
    }

    // Save button
    const saveBtn = document.getElementById("saveBtn-" + item.slug);
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const slug = saveBtn.dataset.slug;
        const name = saveBtn.dataset.name;
        const inp  = document.getElementById("qty-" + slug);
        const qty  = Math.max(0, parseInt(inp.value) || 0);
        inp.value  = qty;
        saveBtn.disabled  = true;
        saveBtn.innerText = "Saving...";
        try {
          await setDoc(doc(db, "menu", slug), { qty, updatedAt: new Date() });
          currentStock[slug] = qty;
          saveBtn.innerText = "✓ Saved!";
          saveBtn.classList.add("saved");
          showToast("✅ " + name + " → " + qty + " units saved");
          setTimeout(() => {
            saveBtn.innerText = "Save";
            saveBtn.classList.remove("saved");
            saveBtn.disabled  = false;
          }, 2000);
        } catch (err) {
          showToast("❌ Failed to save. Try again.");
          saveBtn.innerText = "Save";
          saveBtn.disabled  = false;
        }
      });
    }
  });
}