"use client";

// Madinah Market storefront: menu, cart (localStorage), pickup/delivery
// toggle, live delivery-fee quote, tip selector, live price breakdown and
// checkout. The server recomputes every total — the numbers here are only
// for display.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatCents, type MenuItem } from "@/lib/menu";
import { getBrowserClient } from "@/lib/supabase/client";
import {
  PICKUP_HOURS,
  DELIVERY_HOURS,
  DEFAULT_HOURS_CONFIG,
  pickupWindows,
  deliveryWindows,
  formatWindow,
  pickupWindowToday,
  denverParts,
  denverTimeTodayToISO,
  validatePickupTime,
  minutesToInputValue,
  type HoursConfig,
} from "@/lib/hours";

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

interface SiteState {
  settings: {
    ordering_enabled: boolean;
    pickup_enabled: boolean;
    delivery_enabled: boolean;
  };
  unavailable: string[];
  promotions: { id: number; title: string; body: string; item_id: string | null }[];
  photos: Record<string, string>;
  hours?: HoursConfig;
}

export default function Storefront({
  testMode,
  menu,
  categories,
}: {
  testMode: boolean;
  menu: MenuItem[];
  categories: string[];
}) {
  const [cart, setCart] = useState<Cart>({});
  const [cartLoaded, setCartLoaded] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [guestChosen, setGuestChosen] = useState(false);
  const [siOpen, setSiOpen] = useState(false);
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siBusy, setSiBusy] = useState(false);
  const [siError, setSiError] = useState("");
  // Loyalty (signed-in customers only).
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  // Admin-controlled site state (switches, sold-out dishes, promotions,
  // uploaded photos). Defaults keep the site fully open until loaded.
  const [siteState, setSiteState] = useState<SiteState | null>(null);
  // Scheduled pickup.
  const [pickupWhen, setPickupWhen] = useState<"asap" | "later">("asap");
  const [pickupTime, setPickupTime] = useState("");
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

  // Admin-controlled site state: switches, sold-out dishes, promotions,
  // uploaded dish photos. Loaded once; the site fails open (all ordering
  // on, everything available) if it cannot be reached.
  useEffect(() => {
    fetch("/api/admin")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SiteState | null) => {
        if (data) setSiteState(data);
      })
      .catch(() => {});
  }, []);

  const orderingClosed = siteState !== null && !siteState.settings.ordering_enabled;
  const pickupOff = siteState !== null && !siteState.settings.pickup_enabled;
  const deliveryOff = siteState !== null && !siteState.settings.delivery_enabled;
  const unavailableSet = new Set(siteState?.unavailable ?? []);
  const promos = siteState?.promotions ?? [];
  const dishPhotos = siteState?.photos ?? {};
  // Admin-editable hours (fall back to the built-in defaults until the
  // site state loads or if the server does not send them).
  const hoursCfg = siteState?.hours ?? DEFAULT_HOURS_CONFIG;
  const pickupWins = siteState?.hours ? pickupWindows(hoursCfg) : PICKUP_HOURS;
  const deliveryWins = siteState?.hours ? deliveryWindows(hoursCfg) : DELIVERY_HOURS;

  // If the admin turned the selected fulfillment type off, switch over.
  useEffect(() => {
    if (fulfillment === "pickup" && pickupOff && !deliveryOff) setFulfillment("delivery");
    if (fulfillment === "delivery" && deliveryOff && !pickupOff) setFulfillment("pickup");
  }, [fulfillment, pickupOff, deliveryOff]);

  // Load the signed-in customer's profile: greet them and prefill the
  // checkout form from their saved details (only into fields still empty).
  async function loadAccountFromToken(token: string) {
    try {
      const res = await fetch("/api/account/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const me = await res.json();
      const p = me.profile ?? {};
      setAccountName(p.display_name || me.email || "My account");
      setAccountEmail(me.email ?? null);
      if (p.display_name) {
        const parts = p.display_name.trim().split(/\s+/);
        setFirstName((prev) => prev || parts[0] || "");
        if (parts.length > 1)
          setLastName((prev) => prev || parts.slice(1).join(" "));
      }
      if (p.phone) setPhone((prev) => prev || p.phone);
      if (p.default_address) setAddress((prev) => prev || p.default_address);
      // Loyalty balance for the checkout points box (rides along with /me).
      if (me.points && typeof me.points.balance === "number") {
        setPointsBalance(me.points.balance);
      }
    } catch {
      /* guest checkout is unaffected */
    }
  }

  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return;
    client.auth
      .getSession()
      .then(async ({ data }) => {
        const token = data.session?.access_token;
        if (token) await loadAccountFromToken(token);
        // Returning from Google sign-in: re-open the checkout panel.
        try {
          if (token && sessionStorage.getItem("mm_open_checkout") === "1") {
            sessionStorage.removeItem("mm_open_checkout");
            setShowCheckout(true);
            setTimeout(
              () => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth" }),
              80
            );
          }
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sign in without leaving checkout (the "Sign in or continue as guest"
  // choice at the top of the checkout panel).
  async function inlineSignIn() {
    setSiError("");
    setSiBusy(true);
    try {
      const client = getBrowserClient();
      if (!client) throw new Error("Sign-in is not available right now.");
      const { data, error } = await client.auth.signInWithPassword({
        email: siEmail.trim(),
        password: siPassword,
      });
      if (error) throw new Error(error.message);
      const token = data.session?.access_token;
      if (token) await loadAccountFromToken(token);
      setSiOpen(false);
      setSiPassword("");
    } catch (e) {
      setSiError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
    } finally {
      setSiBusy(false);
    }
  }

  // Google sign-in leaves the site and comes back; remember to re-open
  // the checkout panel on return (the cart itself survives in localStorage).
  async function googleSignIn() {
    setSiError("");
    try {
      const client = getBrowserClient();
      if (!client) throw new Error("unavailable");
      try {
        sessionStorage.setItem("mm_open_checkout", "1");
      } catch {
        /* ignore */
      }
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw new Error(error.message);
    } catch {
      setSiError(
        "Google sign-in is not switched on yet — please use email sign-in or continue as guest."
      );
    }
  }

  async function inlineSignOut() {
    const client = getBrowserClient();
    if (client) await client.auth.signOut().catch(() => {});
    setAccountName(null);
    setAccountEmail(null);
    setGuestChosen(false);
    setPointsBalance(null);
    setUsePoints(false);
  }

  const lines = useMemo(() => {
    return menu.filter((m) => (cart[m.id] ?? 0) > 0).map((m) => ({
      item: m,
      qty: cart[m.id],
      line_total_cents: m.price_cents * cart[m.id],
    }));
  }, [cart, menu]);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  // Loyalty preview: whole 100-point blocks ($5.00 each), capped by the
  // subtotal. The server recomputes this authoritatively at checkout.
  const redeemBlocks =
    usePoints && pointsBalance !== null
      ? Math.min(Math.floor(pointsBalance / 100), Math.floor(subtotal / 500))
      : 0;
  const discountPreview = redeemBlocks * 500;
  const tax = taxFor(subtotal - discountPreview);
  const tipCustomCents = tipCustom ? Math.round(Number(tipCustom) * 100) : NaN;
  const tip =
    tipCustom && Number.isFinite(tipCustomCents)
      ? Math.min(Math.max(tipCustomCents, 0), 20000)
      : Math.round((subtotal * Math.min(Math.max(tipPercent, 0), 30)) / 100);
  const deliveryFee = fulfillment === "delivery" && fee.kind === "ok" ? fee.fee_cents : 0;
  const total = subtotal - discountPreview + tax + deliveryFee + tip;

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

  // Checkout is a two-step flow (Sami's spec): first the customer chooses
  // Sign in / Sign in with Google / Continue as guest — only then does the
  // details form (name, phone, tip…) appear, prefilled when signed in.
  const formOpen = !!accountEmail || guestChosen;
  const fullName = `${firstName} ${lastName}`.trim();

  async function placeOrder() {
    setError("");
    if (lines.length === 0) return setError("Your cart is empty.");
    if (fullName.length < 2) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 7) return setError("Please enter your phone number.");
    if (fulfillment === "delivery" && fee.kind !== "ok") {
      return setError("Please enter a delivery address inside our delivery area first.");
    }
    // Scheduled pickup ("pickup for later") — validated again on the server.
    let scheduledFor: string | undefined;
    if (fulfillment === "pickup" && pickupWhen === "later") {
      const iso = pickupTime ? denverTimeTodayToISO(pickupTime) : null;
      if (!iso) return setError("Please choose a pickup time.");
      const problem = validatePickupTime(iso, new Date(), hoursCfg);
      if (problem) return setError(problem);
      scheduledFor = iso;
    }
    setPlacing(true);
    try {
      // Attach the account session (if any) so the order is saved to the
      // customer's history. Guests send no header and stay anonymous.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const client = getBrowserClient();
        const { data } = client ? await client.auth.getSession() : { data: { session: null } };
        const token = data.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        /* proceed as guest */
      }
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: lines.map((l) => ({ id: l.item.id, qty: l.qty })),
          customer_name: fullName,
          customer_phone: phone.trim(),
          fulfillment,
          delivery_address: fulfillment === "delivery" ? address.trim() : undefined,
          note: note.trim() || undefined,
          ...(tipCustom && Number.isFinite(tipCustomCents)
            ? { tip_custom_cents: tipCustomCents }
            : { tip_percent: tipPercent }),
          ...(usePoints ? { use_points: true } : {}),
          ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
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
          <Link href="/account">{accountName ? `👤 ${accountName}` : "👤 Log in"}</Link>
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

      {orderingClosed && (
        <div className="closed-banner">
          🔴 Online ordering is closed right now — please call us at{" "}
          <a href="tel:+17207630786">720-763-0786</a>. You can still browse the menu.
        </div>
      )}

      {promos.map((p) => {
        const dish = p.item_id ? menu.find((m) => m.id === p.item_id) : null;
        return (
          <div className="promo-box" key={p.id}>
            {dish && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dishPhotos[dish.id] ?? dish.image} alt={dish.name} />
            )}
            <div className="promo-text">
              <strong>🎁 {p.title}</strong>
              {p.body && <span>{p.body}</span>}
              {dish && (
                <span className="promo-dish">
                  {dish.name} · {formatCents(dish.price_cents)}
                </span>
              )}
            </div>
          </div>
        );
      })}

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

        {categories.map((category) => (
          <section key={category}>
            <h2 className="category-title">{category}</h2>
            <div className="menu-grid">
              {menu.filter((m) => m.category === category).map((m) => {
                const qty = cart[m.id] ?? 0;
                const soldOut = unavailableSet.has(m.id);
                return (
                  <article className="card" key={m.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={dishPhotos[m.id] ?? m.image}
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
                        {soldOut ? (
                          <>
                            <span className="soldout-badge">Sold out</span>
                            {qty > 0 && (
                              <span className="qty-controls">
                                <button type="button" onClick={() => setQty(m, qty - 1)} aria-label="Remove one">
                                  −
                                </button>
                                <span className="count">{qty}</span>
                              </span>
                            )}
                          </>
                        ) : orderingClosed && qty === 0 ? (
                          <button type="button" className="add-btn" disabled>
                            Closed
                          </button>
                        ) : qty === 0 ? (
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

            {!formOpen ? (
              <div className="auth-box">
                <strong>Sign in or continue as guest</strong>
                <div className="toggle-row">
                  <button
                    type="button"
                    className={siOpen ? "active" : ""}
                    onClick={() => setSiOpen(true)}
                  >
                    🔑 Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGuestChosen(true);
                      setSiOpen(false);
                    }}
                  >
                    👤 Continue as guest
                  </button>
                </div>
                <button type="button" className="google-btn" onClick={googleSignIn}>
                  Sign in with Google
                </button>
                {siOpen && (
                  <div>
                    <div className="field">
                      <label htmlFor="si-email">Email</label>
                      <input
                        id="si-email"
                        type="email"
                        value={siEmail}
                        onChange={(e) => setSiEmail(e.target.value)}
                        autoComplete="email"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="si-password">Password</label>
                      <input
                        id="si-password"
                        type="password"
                        value={siPassword}
                        onChange={(e) => setSiPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                    </div>
                    {siError && <div className="fee-msg err">{siError}</div>}
                    <button
                      type="button"
                      className="checkout-btn"
                      disabled={siBusy || !siEmail || !siPassword}
                      onClick={inlineSignIn}
                    >
                      {siBusy ? "Signing in…" : "Sign in & continue"}
                    </button>
                    <div className="fee-msg">
                      New here? <Link href="/account">Create an account</Link> — it takes 30
                      seconds.
                    </div>
                  </div>
                )}
              </div>
            ) : accountEmail ? (
              <div className="auth-box">
                <div className="fee-msg ok">
                  ✓ Signed in as {accountEmail} — your saved details are filled in below, and
                  this order will be saved to your account.
                </div>
                <button type="button" className="auth-link" onClick={inlineSignOut}>
                  Not you? Log out
                </button>
              </div>
            ) : (
              <div className="auth-box">
                <span>👤 Checking out as guest · </span>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => setGuestChosen(false)}
                >
                  ← Back
                </button>
              </div>
            )}

            {formOpen && (
              <>
            <div className="toggle-row">
              <button
                type="button"
                className={fulfillment === "pickup" ? "active" : ""}
                onClick={() => setFulfillment("pickup")}
                disabled={pickupOff}
              >
                🏃 Pickup{pickupOff ? " (off)" : ""}
              </button>
              <button
                type="button"
                className={fulfillment === "delivery" ? "active" : ""}
                onClick={() => setFulfillment("delivery")}
                disabled={deliveryOff}
              >
                🛵 Delivery{deliveryOff ? " (off)" : ""}
              </button>
            </div>
            <div className="fee-msg">
              {fulfillment === "pickup"
                ? `Pickup today: ${formatWindow(pickupWins[denverParts(new Date()).dayIndex])}`
                : `Delivery today: ${formatWindow(deliveryWins[denverParts(new Date()).dayIndex])}`}
            </div>

            {fulfillment === "pickup" && (
              <div className="field">
                <label>Pickup time</label>
                <div className="toggle-row">
                  <button
                    type="button"
                    className={pickupWhen === "asap" ? "active" : ""}
                    onClick={() => setPickupWhen("asap")}
                  >
                    ⚡ As soon as possible
                  </button>
                  <button
                    type="button"
                    className={pickupWhen === "later" ? "active" : ""}
                    onClick={() => setPickupWhen("later")}
                  >
                    ⏰ Later today
                  </button>
                </div>
                {pickupWhen === "later" && (
                  <>
                    <input
                      type="time"
                      value={pickupTime}
                      min={minutesToInputValue(pickupWindowToday(new Date(), hoursCfg).open)}
                      max={minutesToInputValue(pickupWindowToday(new Date(), hoursCfg).close)}
                      onChange={(e) => setPickupTime(e.target.value)}
                    />
                    <div className="fee-msg">
                      Pick any time today inside pickup hours (
                      {formatWindow(pickupWindowToday(new Date(), hoursCfg))}) — e.g. in 2 or 3 hours.
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="field">
              <label htmlFor="co-first">First name</label>
              <input
                id="co-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div className="field">
              <label htmlFor="co-last">Last name</label>
              <input
                id="co-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
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

            {accountEmail && pointsBalance !== null && (
              <div className="auth-box">
                {pointsBalance >= 100 ? (
                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={usePoints}
                      onChange={(e) => setUsePoints(e.target.checked)}
                    />
                    <span>
                      ⭐ Use my points — you have <strong>{pointsBalance} pts</strong>
                      {redeemBlocks > 0 && usePoints
                        ? ` · ${formatCents(discountPreview)} off applied`
                        : ` · ${formatCents(Math.min(Math.floor(pointsBalance / 100) * 500, Math.floor(subtotal / 500) * 500))} off available`}
                    </span>
                  </label>
                ) : (
                  <span>
                    ⭐ You have <strong>{pointsBalance} points</strong> — earn{" "}
                    {100 - pointsBalance} more for $5.00 off.
                  </span>
                )}
              </div>
            )}

            <div className="breakdown">
              <div className="row">
                <span>Subtotal</span>
                <span>{formatCents(subtotal)}</span>
              </div>
              {discountPreview > 0 && (
                <div className="row">
                  <span>⭐ Loyalty discount ({redeemBlocks * 100} pts)</span>
                  <span>−{formatCents(discountPreview)}</span>
                </div>
              )}
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
              disabled={placing || checkoutBlocked || orderingClosed || lines.length === 0}
              onClick={placeOrder}
            >
              {placing
                ? "Placing order…"
                : testMode
                  ? `Place ${fulfillment === "delivery" ? "Delivery" : "Pickup"} Order (TEST — no charge)`
                  : `Pay on Stripe & Place ${fulfillment === "delivery" ? "Delivery" : "Pickup"} Order`}
            </button>
              </>
            )}
          </section>
        )}
      </main>

      <footer className="site-footer">
        Madinah Market · 3126 S Parker Rd, Aurora, CO 80014 ·{" "}
        <a href="tel:+17207630786">720-763-0786</a>
        <br />
        🏃 Pickup: Mon–Sat {formatWindow(pickupWins[1])} · Sun {formatWindow(pickupWins[0])}
        <br />
        🛵 Delivery: Mon–Sat {formatWindow(deliveryWins[1])} · Sun {formatWindow(deliveryWins[0])}
        <br />
        100% Halal · Kabob, Turkish, Afghan Persian &amp; Middle Eastern
      </footer>

      {itemCount > 0 && !showCheckout && (
        <div className="cart-bar">
          <span className="total">
            🛒 {itemCount} item{itemCount === 1 ? "" : "s"} · {formatCents(subtotal)}
          </span>
          {orderingClosed ? (
            <span>🔴 Ordering closed</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowCheckout(true);
                setTimeout(() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth" }), 50);
              }}
            >
              Checkout →
            </button>
          )}
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
