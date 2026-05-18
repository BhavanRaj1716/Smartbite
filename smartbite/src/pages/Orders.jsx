import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db, auth } from "../firebase/config";
import "./Orders.css";

const STEPS = ["Preparing", "Ready", "Delivered"];
const STEP_ICONS = { Preparing: "👨‍🍳", Ready: "✅", Delivered: "🎉", Cancelled: "❌" };

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const q = query(collection(db, "orders"), where("uid", "==", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const data = [];
      snap.forEach(d => data.push({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.time?.toMillis?.() || 0) - (a.time?.toMillis?.() || 0));
      setOrders(data);
    });
    return unsub;
  }, []);

  const handleCancel = async (orderId) => {
    if (!confirm("Cancel this order?")) return;
    await updateDoc(doc(db, "orders", orderId), { status: "Cancelled" });
  };

  return (
    <div className="orders-page">
      <div className="blob blob1" /><div className="blob blob2" />

      <div className="orders-container">
        <div className="orders-header">
          <button className="back-btn" onClick={() => navigate("/menu")}>← Menu</button>
          <h2>Your Orders 📋</h2>
        </div>

        {orders.length === 0 ? (
          <div className="empty-orders">
            <div style={{ fontSize: "4rem" }}>📋</div>
            <p>No orders yet</p>
            <button className="btn-primary" onClick={() => navigate("/menu")}>Order Now</button>
          </div>
        ) : (
          <div className="orders-list">
            <AnimatePresence>
              {orders.map(order => {
                const stepIdx = STEPS.indexOf(order.status);
                const orderTime = order.time?.toMillis?.() || 0;
                const canCancel = order.status === "Preparing" && (Date.now() - orderTime) < 60000;

                return (
                  <motion.div
                    key={order.id}
                    className="order-card glass"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <div className="order-top">
                      <div>
                        <span className="token-num">Token #{order.token}</span>
                        <span className={`status-badge status-${order.status?.toLowerCase()}`}>
                          {STEP_ICONS[order.status]} {order.status}
                        </span>
                      </div>
                      <div className="order-meta">
                        <span>₹{order.total}</span>
                        <span className="pay-tag">{order.payment}</span>
                      </div>
                    </div>

                    <p className="order-items">{order.items?.map(i => `${i.name} ×${i.qty}`).join(", ")}</p>

                    {/* Status Progress Bar */}
                    {order.status !== "Cancelled" && (
                      <div className="progress-bar">
                        {STEPS.map((step, i) => (
                          <div key={step} className={`progress-step ${i <= stepIdx ? "done" : ""}`}>
                            <div className="progress-dot" />
                            <span>{step}</span>
                            {i < STEPS.length - 1 && <div className={`progress-line ${i < stepIdx ? "done" : ""}`} />}
                          </div>
                        ))}
                      </div>
                    )}

                    {canCancel && (
                      <button className="cancel-btn" onClick={() => handleCancel(order.id)}>
                        ✕ Cancel Order
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
