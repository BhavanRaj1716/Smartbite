import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { collection, addDoc, doc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/config";
import { useCart } from "../context/AppContext";
import confetti from "canvas-confetti";
import toast from "react-hot-toast";
import "./Cart.css";

const UPI_ID = "b1869452@oksbi";
const UPI_NAME = "SmartBite+Canteen";
const TOKEN_DOC = () => doc(db, "meta", "tokenCounter");

async function getNextToken() {
  const today = new Date().toISOString().slice(0, 10);
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(TOKEN_DOC());
    const data = snap.exists() ? snap.data() : {};
    const current = data.date === today ? (data.current || 0) : 0;
    const next = current + 1;
    tx.set(TOKEN_DOC(), { current: next, date: today });
    return next;
  });
}

export default function Cart() {
  const { cart, changeQty, clearCart, total } = useCart();
  const navigate = useNavigate();
  const [payment, setPayment] = useState("");
  const [upiConfirmed, setUpiConfirmed] = useState(false);
  const [placing, setPlacing] = useState(false);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const upiLink = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&am=${total}&cu=INR`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;

  const handleCheckout = async () => {
    if (cart.length === 0) return toast.error("Cart is empty!");
    if (!payment) return toast.error("Select a payment method.");
    if (payment === "UPI" && !upiConfirmed) return toast.error("Please confirm UPI payment first.");

    const user = auth.currentUser;
    if (!user) return toast.error("Please login again.");

    setPlacing(true);
    try {
      const token = await getNextToken();
      await addDoc(collection(db, "orders"), {
        uid: user.uid,
        name: user.displayName || "Customer",
        email: user.email || "",
        items: JSON.parse(JSON.stringify(cart)),
        total,
        token,
        status: "Preparing",
        payment,
        paymentConfirmed: payment === "Cash" ? true : upiConfirmed,
        time: new Date(),
      });

      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      toast.success(`🎉 Order placed! Token #${token}`);
      clearCart();
      navigate("/orders");
    } catch (err) {
      console.error(err);
      toast.error("Failed to place order. Try again.");
    }
    setPlacing(false);
  };

  return (
    <div className="cart-page">
      <div className="blob blob1" /><div className="blob blob2" />

      <motion.div className="cart-container" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>

        {/* Header */}
        <div className="cart-header">
          <button className="back-btn" onClick={() => navigate("/menu")}>← Back to Menu</button>
          <h2>Your Cart 🛒</h2>
        </div>

        {cart.length === 0 ? (
          <div className="empty-cart">
            <div style={{ fontSize: "4rem" }}>🛒</div>
            <p>Your cart is empty</p>
            <button className="btn-primary" onClick={() => navigate("/menu")}>Browse Menu</button>
          </div>
        ) : (
          <div className="cart-layout">
            {/* Cart Items */}
            <div className="cart-items glass">
              <h3>Order Summary</h3>
              <AnimatePresence>
                {cart.map(item => (
                  <motion.div
                    key={item.name}
                    className="cart-item"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                  >
                    <div className="ci-info">
                      <span className="ci-name">{item.name}</span>
                      <span className="ci-price">₹{item.price} each</span>
                    </div>
                    <div className="qty-ctrl">
                      <button onClick={() => changeQty(item.name, -1)}>−</button>
                      <span>{item.qty}</span>
                      <button onClick={() => changeQty(item.name, 1)}>+</button>
                    </div>
                    <span className="ci-subtotal">₹{item.price * item.qty}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div className="cart-total-row">
                <span>Total</span>
                <span className="big-total">₹{total}</span>
              </div>
            </div>

            {/* Payment */}
            <div className="payment-panel glass">
              <h3>Payment</h3>
              <div className="pay-options">
                {["UPI", "Cash"].map(p => (
                  <button
                    key={p}
                    className={`pay-opt ${payment === p ? "active" : ""}`}
                    onClick={() => { setPayment(p); setUpiConfirmed(false); }}
                  >
                    {p === "UPI" ? "📱 UPI" : "💵 Cash"}
                  </button>
                ))}
              </div>

              {payment === "UPI" && (
                <motion.div className="upi-box" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <p className="upi-label">{isMobile ? "Tap to Pay" : "Scan & Pay"}</p>
                  {isMobile ? (
                    <a href={upiLink} className="upi-deep-link" target="_blank" rel="noreferrer">
                      📱 Open UPI App → Pay ₹{total}
                    </a>
                  ) : (
                    <img src={qrUrl} alt="UPI QR" className="upi-qr" onError={e => e.target.style.display = "none"} />
                  )}
                  <p className="upi-id">UPI: <b>{UPI_ID}</b></p>
                  <p className="upi-amount">Amount: <b>₹{total}</b></p>
                  {!upiConfirmed ? (
                    <button className="confirm-pay-btn" onClick={() => { setUpiConfirmed(true); toast.success("Payment confirmed!"); }}>
                      ✔ I Have Paid
                    </button>
                  ) : (
                    <div className="pay-confirmed">✅ Payment Confirmed</div>
                  )}
                </motion.div>
              )}

              <motion.button
                className="checkout-btn"
                onClick={handleCheckout}
                disabled={placing || (payment === "UPI" && !upiConfirmed) || !payment}
                whileTap={{ scale: 0.97 }}
              >
                {placing ? "Placing Order..." : "🚀 Place Order"}
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
