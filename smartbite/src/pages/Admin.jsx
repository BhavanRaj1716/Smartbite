import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "firebase/auth";
import { db, auth } from "../firebase/config";
import toast from "react-hot-toast";
import "./Admin.css";

const ADMIN_EMAIL = "bhavanraj503@gmail.com";
const provider = new GoogleAuthProvider();

export default function Admin() {
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("All");
  const [clock, setClock] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) return;
    const unsub = onSnapshot(collection(db, "orders"), (snap) => {
      const data = [];
      snap.forEach(d => data.push({ id: d.id, ...d.data() }));
      data.sort((a, b) => (a.time?.toMillis?.() || 0) - (b.time?.toMillis?.() || 0));
      setOrders(data);
    }, err => toast.error("Permission denied: " + err.message));
    return unsub;
  }, [user]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-IN"));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const handleGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === "auth/popup-blocked") await signInWithRedirect(auth, provider);
      else toast.error("Sign-in failed.");
    }
  };

  const updateStatus = async (id, status) => {
    await updateDoc(doc(db, "orders", id), { status });
    toast.success(`Marked as ${status}`);
  };

  const verifyPayment = async (id) => {
    await updateDoc(doc(db, "orders", id), { paymentVerified: true });
    toast.success("Payment verified!");
  };

  // Not logged in
  if (!user) return (
    <div className="admin-login">
      <div className="blob blob1" /><div className="blob blob2" />
      <motion.div className="admin-login-card glass" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
        <div className="admin-logo">🍽 SmartBite Admin</div>
        <p>Sign in with your admin Google account</p>
        <button className="google-btn" onClick={handleGoogle}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign in with Google
        </button>
      </motion.div>
    </div>
  );

  // Wrong account
  if (user.email !== ADMIN_EMAIL) return (
    <div className="admin-login">
      <div className="admin-login-card glass" style={{ textAlign: "center" }}>
        <div style={{ fontSize: "3rem" }}>⛔</div>
        <p style={{ color: "#ff4560", margin: "12px 0" }}>Access denied. Not an admin account.</p>
        <button className="google-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </div>
    </div>
  );

  const active = orders.filter(o => o.status !== "Delivered" && o.status !== "Cancelled");
  const delivered = orders.filter(o => o.status === "Delivered");
  const totalRevenue = delivered.reduce((s, o) => s + o.total, 0);
  const pendingUPI = active.filter(o => o.payment === "UPI" && !o.paymentVerified).reduce((s, o) => s + o.total, 0);

  const filtered = filter === "All" ? active
    : filter === "Delivered" ? delivered
    : orders.filter(o => o.status === filter);

  return (
    <div className="admin-page">
      <div className="blob blob1" /><div className="blob blob2" />

      {/* Header */}
      <header className="admin-header glass">
        <div className="admin-header-left">
          <div className="live-dot" />
          <span className="admin-title">🍽 SmartBite Admin</span>
        </div>
        <div className="admin-header-right">
          <span className="admin-clock">{clock}</span>
          <span className="admin-email">{user.email}</span>
          <button className="logout-btn" onClick={() => signOut(auth)}>Logout</button>
        </div>
      </header>

      {/* Stats */}
      <div className="stats-row">
        {[
          { label: "Total Orders", value: orders.filter(o => o.status !== "Cancelled").length, color: "#667eea" },
          { label: "Delivered Revenue", value: `₹${totalRevenue}`, color: "#43e97b" },
          { label: "UPI Pending", value: `₹${pendingUPI}`, color: "#f5576c" },
          { label: "Active Orders", value: active.length, color: "#ffab00" },
        ].map(stat => (
          <motion.div key={stat.label} className="stat-card glass" whileHover={{ y: -4 }}>
            <p className="stat-label">{stat.label}</p>
            <p className="stat-value" style={{ color: stat.color }}>{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="admin-filters">
        {["All", "Preparing", "Ready", "Delivered", "Cancelled"].map(f => (
          <button key={f} className={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {/* Orders */}
      <div className="admin-orders">
        {filtered.length === 0 ? (
          <div className="empty-msg">No orders here.</div>
        ) : (
          filtered.map(order => (
            <motion.div key={order.id} className="admin-order-card glass" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="ao-top">
                <div>
                  <span className="ao-token">Token #{order.token}</span>
                  <span className="ao-name">{order.name}</span>
                </div>
                <div className="ao-right">
                  <span className="ao-total">₹{order.total}</span>
                  <span className={`status-badge status-${order.status?.toLowerCase()}`}>{order.status}</span>
                </div>
              </div>

              <p className="ao-items">{order.items?.map(i => `${i.name} ×${i.qty}`).join(", ")}</p>
              <p className="ao-contact">{order.email || order.phone} · {order.payment}
                {order.payment === "UPI" && (
                  order.paymentVerified
                    ? <span className="pay-verified"> ✓ Paid</span>
                    : <button className="verify-btn" onClick={() => verifyPayment(order.id)}>✓ Confirm Payment</button>
                )}
              </p>

              <div className="ao-actions">
                {order.status === "Preparing" && (
                  <button className="action-btn ready-btn" onClick={() => updateStatus(order.id, "Ready")}>Mark Ready ↑</button>
                )}
                {order.status === "Ready" && (
                  <button className="action-btn deliver-btn" onClick={() => updateStatus(order.id, "Delivered")}>Deliver ✓</button>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
