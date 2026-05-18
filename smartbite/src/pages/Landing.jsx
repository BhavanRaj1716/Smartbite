import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import "./Landing.css";

const floatingItems = ["🍔", "🍕", "🍟", "🧃", "🍰", "☕", "🌮", "🍩"];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing">
      {/* Animated background blobs */}
      <div className="blob blob1" />
      <div className="blob blob2" />
      <div className="blob blob3" />

      {/* Floating food icons */}
      {floatingItems.map((icon, i) => (
        <motion.div
          key={i}
          className="floating-icon"
          style={{ left: `${8 + i * 12}%`, top: `${10 + (i % 3) * 25}%` }}
          animate={{ y: [0, -20, 0], rotate: [0, 10, -10, 0] }}
          transition={{ duration: 3 + i * 0.4, repeat: Infinity, ease: "easeInOut" }}
        >
          {icon}
        </motion.div>
      ))}

      {/* Nav */}
      <motion.nav
        className="landing-nav"
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <div className="nav-logo">🍽 SmartBite</div>
        <div className="nav-links">
          <button className="btn-secondary" onClick={() => navigate("/login")}>Login</button>
          <button className="btn-primary" onClick={() => navigate("/login")}>Get Started</button>
        </div>
      </motion.nav>

      {/* Hero */}
      <div className="hero">
        <motion.div
          className="hero-content"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <motion.span
            className="hero-badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5, type: "spring" }}
          >
            🎓 Made for Campus Life
          </motion.span>

          <h1 className="hero-title">
            Skip the Queue.<br />
            <span className="gradient-text">Order Smart.</span><br />
            Enjoy Campus Life.
          </h1>

          <p className="hero-sub">
            Real-time canteen ordering — browse the menu, pay via UPI,<br />
            and track your order live from your seat.
          </p>

          <div className="hero-btns">
            <motion.button
              className="btn-primary hero-cta"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/login")}
            >
              🚀 Order Now
            </motion.button>
            <motion.button
              className="btn-secondary hero-cta"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/login")}
            >
              🍽 Explore Menu
            </motion.button>
          </div>

          {/* Stats */}
          <div className="hero-stats">
            {[["⚡", "Real-time"], ["🔒", "Secure UPI"], ["📱", "Mobile Ready"], ["🎯", "Live Tracking"]].map(([icon, label]) => (
              <motion.div
                key={label}
                className="stat-chip"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1 }}
              >
                {icon} {label}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Hero visual */}
        <motion.div
          className="hero-visual"
          initial={{ opacity: 0, x: 80 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <div className="hero-card glass">
            <div className="hero-card-header">
              <span>🛒 Your Order</span>
              <span className="token-badge">Token #7</span>
            </div>
            <div className="hero-card-items">
              {[["🍔", "Burger", "₹100"], ["🍕", "Pizza", "₹120"], ["🧃", "Juice", "₹40"]].map(([icon, name, price]) => (
                <div key={name} className="hero-item">
                  <span>{icon} {name}</span>
                  <span className="item-price">{price}</span>
                </div>
              ))}
            </div>
            <div className="hero-card-total">
              <span>Total</span>
              <span className="total-price">₹260</span>
            </div>
            <div className="status-bar">
              {["Placed", "Preparing", "Ready", "Delivered"].map((s, i) => (
                <div key={s} className={`status-step ${i <= 1 ? "active" : ""}`}>
                  <div className="step-dot" />
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
