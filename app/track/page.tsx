"use client";

// Customer order tracking. The customer enters the order number and the
// phone used at checkout; /api/track-order only returns the order when
// the phone's last 10 digits match. The page refreshes every 20 seconds
// and draws a friendly timeline for pickup or delivery.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/menu";

interface TrackedOrder {
  id: number;
  items: { name: string; qty: number; line_total_cents: number }[];
  subtotal_cents: number;
  tax_cents: number;
  delivery_fee_cents: number;
  tip_cents: number;
  total_cents: number;
  fulfillment: string;
  delivery_address: string | null;
  payment_status: string;
  kitchen_status: string;
  shipday_status: string | null;
  created_at: string;
}

function stepIndex(order: TrackedOrder): number {
  // Index of the last completed step on the timeline.
  const ks = order.kitchen_status;
  if (order.fulfillment === "delivery") {
    if (ks === "completed") return 3;
    const ship = (order.shipday_status ?? "").toLowerCase();
    if (ship.includes("deliver")) return 3;
    if (ks === "ready" || ship.includes("picked") || ship.includes("out_for") || ship.includes("transit")) return 2;
    if (ks === "preparing" || ks === "accepted") return 1;
    return 0;
  }
  switch (ks) {
    case "completed":
      return 3;
    case "ready":
      return 2;
    case "preparing":
    case "accepted":
      return 1;
    default:
      return 0;
  }
}

export default function TrackPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lookup = useCallback(
    async (id: string, ph: string, silent = false) => {
      if (!silent) setSearching(true);
      try {
        const res = await fetch("/api/track-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: Number(id), phone: ph }),
        });
        const data = await res.json();
        if (data.found) {
          setOrder(data.order as TrackedOrder);
          setMessage("");
        } else if (!silent) {
          setOrder(null);
          setMessage(
            "We couldn't find that order. Check the order number and use the same phone number you ordered with."
          );
        }
      } catch {
        if (!silent) setMessage("Something went wrong — please try again.");
      } finally {
        if (!silent) setSearching(false);
      }
    },
    []
  );

  // Prefill from ?order= (the storefront success banner links here).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get("order");
    if (o) setOrderId(o);
  }, []);

  // Auto-refresh every 20 seconds once an order is shown.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (order) {
      pollRef.current = setInterval(() => lookup(orderId, phone, true), 20000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [order, orderId, phone, lookup]);

  const steps =
    order?.fulfillment === "delivery"
      ? ["Order received", "Preparing", "Driver on the way", "Delivered"]
      : ["Order received", "Preparing", "Ready", "Picked up"];
  const current = order ? stepIndex(order) : -1;

  return (
    <>
      <header className="site-header">
        <h1>
          Madinah <span className="gold">Market</span>
        </h1>
        <p>Track your order</p>
      </header>
      <main className="simple-page">
        <h1>📦 Where is my order?</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(orderId, phone);
          }}
        >
          <div className="field">
            <label htmlFor="t-order">Order number</label>
            <input
              id="t-order"
              inputMode="numeric"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="e.g. 12"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="t-phone">Phone number used at checkout</label>
            <input
              id="t-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 720-763-0786"
              required
            />
          </div>
          <button type="submit" className="checkout-btn" disabled={searching}>
            {searching ? "Looking…" : "Track order"}
          </button>
        </form>

        {message && <p className="form-error">{message}</p>}

        {order && (
          <section className="panel">
            <h3>
              Order #{order.id} — {order.fulfillment === "delivery" ? "🛵 Delivery" : "🏃 Pickup"}
            </h3>
            {order.kitchen_status === "cancelled" ? (
              <p className="form-error">This order was cancelled. Please call us: 720-763-0786.</p>
            ) : (
              <ul className="timeline">
                {steps.map((label, i) => (
                  <li key={label} className={i < current ? "done" : i === current ? "now" : ""}>
                    <span className="dot">{i < current ? "✓" : i + 1}</span>
                    <span>
                      {label}
                      {order.fulfillment === "delivery" && i === 2 && order.shipday_status && (
                        <span style={{ display: "block", fontWeight: 400, fontSize: "0.9rem" }}>
                          {order.shipday_status}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(order.items ?? []).map((l, i) => (
              <div className="cart-line" key={i}>
                <span>
                  {l.qty} × {l.name}
                </span>
                <span>{formatCents(l.line_total_cents)}</span>
              </div>
            ))}
            <div className="breakdown">
              <div className="row">
                <span>Subtotal</span>
                <span>{formatCents(order.subtotal_cents)}</span>
              </div>
              <div className="row">
                <span>Tax</span>
                <span>{formatCents(order.tax_cents)}</span>
              </div>
              {order.delivery_fee_cents > 0 && (
                <div className="row">
                  <span>Delivery fee</span>
                  <span>{formatCents(order.delivery_fee_cents)}</span>
                </div>
              )}
              {order.tip_cents > 0 && (
                <div className="row">
                  <span>Tip</span>
                  <span>{formatCents(order.tip_cents)}</span>
                </div>
              )}
              <div className="row grand">
                <span>TOTAL</span>
                <span>{formatCents(order.total_cents)}</span>
              </div>
            </div>
            {order.fulfillment === "delivery" && order.delivery_address && (
              <p style={{ color: "var(--muted)" }}>Delivering to: {order.delivery_address}</p>
            )}
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              This page refreshes automatically every 20 seconds.
            </p>
          </section>
        )}

        <p style={{ marginTop: "1.5rem" }}>
          <Link href="/">← Back to the menu</Link>
        </p>
      </main>
    </>
  );
}
