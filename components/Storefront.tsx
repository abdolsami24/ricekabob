"use client";

// Madinah Market storefront: menu, cart (localStorage), pickup/delivery
// toggle, live delivery-fee quote, tip selector, live price breakdown and
// checkout. The server recomputes every total — the numbers here are only
// for display.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CATEGORIES, MENU, formatCents, type MenuItem } from "@/lib/menu";

const CART_KEY = "madinah_cart_v1";
type Cart = Record<string, number>;
type FeeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; fee_cents: number; label: string }
  | { kind: "far" }
  | { kind: "not_found" };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function taxFor(subtotal: number): number {
  return Math.round(subtotal * 0.08);
}

export default function Storefront({ testMode }: { testMode: boolean }) {
  const [cart, setCart] = useState<Cart>({});
  const [cartLoaded, setCartLoaded] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [fee, setFee] = useState<FeeState>({ kind: "idle" });
  const [tipPercent, setTipPercent] = useState(0);
  const [tipCustom, setTipCustom] = useState("");
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [successOrder, setSuccessOrder] = useState<number | null>(null);
  const [qrSource, setQrSource] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const feeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feeSeq = useRef(0);

  // Load cart + URL state once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw) as Cart);
    } catch {
      /* ignore */
    }
    setCartLoaded(true);
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") === "qr") setQrSource(true);
    const orderParam = Number(params.get("order"));
    if (orderParam && params.get("paid") === "1") {
      setSuccessOrder(orderParam);
      setCart({});
      localStorage.removeItem(CART_KEY);
    }
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    if (cartLoaded) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart, cartLoaded]);

  const lines = useMemo(() => {
    return MENU.filter((m) => (cart[m.id] ?? 0) > 0).map((m) => ({
      item: m,
      qty: cart[m.id],
      line_total_cents: m.price_cents * cart[m.id],
    }));
  }, [cart]);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  const tax = taxFor(subtotal);
  const tipCustomCents = tipCustom ? Math.round(Number(tipCustom) * 100) : NaN;
  const tip =
    tipCustom && Number.isFinite(tipCustomCents)
      ? Math.min(Math.max(tipCustomCents, 0), 20000)
      : Math.round((subtotal * Math.min(Math.max(tipPercent, 0), 30)) / 100);
  const deliveryFee = fulfillment === "delivery" && fee.kind === "ok" ? fee.fee_cents : 0;
  const total = subtotal + tax + deliveryFee + tip;

  const setQty = useCallback((item: MenuItem, qty: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[item.id];
      else next[item.id] = Math.min(qty, 50);
      return next;
    });
  }, []);

  // Debounced delivery-fee quote while the address is typed.
  useEffect(() => {
    if (fulfillment !== "delivery") return;
    if (feeTimer.current) clearTimeout(feeTimer.current);
    const trimmed = address.trim();
    if (trimmed.length < 6) {
      setFee({ kind: "idle" });
      return;
    }
    setFee({ kind: "loading" });
    const seq = ++feeSeq.current;
    feeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/delivery-fee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: trimmed }),
        });
        const data = await res.json();
        if (seq !== feeSeq.current) return; // a newer quote is in flight
        if (data.error === "far") setFee({ kind: "far" });
        else if (data.error) setFee({ kind: "not_found" });
        else setFee({ kind: "ok", fee_cents: data.fee_cents, label: data.label });
      } catch {
        if (seq === feeSeq.current) setFee({ kind: "not_found" });
      }
    }, 700);
    return () => {
      if (feeTimer.current) clearTimeout(feeTimer.current);
    };
  }, [address, fulfillment]);

  const checkoutBlocked =
    fulfillment === "delivery" && fee.kind !== "ok";

  async function placeOrder() {
    setError("");
    if (lines.length === 0) return setError("Your cart is empty.");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 7) return setError("Please enter your phone number.");
    if (fulfillment === "delivery" && fee.kind !== "ok") {
      return setError("Please enter a delivery address inside our delivery area first.");
    }
    setPlacing(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ id: l.item.id, qty: l.qty })),
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          fulfillment,
          delivery_address: fulfillment === "delivery" ? address.trim() : undefined,
          note: note.trim() || undefined,
          ...(tipCustom && Number.isFinite(tipCustomCents)
            ? { tip_custom_cents: tipCustomCents }
            : { tip_percent: tipPercent }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) {
        window.location.href = data.url as string;
        return;
      }
      if (data.test_mode) {
        const payRes = await fetch("/api/test-pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: data.order_id }),
        });
        if (!payRes.ok) throw new Error("Test payment failed");
        setSuccessOrder(data.order_id as number);
        setCart({});
        localStorage.removeItem(CART_KEY);
        setShowCheckout(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <span>📍 3126 S Parker Rd, Aurora, CO 80014</span>
        <a href="tel:+17207630786">📞 720-763-0786</a>
        <span>🕙 Mon–Thu 10–7:50 · Fri–Sat 10–8 · Sun 10–7</span>
      </div>

      <header className="site-header">
        <h1>
          Madinah <span className="gold">Market</span>
        </h1>
        <p>Halal Kabob · Turkish · Afghan Persian — Denver Halal</p>
        <span className="halal-badge">100% HALAL</span>
        <div className="header-actions">
          <Link href="/track">📦 Track order</Link>
          {installEvent && (
            <button
              type="button"
              onClick={async () => {
                await installEvent.prompt();
                setInstallEvent(null);
              }}
            >
              📲 Install app
            </button>
          )}
        </div>
      </header>

      {testMode && (
        <div className="testmode-banner">
          TEST MODE — no real payment is taken. Orders are marked “test paid”.
        </div>
      )}

      <div className="hero">
        <h2>Delicious Kabobs, Gyros &amp; More</h2>
        <p>Order pickup or delivery — platters from $11.75, sandwiches from $8.99.</p>
        {qrSource && (
          <div className="qr-note">👋 Order here — no app download needed. Pay online, we’ll handle the rest.</div>
        )}
      </div>

      <main className="wrap">
        {successOrder !== null && (
          <div className="success-banner">
            ✅ <strong>Order #{successOrder} received!</strong> Thank you — we are on it.
            <br />
            <Link href={`/track?order=${successOrder}`}>Track your order →</Link>
          </div>
        )}

        {CATEGORIES.map((category) => (
          <section key={category}>
            <h2 className="category-title">{category}</h2>
            <div className="menu-grid">
              {MENU.filter((m) => m.category === category).map((m) => {
                const qty = cart[m.id] ?? 0;
                return (
                  <article className="card" key={m.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.image}
                      alt={m.name}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                    <div className="card-body">
                      <h3>
                        {m.number && <span className="num">{m.number}</span>}
                        {m.name}
                      </h3>
                      <p>{m.description}</p>
                      <div className="price-row">
                        <span className="price">{formatCents(m.price_cents)}</span>
                        {qty === 0 ? (
                          <button type="button" className="add-btn" onClick={() => setQty(m, 1)}>
                            Add
                          </button>
                        ) : (
                          <span className="qty-controls">
                            <button type="button" onClick={() => setQty(m, qty - 1)} aria-label="Remove one">
                              −
                            </button>
                            <span className="count">{qty}</span>
                            <button type="button" onClick={() => setQty(m, qty + 1)} aria-label="Add one">
                              +
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {showCheckout && (
          <section className="panel" id="checkout">
            <h3>Your order</h3>
            {lines.map((l) => (
              <div className="cart-line" key={l.item.id}>
                <span>
                  {l.qty} × {l.item.name}
                </span>
                <span>{formatCents(l.line_total_cents)}</span>
              </div>
            ))}

            <div className="toggle-row">
              <button
                type="button"
                className={fulfillment === "pickup" ? "active" : ""}
                onClick={() => setFulfillment("pickup")}
              >
                🏃 Pickup
              </button>
              <button
                type="button"
                className={fulfillment === "delivery" ? "active" : ""}
                onClick={() => setFulfillment("delivery")}
              >
                🛵 Delivery
              </button>
            </div>

            <div className="field">
              <label htmlFor="co-name">Your name</label>
              <input id="co-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="co-phone">Phone number</label>
              <input
                id="co-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                inputMode="tel"
              />
            </div>

            {fulfillment === "delivery" ? (
              <div className="field">
                <label htmlFor="co-address">Delivery address</label>
                <input
                  id="co-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address, city, ZIP"
                  autoComplete="street-address"
                />
                {fee.kind === "loading" && <div className="fee-msg">Checking delivery fee…</div>}
                {fee.kind === "ok" && (
                  <div className="fee-msg ok">
                    ✅ Delivery fee {formatCents(fee.fee_cents)} — {fee.label}
                  </div>
                )}
                {fee.kind === "far" && (
                  <div className="fee-msg err">
                    Sorry — that address is more than 4 miles away. Delivery is not available there; please choose pickup.
                  </div>
                )}
                {fee.kind === "not_found" && (
                  <div className="fee-msg err">We could not find that address — please check it.</div>
                )}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="co-note">Pickup note (optional)</label>
                <input
                  id="co-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. ready in 20 minutes"
                />
              </div>
            )}

            <div className="field">
              <label>Add a tip (thank you!)</label>
              <div className="tip-row">
                {[0, 10, 15, 20].map((pct) => (
                  <button
                    type="button"
                    key={pct}
                    className={!tipCustom && tipPercent === pct ? "active" : ""}
                    onClick={() => {
                      setTipPercent(pct);
                      setTipCustom("");
                    }}
                  >
                    {pct === 0 ? "No tip" : `${pct}%`}
                  </button>
                ))}
              </div>
              <input
                className="tip-custom"
                type="number"
                min="0"
                step="0.5"
                placeholder="Custom $"
                value={tipCustom}
                onChange={(e) => setTipCustom(e.target.value)}
              />
            </div>

            <div className="breakdown">
              <div className="row">
                <span>Subtotal</span>
                <span>{formatCents(subtotal)}</span>
              </div>
              <div className="row">
                <span>Sales tax (8%)</span>
                <span>{formatCents(tax)}</span>
              </div>
              {fulfillment === "delivery" && (
                <div className="row">
                  <span>Delivery fee</span>
                  <span>{fee.kind === "ok" ? formatCents(deliveryFee) : "—"}</span>
                </div>
              )}
              {tip > 0 && (
                <div className="row">
                  <span>Tip</span>
                  <span>{formatCents(tip)}</span>
                </div>
              )}
              <div className="row grand">
                <span>TOTAL</span>
                <span>{formatCents(total)}</span>
              </div>
            </div>

            {error && <div className="form-error">{error}</div>}
            <button
              type="button"
              className="checkout-btn"
              disabled={placing || checkoutBlocked || lines.length === 0}
              onClick={placeOrder}
            >
              {placing
                ? "Placing order…"
                : testMode
                  ? `Place ${fulfillment === "delivery" ? "Delivery" : "Pickup"} Order (TEST — no charge)`
                  : `Pay on Stripe & Place ${fulfillment === "delivery" ? "Delivery" : "Pickup"} Order`}
            </button>
          </section>
        )}
      </main>

      <footer className="site-footer">
        Madinah Market · 3126 S Parker Rd, Aurora, CO 80014 ·{" "}
        <a href="tel:+17207630786">720-763-0786</a>
        <br />
        100% Halal · Kabob, Turkish, Afghan Persian &amp; Middle Eastern
      </footer>

      {itemCount > 0 && !showCheckout && (
        <div className="cart-bar">
          <span className="total">
            🛒 {itemCount} item{itemCount === 1 ? "" : "s"} · {formatCents(subtotal)}
          </span>
          <button
            type="button"
            onClick={() => {
              setShowCheckout(true);
              setTimeout(() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
          >
            Checkout →
          </button>
        </div>
      )}
      {showCheckout && (
        <div className="cart-bar">
          <span className="total">Total {formatCents(total)}</span>
          <button type="button" onClick={() => setShowCheckout(false)}>
            ← Back to menu
          </button>
        </div>
      )}
    </>
  );
}
