import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth, useCart } from "../context/AppContext";
import { menuItems, categories } from "../data/menuData";
import toast from "react-hot-toast";
import "./Menu.css";

const FALLBACK = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&q=80";

export default function Menu() {
  const { user, logout } = useAuth();
  const { cart, addToCart, changeQty, total } = useCart();
  const navigate = useNavigate();
  const [activeCat, setActiveCat] = useState("all");
  const [search, setSearch] = useState("");
  const [addedId, setAddedId] = useState(null);

  const filtered = menuItems.filter(item =>
    (activeCat === "all" || item.category === activeCat) &&
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = (item) => {
    addToCart(item);
    setAddedId(item.id);
    toast.success(`${item.name} added! 🛒`, { duration: 1500 });
    setTimeout(() => setAddedId(null), 600);
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="menu-page">
      <div className="blob blob1" /><div className="blob blob2" />

      {/* Navbar */}
      <nav className="menu-nav glass">
        <div className="nav-logo" onClick={() => navigate("/")}>🍽 SmartBite</div>
        <div className="nav-center">
          <input
            className="search-bar"
            placeholder="🔍 Search food..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="nav-right">
          <span className="nav-user">👋 {user?.displayName?.split(" ")[0] || "Hey!"}</span>
          <motion.button
            className="cart-btn"
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate("/cart")}
          >
            🛒 Cart {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </motion.button>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="menu-body">
        {/* Category Tabs */}
        <div className="cat-tabs">
          {categories.map(cat => (
            <motion.button
              key={cat.id}
              className={`cat-tab ${activeCat === cat.id ? "active" : ""}`}
              onClick={() => setActiveCat(cat.id)}
              whileTap={{ scale: 0.95 }}
            >
              {cat.label}
            </motion.button>
          ))}
        </div>

        {/* Menu Grid */}
        <motion.div className="menu-grid" layout>
          <AnimatePresence>
            {filtered.map(item => {
              const inCart = cart.find(i => i.name === item.name);
              return (
                <motion.div
                  key={item.id}
                  className="food-card glass"
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ y: -6, scale: 1.02 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="card-img-wrap">
                    <img
                      src={item.img}
                      alt={item.name}
                      onError={e => { e.target.src = FALLBACK; }}
                    />
                    {item.badge && <span className="card-badge">{item.badge}</span>}
                  </div>
                  <div className="card-body">
                    <h4>{item.name}</h4>
                    <p className="card-desc">{item.desc}</p>
                    <div className="card-footer">
                      <span className="card-price">₹{item.price}</span>
                      {inCart ? (
                        <div className="qty-ctrl">
                          <button onClick={() => changeQty(item.name, -1)}>−</button>
                          <span>{inCart.qty}</span>
                          <button onClick={() => changeQty(item.name, 1)}>+</button>
                        </div>
                      ) : (
                        <motion.button
                          className="add-btn"
                          onClick={() => handleAdd(item)}
                          animate={addedId === item.id ? { scale: [1, 1.3, 1] } : {}}
                        >
                          + Add
                        </motion.button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {filtered.length === 0 && (
            <div className="no-results">😕 No items found</div>
          )}
        </motion.div>
      </div>

      {/* Floating Cart Bar */}
      {cartCount > 0 && (
        <motion.div
          className="cart-bar glass"
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          onClick={() => navigate("/cart")}
        >
          <span>🛒 {cartCount} item{cartCount > 1 ? "s" : ""} in cart</span>
          <span className="cart-bar-total">₹{total} → View Cart</span>
        </motion.div>
      )}
    </div>
  );
}
