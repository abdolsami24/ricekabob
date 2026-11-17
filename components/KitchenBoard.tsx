"use client";

// Kitchen Display System (KDS).
// - Supabase Auth login gate (email + password).
// - Live feed: polls /api/kitchen/orders every 5 seconds with the staff
//   access token; a Supabase Realtime subscription triggers instant
//   refetches as a bonus (polling is the guaranteed path).
// - New paid order => repeating voice alarm "New order! New order!" +
//   flashing red banner until staff tap it ("I see it — Accept").
// - Status buttons, 80mm ticket printing, auto-print toggle.

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/menu";
import { formatDenverTime } from "@/lib/hours";
import type { Session } from "@supabase/supabase-js";

interface KitchenOrder {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  items_json: { name: string; qty: number; line_total_cents: number }[];
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  delivery_fee_cents: number;
  tip_cents: number;
  total_cents: number;
  fulfillment: string;
  delivery_address: string | null;
  scheduled_for: string | null;
  payment_status: string;
  kitchen_status: string;
  shipday_order_id: string | null;
  shipday_status: string | null;
  created_at: string;
}

// One-tap flow (owner's request, 2026-11-16): no Accept / Preparing /
// Ready steps. Staff tap ONE button when the food is ready; the order is
// completed and leaves the board immediately.

function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return false;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.22;
      osc.start(start);
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.stop(start + 0.22);
    });
  } catch {
    /* audio is best-effort */
  }
}

function printTicket(order: KitchenOrder) {
  const win = window.open("", "_blank", "width=400,height=600");
  if (!win) return;
  const items = (order.items_json ?? [])
    .map((l) => `<div>${l.qty} x ${l.name} — ${formatCents(l.line_total_cents)}</div>`)
    .join("");
  win.document.write(`<!doctype html><html><head><title>Order #${order.id}</title>
    <style>body{font-family:monospace;width:72mm;margin:0 auto;padding:4mm}h1{text-align:center;font-size:28px;margin:2mm 0}
    .c{text-align:center}.row{display:flex;justify-content:space-between}.grand{font-size:18px;font-weight:bold}</style>
    </head><body>
    <div class="c">MADINAH MARKET</div>
    <h1>#${order.id}</h1>
    <div class="c">${order.fulfillment.toUpperCase()} · ${new Date(order.created_at).toLocaleString()}</div>
    ${order.scheduled_for ? `<div class="c" style="font-size:20px;font-weight:bold">⏰ PICKUP AT ${formatDenverTime(order.scheduled_for)}</div>` : ""}
    <hr/>
    <div>${order.customer_name ?? ""} · ${order.customer_phone ?? ""}</div>
    ${order.fulfillment === "delivery" ? `<div><strong>DELIVERY:</strong> ${order.delivery_address ?? ""}</div>` : ""}
    <hr/>${items}<hr/>
    <div class="row"><span>Subtotal</span><span>${formatCents(order.subtotal_cents)}</span></div>
    ${order.discount_cents > 0 ? `<div class="row"><span>Loyalty discount</span><span>-${formatCents(order.discount_cents)}</span></div>` : ""}
    <div class="row"><span>Tax</span><span>${formatCents(order.tax_cents)}</span></div>
    ${order.delivery_fee_cents > 0 ? `<div class="row"><span>Delivery fee</span><span>${formatCents(order.delivery_fee_cents)}</span></div>` : ""}
    ${order.tip_cents > 0 ? `<div class="row"><span>Tip</span><span>${formatCents(order.tip_cents)}</span></div>` : ""}
    <div class="row grand"><span>TOTAL</span><span>${formatCents(order.total_cents)}</span></div>
    <script>window.onload=()=>{window.print();}</script>
    </body></html>`);
  win.document.close();
}

