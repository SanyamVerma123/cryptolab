/**
 * UserMenu.tsx — Top-bar User Account, Sync Indicator & Auth Dropdown
 *
 * Displays user authentication status, real-time Supabase sync indicator,
 * and quick-action menu (Sync Now, Account Details, Sign Out).
 */

import { useState, useEffect, useRef } from "react";
import { getCurrentUser, signOut, onAuthStateChange, type User } from "../lib/supabase";
import { onSyncStatusChange, pushToCloud, pullFromCloud, type SyncStatus } from "../lib/cloudSync";

interface UserMenuProps {
  onOpenAuth: () => void;
  externalOpen?: boolean;
}

export function UserMenu({ onOpenAuth, externalOpen = false }: UserMenuProps) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getCurrentUser().then(setUser);
    const unsubAuth = onAuthStateChange((u) => {
      setUser(u);
      if (!u) {
        setDropdownOpen(false);
      }
    });

    const unsubSync = onSyncStatusChange((st, ls) => {
      setStatus(st);
      setLastSynced(ls);
    });

    return () => {
      unsubAuth();
      unsubSync();
    };
  }, []);

  useEffect(() => {
    if (externalOpen) setDropdownOpen(true);
  }, [externalOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      window.addEventListener("mousedown", handleOutsideClick);
    }
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [dropdownOpen]);

  const handleManualSync = async () => {
    setSyncingNow(true);
    try {
      await pushToCloud();
      await pullFromCloud();
    } finally {
      setSyncingNow(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
    setDropdownOpen(false);
  };

  // If user is not authenticated: show "Sign In" button (icon only)
  if (!user) {
    return (
      <button
        className="series-select icon-only-btn user-auth-btn"
        title="Sign In / Cloud Sync: Sync your trades, balances, Alpaca keys, and indicators across all devices"
        onClick={onOpenAuth}
        aria-label="Sign In / Cloud Sync"
      >
        <span className="ctl-ico user-avatar-ico" aria-hidden="true">👤</span>
      </button>
    );
  }

  // User is logged in: show active user initial badge with sync dot
  const initial = user.email ? user.email.charAt(0).toUpperCase() : "U";

  return (
    <div className="user-menu-container" ref={menuRef}>
      {!externalOpen && <button
        className={`user-profile-chip icon-only-chip ${dropdownOpen ? "active" : ""}`}
        onClick={() => setDropdownOpen((v) => !v)}
        title={`Account: ${user.email} (${status === "synced" ? "Cloud Synced" : status})`}
        aria-label={`Account: ${user.email}`}
      >
        <span className="user-initial-badge">{initial}</span>
        <span
          className={`user-sync-dot ${
            syncingNow || status === "syncing"
              ? "syncing"
              : status === "error"
              ? "error"
              : "synced"
          }`}
          title={
            syncingNow || status === "syncing"
              ? "Syncing to cloud..."
              : status === "error"
              ? "Sync warning (will retry)"
              : "Synced with Supabase Cloud"
          }
        />
      </button>}

      {dropdownOpen && (
        <div className="user-dropdown-card">
          <div className="dropdown-user-header">
            <div className="dropdown-avatar">{initial}</div>
            <div className="dropdown-user-info">
              <span className="dropdown-email" title={user.email}>
                {user.email}
              </span>
              <span className="dropdown-status-text">
                {syncingNow || status === "syncing" ? (
                  <span className="status-label syncing">⚡ Syncing now...</span>
                ) : status === "error" ? (
                  <span className="status-label error">⚠️ Sync retry queued</span>
                ) : (
                  <span className="status-label synced">
                    ✓ Cloud Synced{" "}
                    {lastSynced
                      ? `(${lastSynced.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })})`
                      : ""}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="dropdown-sync-banner">
            <div className="sync-banner-title">Cloud Synced Items:</div>
            <ul className="sync-banner-list">
              <li>✓ Active Trades & Open Orders</li>
              <li>✓ Paper Balances & Trade History</li>
              <li>✓ Alpaca API Keys & Config</li>
              <li>✓ Chart Indicators & Pine Scripts</li>
              <li>✓ Drawing Tool Settings & Presets</li>
            </ul>
            <div className="sync-banner-note">
              * Chart drawings remain persistent in local browser storage.
            </div>
          </div>

          <div className="dropdown-actions">
            <button
              className="dropdown-btn sync-btn"
              onClick={handleManualSync}
              disabled={syncingNow}
            >
              <span className="action-ico">{syncingNow ? "⏳" : "🔄"}</span>
              <span>{syncingNow ? "Syncing..." : "Sync Cloud Now"}</span>
            </button>

            <button
              className="dropdown-btn signout-btn"
              onClick={handleSignOut}
            >
              <span className="action-ico">🚪</span>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
