import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, updateProfile, sendEmailVerification
} from "firebase/auth";
import { auth } from "../firebase/config";
import toast from "react-hot-toast";
import "./Login.css";

const provider = new GoogleAuthProvider();

export default function Login() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
      navigate("/menu");
    } catch (err) {
      if (err.code === "auth/popup-blocked") {
        await signInWithRedirect(auth, provider);
      } else {
        toast.error("Google sign-in failed. Try again.");
      }
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error("Fill in all fields.");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/menu");
    } catch (err) {
      toast.error(err.code === "auth/invalid-credential" ? "Wrong email or password." : "Login failed.");
    }
    setLoading(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) return toast.error("Fill in all fields.");
    if (password.length < 6) return toast.error("Password must be 6+ characters.");
    setLoading(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: name });
      await sendEmailVerification(user);
      toast.success("Account created! Verify your email.");
      setTab("login");
    } catch (err) {
      toast.error(err.code === "auth/email-already-in-use" ? "Email already registered." : "Signup failed.");
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="blob blob1" /><div className="blob blob2" />

      <motion.div
        className="login-card glass"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="login-logo">🍽 SmartBite</div>
        <p className="login-sub">Your campus canteen, reimagined.</p>

        {/* Google */}
        <motion.button className="google-btn" onClick={handleGoogle} whileTap={{ scale: 0.97 }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </motion.button>

        <div className="divider"><span>or</span></div>

        {/* Tabs */}
        <div className="tabs">
          <button className={tab === "login" ? "active" : ""} onClick={() => setTab("login")}>Login</button>
          <button className={tab === "signup" ? "active" : ""} onClick={() => setTab("signup")}>Sign Up</button>
        </div>

        {tab === "login" ? (
          <form onSubmit={handleLogin}>
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit" className="btn-primary submit-btn" disabled={loading}>
              {loading ? "Logging in..." : "Login →"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit" className="btn-primary submit-btn" disabled={loading}>
              {loading ? "Creating..." : "Create Account →"}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
