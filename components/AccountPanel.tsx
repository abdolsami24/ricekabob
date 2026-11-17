"use client";

// Customer account page: email/password + Google sign-in (Supabase Auth),
// profile (name / phone / default delivery address) and order history with
// one-tap reorder. Guest checkout stays available on the storefront —
// an account is optional and only adds prefill + history (+ loyalty later).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/menu";

interface Profile {
  id: string;
  role: string;
  display_name: string | null;
  phone: string | null;
  default_address: string | null;
}

interface OrderRow {
  id: number;
  items_json: { id: string; name: string; qty: number; line_total_cents: number }[];
  total_cents: number;
  fulfillment: string;
  payment_status: string;
  kitchen_status: string;
  created_at: string;
}

const CART_KEY = "madinah_cart_v1";

export default function AccountPanel() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState("");

  const [pName, setPName] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pAddress, setPAddress] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  // Loyalty points.
  interface PointsRow {
    id: number;
    order_id: number | null;
    delta: number;
    reason: string;
    created_at: string;
  }
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [pointsHistory, setPointsHistory] = useState<PointsRow[]>([]);

  const loadAccount = useCallback(async () => {
    const client = getBrowserClient();
    if (!client) {
      setLoading(false);
      return;
    }
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setEmail(null);
      setProfile(null);
      setOrders([]);
      setPointsBalance(null);
      setPointsHistory([]);
      setLoading(false);
      return;
    }
    try {
      const [meRes, ordersRes] = await Promise.all([
        fetch("/api/account/me", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/account/orders", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (meRes.ok) {
        const me = await meRes.json();
        setEmail(me.email ?? null);
        setProfile(me.profile ?? null);
        if (me.profile) {
          setPName(me.profile.display_name ?? "");
          setPPhone(me.profile.phone ?? "");
          setPAddress(me.profile.default_address ?? "");
        }
        if (me.points) {
          setPointsBalance(
            typeof me.points.balance === "number" ? me.points.balance : null
          );
          setPointsHistory((me.points.history ?? []) as PointsRow[]);
        }
      }
      if (ordersRes.ok) {
        const o = await ordersRes.json();
        setOrders((o.orders ?? []) as OrderRow[]);
      }
    } catch {
      /* leave whatever we have */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAccount();
    const client = getBrowserClient();
    if (!client) return;
    const { data: sub } = client.auth.onAuthStateChange(() => {
      loadAccount();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadAccount]);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    const client = getBrowserClient();
    if (!client) return;
    setAuthBusy(true);
    setAuthMsg("");
    try {
      if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
      } else {
        const { data, error } = await client.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMsg("✅ Account created — please check your email to confirm it, then log in.");
          setAuthBusy(false);
          return;
        }
      }
      await loadAccount();
    } catch (err) {
      setAuthMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
    setAuthBusy(false);
  }

  async function googleSignIn() {
    const client = getBrowserClient();
    if (!client) return;
    setAuthMsg("");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/account` },
    });
    if (error) {
      setAuthMsg(
        "Google sign-in is not switched on yet. Please use email for now — the restaurant is enabling Google sign-in shortly."
      );
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const client = getBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    setSaveMsg("");
    const res = await fetch("/api/account/me", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ display_name: pName, phone: pPhone, default_address: pAddress }),
    });
    if (res.ok) {
      const me = await res.json();
      setProfile(me.profile ?? null);
      setSaveMsg("✅ Saved — checkout will now prefill these details for you.");
    } else {
      setSaveMsg("Could not save. Please try again.");
    }
  }

  async function logout() {
    const client = getBrowserClient();
    if (!client) return;
    await client.auth.signOut();
    setEmail(null);
    setProfile(null);
    setOrders([]);
  }

  function reorder(order: OrderRow) {
    const cart: Record<string, number> = {};
    for (const l of order.items_json ?? []) {
      if (l.id && l.qty > 0) cart[l.id] = l.qty;
    }
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
    window.location.href = "/";
  }

  if (loading) {
    return (
      <main className="wrap">
        <p style={{ marginTop: "2rem" }}>Loading your account…</p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← Back to menu</Link>
      </p>
      <h2 className="category-title">👤 My Account</h2>

      {!email ? (
        <section className="panel">
          <div className="toggle-row">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>
          <form onSubmit={submitAuth}>
            <div className="field">
              <label htmlFor="ac-email">Email</label>
              <input
                id="ac-email"
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="ac-pass">Password</label>
              <input
                id="ac-pass"
                type="password"
                required
                minLength={6}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            {authMsg && <div className="form-error" style={{ whiteSpace: "pre-wrap" }}>{authMsg}</div>}
            <button type="submit" className="checkout-btn" disabled={authBusy}>
              {authBusy ? "Please wait…" : mode === "login" ? "Log in" : "Create my account"}
            </button>
          </form>
          <div style={{ textAlign: "center", margin: "0.9rem 0", color: "#8a7a5f" }}>— or —</div>
          <button type="button" className="checkout-btn" onClick={googleSignIn}>
            Continue with Google
          </button>
          <p style={{ color: "#8a7a5f", fontSize: "0.92rem" }}>
            An account is optional — you can always order as a guest. An account saves your
            details for faster checkout and keeps your order history.
          </p>
        </section>
      ) : (
        <>
          <section className="panel">
            <h3>Welcome{profile?.display_name ? `, ${profile.display_name}` : ""} 👋</h3>
            <p style={{ color: "#8a7a5f" }}>{email}</p>
            <form onSubmit={saveProfile}>
              <div className="field">
                <label htmlFor="pf-name">Your name</label>
                <input id="pf-name" value={pName} onChange={(e) => setPName(e.target.value)} autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="pf-phone">Phone number</label>
                <input id="pf-phone" value={pPhone} onChange={(e) => setPPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
              </div>
              <div className="field">
                <label htmlFor="pf-address">Default delivery address</label>
                <input
                  id="pf-address"
                  value={pAddress}
                  onChange={(e) => setPAddress(e.target.value)}
                  placeholder="Street address, city, ZIP"
                  autoComplete="street-address"
                />
              </div>
              {saveMsg && <div className="fee-msg ok">{saveMsg}</div>}
              <button type="submit" className="checkout-btn">
                Save my details
              </button>
            </form>
            <button type="button" onClick={logout} style={{ marginTop: "0.8rem" }}>
              Log out
            </button>
          </section>

          <section className="panel">
            <h3>⭐ Loyalty points</h3>
            <p style={{ fontSize: "1.3rem", margin: "0.2rem 0" }}>
              <strong>{pointsBalance ?? 0} points</strong>
            </p>
            <p style={{ color: "#8a7a5f", marginTop: 0 }}>
              Earn 1 point per $1 on paid orders · 100 points = $5.00 off at checkout.
              {pointsBalance !== null && pointsBalance >= 100
                ? " You can use your points on your next order!"
                : pointsBalance !== null
                  ? ` Earn ${100 - pointsBalance} more for $5.00 off.`
                  : ""}
            </p>
            {pointsHistory.length > 0 && (
              <div>
                {pointsHistory.map((h) => (
                  <div className="cart-line" key={h.id}>
                    <span>
                      {h.reason === "earn" && "⭐ Earned"}
                      {h.reason === "redeem" && "🎁 Used at checkout"}
                      {h.reason === "refund" && "↩️ Refunded (order cancelled)"}
                      {h.reason === "reversal" && "↩️ Removed (order cancelled)"}
                      {h.order_id ? ` · Order #${h.order_id}` : ""} ·{" "}
                      {new Date(h.created_at).toLocaleDateString()}
                    </span>
                    <span>
                      {h.delta > 0 ? `+${h.delta}` : h.delta} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h3>🧾 My orders</h3>
            {orders.length === 0 && (
              <p style={{ color: "#8a7a5f" }}>
                No orders yet on this account. Orders you place while logged in will appear here.
              </p>
            )}
            {orders.map((o) => (
              <div key={o.id} className="cart-line" style={{ alignItems: "flex-start" }}>
                <span>
                  <strong>#{o.id}</strong> · {new Date(o.created_at).toLocaleDateString()}{" "}
                  {new Date(o.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  <br />
                  {(o.items_json ?? []).map((l) => `${l.qty} × ${l.name}`).join(", ")}
                  <br />
                  <span style={{ color: "#8a7a5f" }}>
                    {o.fulfillment === "delivery" ? "🛵 Delivery" : "🏃 Pickup"} · {o.kitchen_status} ·{" "}
                    {o.payment_status}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  {formatCents(o.total_cents)}
                  <br />
                  <button type="button" onClick={() => reorder(o)} style={{ marginTop: "0.3rem" }}>
                    ↻ Order again
                  </button>
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