export default function KitchenBoard({ testMode }: { testMode: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [alertsOn, setAlertsOn] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [alarming, setAlarming] = useState(false);
  const seenPaidRef = useRef<Set<number>>(new Set());
  const ackedRef = useRef<Set<number>>(new Set());
  const alarmTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstLoadRef = useRef(true);

  // ---- auth ---------------------------------------------------------------
  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setAlertsOn(localStorage.getItem("madinah_alerts_on") === "1");
    setAutoPrint(localStorage.getItem("madinah_autoprint") === "1");
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const supabase = getBrowserClient();
    if (!supabase) return setLoginError("Supabase is not configured on this site yet.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError("Login failed — check the email and password.");
  }

  async function logout() {
    const supabase = getBrowserClient();
    await supabase?.auth.signOut();
    setOrders([]);
  }

  // ---- order feed -----------------------------------------------------------
  const fetchOrders = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/kitchen/orders", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { orders: KitchenOrder[] };
      const list = data.orders ?? [];
      setOrders(list);

      // Alarm + auto-print for newly seen PAID orders still in "new".
      const fresh = list.filter(
        (o) =>
          (o.payment_status === "paid" || o.payment_status === "test_paid") &&
          !seenPaidRef.current.has(o.id)
      );
      for (const o of list) {
        if (o.payment_status === "paid" || o.payment_status === "test_paid") {
          seenPaidRef.current.add(o.id);
        }
      }
      if (!firstLoadRef.current && fresh.length > 0) {
        if (autoPrint) fresh.forEach((o) => printTicket(o));
        const needsAlarm = fresh.some(
          (o) => o.kitchen_status === "new" && !ackedRef.current.has(o.id)
        );
        if (needsAlarm && alertsOn) setAlarming(true);
      }
      firstLoadRef.current = false;

      // Auto-stop: nothing unacknowledged in "new" anymore.
      const anyUnackedNew = list.some(
        (o) =>
          (o.payment_status === "paid" || o.payment_status === "test_paid") &&
          o.kitchen_status === "new" &&
          !ackedRef.current.has(o.id)
      );
      if (!anyUnackedNew) setAlarming(false);
    } catch {
      /* next poll retries */
    }
  }, [session, alertsOn, autoPrint]);

  useEffect(() => {
    if (!session) return;
    fetchOrders();
    const poll = setInterval(fetchOrders, 5000);
    const supabase = getBrowserClient();
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
    if (supabase) {
      channel = supabase
        .channel("kitchen-orders")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
          fetchOrders();
        })
        .subscribe();
    }
    return () => {
      clearInterval(poll);
      if (supabase && channel) supabase.removeChannel(channel);
    };
  }, [session, fetchOrders]);

  // ---- alarm loop -----------------------------------------------------------
  useEffect(() => {
    if (alarming) {
      const ring = () => {
        if (!speak("New order! New order!")) chime();
      };
      ring();
      alarmTimer.current = setInterval(ring, 2600);
    }
    return () => {
      if (alarmTimer.current) clearInterval(alarmTimer.current);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [alarming]);

  async function setStatus(order: KitchenOrder, status: string) {
    if (!session) return;
    if (status === "accepted" || status === "completed") ackedRef.current.add(order.id);
    await fetch("/api/kitchen/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ order_id: order.id, status }),
    }).catch(() => undefined);
    fetchOrders();
  }

  async function acceptAlarming() {
    const targets = orders.filter(
      (o) =>
        (o.payment_status === "paid" || o.payment_status === "test_paid") &&
        o.kitchen_status === "new" &&
        !ackedRef.current.has(o.id)
    );
    setAlarming(false);
    for (const o of targets) {
      ackedRef.current.add(o.id);
      await setStatus(o, "accepted");
    }
  }

  function turnOnAlerts() {
    setAlertsOn(true);
    localStorage.setItem("madinah_alerts_on", "1");
    // One spoken phrase inside the tap unlocks audio for later alarms.
    speak("Order alerts are on.");
  }

  // ---- render ---------------------------------------------------------------
  if (!authReady) {
    return (
      <div className="kitchen-body">
        <div className="kitchen-wrap">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="kitchen-body">
        <form className="k-login" onSubmit={login}>
          <h1 style={{ color: "var(--gold-soft)", marginTop: 0 }}>🍳 Kitchen Login</h1>
          <p>Madinah Market staff only.</p>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {loginError && <p style={{ color: "#fca5a5" }}>{loginError}</p>}
          <button type="submit">Log in</button>
        </form>
      </div>
    );
  }

  // Active board: completed orders LEAVE the main list as soon as they are
  // completed (staff request) and move to the "Completed today" section
  // below; cancelled orders stay hidden entirely.
  const visible = orders.filter(
    (o) => o.kitchen_status !== "cancelled" && o.kitchen_status !== "completed"
  );
  const doneToday = orders.filter((o) => o.kitchen_status === "completed");

  return (
    <div className="kitchen-body">
      <div className="kitchen-wrap">
        <div className="kitchen-head">
          <h1>🍳 Kitchen — Madinah Market {testMode && <span style={{ color: "#fca5a5" }}>(TEST MODE)</span>}</h1>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {!alertsOn && (
              <button type="button" className="k-btn warn" onClick={turnOnAlerts}>
                🔊 Turn on order alerts
              </button>
            )}
            <label className="k-btn" style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={autoPrint}
                onChange={(e) => {
                  setAutoPrint(e.target.checked);
                  localStorage.setItem("madinah_autoprint", e.target.checked ? "1" : "0");
                }}
              />
              Auto-print new orders
            </label>
            <a className="k-btn" href="/admin" style={{ textDecoration: "none" }}>
              ⚙️ Admin
            </a>
            <button type="button" className="k-btn" onClick={logout}>
              Log out
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`alarm-banner${alarming ? " on" : ""}`}
          onClick={acceptAlarming}
        >
          🔔 NEW ORDER! — tap: I see it — Accept
        </button>

        {visible.length === 0 && <p style={{ marginTop: "1.5rem" }}>No active orders.</p>}

        <div className="k-grid">
          {visible.map((o) => {
            return (
              <article className={`k-card${o.kitchen_status === "new" ? " is-new" : ""}`} key={o.id}>
                <h2>
                  #{o.id}{" "}
                  <span className={`k-badge ${o.fulfillment === "delivery" ? "delivery" : "pickup"}`}>
                    {o.fulfillment === "delivery" ? "🛵 DELIVERY" : "🏃 PICKUP"}
                  </span>
                  <span className={`k-badge ${o.payment_status === "unpaid" ? "unpaid" : "paid"}`}>
                    {o.payment_status === "test_paid"
                      ? "TEST PAID"
                      : o.payment_status.toUpperCase()}
                  </span>
                </h2>
                <div>
                  {o.customer_name ?? ""} · {o.customer_phone ?? ""}
                </div>
                <div style={{ color: "#cbbfa8", fontSize: "0.95rem" }}>
                  {new Date(o.created_at).toLocaleTimeString()} · status: {o.kitchen_status}
                </div>
                {o.scheduled_for && (
                  <div
                    style={{
                      marginTop: "0.3rem",
                      background: "#f59e0b",
                      color: "#1a1207",
                      fontWeight: 800,
                      borderRadius: 8,
                      padding: "0.25rem 0.6rem",
                      display: "inline-block",
                    }}
                  >
                    ⏰ PICKUP AT {formatDenverTime(o.scheduled_for)}
                  </div>
                )}
                {o.fulfillment === "delivery" && (
                  <div style={{ marginTop: "0.3rem" }}>
                    📍 {o.delivery_address ?? ""}
                    <br />
                    Shipday:{" "}
                    {o.shipday_order_id
                      ? `sent #${o.shipday_order_id} · ${o.shipday_status ?? ""}`
                      : (o.shipday_status ?? "not sent")}
                  </div>
                )}
                <ul className="k-items">
                  {(o.items_json ?? []).map((l, i) => (
                    <li key={i}>
                      {l.qty} × {l.name} — {formatCents(l.line_total_cents)}
                    </li>
                  ))}
                </ul>
                <div className="k-money">
                  <div className="row">
                    <span>Subtotal</span>
                    <span>{formatCents(o.subtotal_cents)}</span>
                  </div>
                  {o.discount_cents > 0 && (
                    <div className="row">
                      <span>⭐ Loyalty discount</span>
                      <span>−{formatCents(o.discount_cents)}</span>
                    </div>
                  )}
                  <div className="row">
                    <span>Tax</span>
                    <span>{formatCents(o.tax_cents)}</span>
                  </div>
                  {o.delivery_fee_cents > 0 && (
                    <div className="row">
                      <span>Delivery fee</span>
                      <span>{formatCents(o.delivery_fee_cents)}</span>
                    </div>
                  )}
                  {o.tip_cents > 0 && (
                    <div className="row">
                      <span>Tip</span>
                      <span>{formatCents(o.tip_cents)}</span>
                    </div>
                  )}
                  <div className="row grand">
                    <span>TOTAL</span>
                    <span>{formatCents(o.total_cents)}</span>
                  </div>
                </div>
                <div className="k-actions">
                  <button type="button" onClick={() => setStatus(o, "completed")}>
                    ✔ READY — Done
                  </button>
                  <button type="button" className="secondary" onClick={() => printTicket(o)}>
                    🖨 Print ticket
                  </button>
                  <button type="button" className="danger" onClick={() => setStatus(o, "cancelled")}>
                    Cancel order
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {doneToday.length > 0 && (
          <details style={{ marginTop: "2rem" }}>
            <summary style={{ cursor: "pointer", color: "#cbbfa8", fontWeight: 700 }}>
              ✔ Completed today ({doneToday.length}) — tap to view
            </summary>
            <div style={{ marginTop: "0.6rem", color: "#cbbfa8" }}>
              {doneToday.map((o) => (
                <div
                  key={o.id}
                  style={{ padding: "0.35rem 0", borderBottom: "1px dashed #444" }}
                >
                  #{o.id} · {o.customer_name ?? ""} ·{" "}
                  {o.fulfillment === "delivery" ? "🛵 Delivery" : "🏃 Pickup"} ·{" "}
                  {formatCents(o.total_cents)} ·{" "}
                  {new Date(o.created_at).toLocaleTimeString()}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
