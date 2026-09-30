/**
 * AuthModal.tsx — Supabase Authentication Dialog (Sign In / Sign Up)
 *
 * Allows users to register or log in from any device to access their:
 * - Active trades, open orders, paper trading balance and trade history
 * - Alpaca API keys and settings
 * - Custom indicators (LuxAlgo & Pine scripts)
 * - Drawing tool defaults & presets
 *
 * Note: Chart drawings remain strictly persistent in the user's browser,
 * never sent to the cloud database, exactly as instructed.
 */

import { useState, useEffect } from "react";
import { signIn, signUp, resetPassword } from "../lib/supabase";
import { pullFromCloud } from "../lib/cloudSync";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export function AuthModal({ open, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [open, mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email || !email.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    if (mode !== "forgot" && (!password || password.length < 6)) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signin") {
        const { error } = await signIn(email, password);
        if (error) throw error;
        setSuccessMsg("Signed in successfully! Syncing your account...");
        await pullFromCloud();
        setTimeout(() => {
          onClose();
        }, 800);
      } else if (mode === "signup") {
        const { error, user } = await signUp(email, password);
        if (error) throw error;
        if (user && !user.confirmed_at && user.identities?.length === 0) {
          setErrorMsg("An account with this email already exists. Please Sign In.");
          return;
        }
        setSuccessMsg("Account created successfully! Syncing data to cloud...");
        await pullFromCloud();
        setTimeout(() => {
          onClose();
        }, 1000);
      } else if (mode === "forgot") {
        const { error } = await resetPassword(email);
        if (error) throw error;
        setSuccessMsg("Password reset email sent. Please check your inbox.");
      }
    } catch (err: any) {
      console.error("[AuthModal] error:", err);
      let msg = err?.message || "An authentication error occurred.";
      if (msg.includes("Invalid login credentials")) {
        msg = "Invalid email or password. Please verify your credentials.";
      } else if (msg.includes("User already registered")) {
        msg = "An account with this email already exists. Please Sign In instead.";
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div
        className="auth-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <div className="auth-modal-header">
          <div className="auth-modal-brand">
            <span className="auth-logo-badge">⚡</span>
            <div>
              <h2 id="auth-modal-title">
                {mode === "signin"
                  ? "Sign In to Trade Pro"
                  : mode === "signup"
                  ? "Create Trade Pro Account"
                  : "Reset Password"}
              </h2>
              <p className="auth-subtitle">
                {mode === "forgot"
                  ? "Enter your email to receive recovery instructions"
                  : "Access your trades, API keys & indicators from any device"}
              </p>
            </div>
          </div>
          <button className="auth-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Informational Scope Badge */}
        <div className="auth-privacy-notice">
          <span className="notice-icon">🔒</span>
          <span>
            <strong>Cloud Sync Scope:</strong> Trades, balances, Alpaca keys, and indicators
            sync across devices. Chart drawings remain 100% saved in your browser.
          </span>
        </div>

        {/* Tab switchers */}
        {mode !== "forgot" && (
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${mode === "signin" ? "active" : ""}`}
              onClick={() => setMode("signin")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab ${mode === "signup" ? "active" : ""}`}
              onClick={() => setMode("signup")}
            >
              Sign Up
            </button>
          </div>
        )}

        {/* Notifications */}
        {errorMsg && (
          <div className="auth-alert error">
            <span className="alert-icon">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="auth-alert success">
            <span className="alert-icon">✓</span>
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loading}
              className="auth-input"
            />
          </div>

          {mode !== "forgot" && (
            <div className="auth-field">
              <div className="auth-label-row">
                <label htmlFor="auth-password">Password</label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={() => setMode("forgot")}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="auth-password-wrapper">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={mode === "signup" ? "Create a password (min. 6 chars)" : "Enter your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="auth-input"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "👁️" : "👁️‍🗨️"}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <span className="auth-spinner" />
            ) : mode === "signin" ? (
              "Sign In & Sync"
            ) : mode === "signup" ? (
              "Create Account & Sync"
            ) : (
              "Send Reset Link"
            )}
          </button>
        </form>

        <div className="auth-footer">
          {mode === "forgot" ? (
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => setMode("signin")}
            >
              ← Back to Sign In
            </button>
          ) : (
            <div className="auth-switch-text">
              {mode === "signin" ? (
                <>
                  Don't have an account yet?{" "}
                  <button
                    type="button"
                    className="auth-switch-link"
                    onClick={() => setMode("signup")}
                  >
                    Create one here
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="auth-switch-link"
                    onClick={() => setMode("signin")}
                  >
                    Sign In
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
