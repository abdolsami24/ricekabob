"use client";

// /admin — staff-only control panel (same login as the kitchen):
// - Ordering switches: whole system / pickup / delivery on-off
// - Dish availability (sold out) + dish photo uploads
// - Add categories and menu items (database menu)
// - Homepage promotions: add, show/hide, delete
// All changes go through /api/admin with the staff token and apply
// to the live site immediately.

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatCents, type MenuItem } from "@/lib/menu";

interface Promotion {
  id: number;
  title: string;
  body: string;
  active: boolean;
  item_id: string | null;
}

interface AdminState {
  settings: {
    ordering_enabled: boolean;
    pickup_enabled: boolean;
    delivery_enabled: boolean;
  };
  unavailable: string[];
  promotions: Promotion[];
  photos: Record<string, string>;
  menu: { categories: string[]; items: MenuItem[] };
}

export default function AdminPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [state, setState] = useState<AdminState | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Promotion form
  const [promoTitle, setPromoTitle] = useState("");
  const [promoBody, setPromoBody] = useState("");
  const [promoItemId, setPromoItemId] = useState("");
  // Category form
  const [newCategory, setNewCategory] = useState("");
  // Dish form
  const [dishName, setDishName] = useState("");
  const [dishDesc, setDishDesc] = useState("");
  const [dishPrice, setDishPrice] = useState("");
  const [dishCategory, setDishCategory] = useState("");
  const [dishNumber, setDishNumber] = useState("");

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadState = useCallback(async (token: string) => {
    const res = await fetch("/api/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as AdminState & { staff?: boolean };
      if (data.staff) setState(data);
    }
  }, []);

  useEffect(() => {
    if (session?.access_token) loadState(session.access_token);
    else setState(null);
  }, [session, loadState]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const supabase = getBrowserClient();
    if (!supabase) return setLoginError("Supabase is not configured on this site yet.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError("Login failed — check the email and password.");
  }

  async function act(body: Record<string, unknown>, okText: string) {
    if (!session?.access_token) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setState(data as AdminState);
      setMsg(okText);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
    setBusy(false);
  }

  async function uploadPhoto(itemId: string, file: File) {
    if (!session?.access_token) return;
    setBusy(true);
    setMsg("");
    try {
      const form = new FormData();
      form.set("item_id", itemId);
      form.set("file", file);
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setState(data as AdminState);
      setMsg("📷 Photo updated.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed.");
    }
    setBusy(false);
  }

  if (!authReady) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="page">
        <section className="panel">
          <h3>⚙️ Admin — staff login</h3>
          <p>Use the same email and password as the kitchen screen.</p>
          <form onSubmit={login}>
            <div className="field">
              <label htmlFor="ad-email">Email</label>
              <input
                id="ad-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="ad-password">Password</label>
              <input
                id="ad-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {loginError && <div className="form-error">{loginError}</div>}
            <button type="submit" className="checkout-btn">
              Log in
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="page">
        <p>Loading admin… (If this stays, this account is not staff.)</p>
      </main>
    );
  }

  const unavailableSet = new Set(state.unavailable);
  const switchRow = (
    label: string,
    key: "ordering_enabled" | "pickup_enabled" | "delivery_enabled"
  ) => {
    const on = state.settings[key];
    return (
      <div className="cart-line" key={key}>
        <span>
          {label}: <strong>{on ? "ON ✅" : "OFF 🔴"}</strong>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act({ action: "set_setting", key, value: !on }, `${label} is now ${!on ? "ON" : "OFF"}.`)
          }
        >
          Turn {on ? "OFF" : "ON"}
        </button>
      </div>
    );
  };

  return (
    <main className="page">
      <h2 className="category-title">⚙️ Admin panel</h2>
      {msg && <div className="fee-msg ok">{msg}</div>}

      <section className="panel">
        <h3>🔌 Ordering switches</h3>
        {switchRow("Online ordering (whole system)", "ordering_enabled")}
        {switchRow("Pickup", "pickup_enabled")}
        {switchRow("Delivery", "delivery_enabled")}
        <p style={{ color: "#8a7a5f" }}>
          Changes apply to the website immediately. Turning the whole system OFF lets
          customers browse the menu but not order.
        </p>
      </section>

      <section className="panel">
        <h3>🎁 Homepage promotions</h3>
        <div className="field">
          <label htmlFor="pr-title">Title</label>
          <input
            id="pr-title"
            value={promoTitle}
            onChange={(e) => setPromoTitle(e.target.value)}
            placeholder="e.g. This week's special"
          />
        </div>
        <div className="field">
          <label htmlFor="pr-body">Text</label>
          <input
            id="pr-body"
            value={promoBody}
            onChange={(e) => setPromoBody(e.target.value)}
            placeholder="e.g. Free drink with any kabob platter!"
          />
        </div>
        <div className="field">
          <label htmlFor="pr-item">Featured dish (optional — its photo shows in the box)</label>
          <select
            id="pr-item"
            value={promoItemId}
            onChange={(e) => setPromoItemId(e.target.value)}
          >
            <option value="">No dish — text only</option>
            {state.menu.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {formatCents(item.price_cents)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="checkout-btn"
          disabled={busy || !promoTitle.trim()}
          onClick={async () => {
            await act(
              {
                action: "promo_create",
                title: promoTitle,
                body: promoBody,
                item_id: promoItemId || undefined,
              },
              "🎁 Promotion added — it is live on the homepage."
            );
            setPromoTitle("");
            setPromoBody("");
            setPromoItemId("");
          }}
        >
          Add promotion
        </button>
        {state.promotions.map((p) => (
          <div className="cart-line" key={p.id}>
            <span>
              {p.active ? "🟢" : "⚪"} <strong>{p.title}</strong>
              {p.body ? ` — ${p.body}` : ""}
              {p.item_id
                ? ` · 🍽️ ${state.menu.items.find((i) => i.id === p.item_id)?.name ?? p.item_id}`
                : ""}
            </span>
            <span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "promo_set_active", id: p.id, active: !p.active },
                    p.active ? "Promotion hidden." : "Promotion is live."
                  )
                }
              >
                {p.active ? "Hide" : "Show"}
              </button>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => act({ action: "promo_delete", id: p.id }, "Promotion deleted.")}
              >
                Delete
              </button>
            </span>
          </div>
        ))}
        {state.promotions.length === 0 && (
          <p style={{ color: "#8a7a5f" }}>No promotions yet — the homepage box stays hidden.</p>
        )}
      </section>

      <section className="panel">
        <h3>🗂️ Add a category</h3>
        <div className="field">
          <label htmlFor="cat-name">Category name</label>
          <input
            id="cat-name"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="e.g. Breakfast"
          />
        </div>
        <button
          type="button"
          className="checkout-btn"
          disabled={busy || !newCategory.trim()}
          onClick={async () => {
            await act({ action: "add_category", name: newCategory }, "🗂️ Category added.");
            setNewCategory("");
          }}
        >
          Add category
        </button>
        <p style={{ color: "#8a7a5f" }}>
          Current: {state.menu.categories.join(" · ")}
        </p>
      </section>

      <section className="panel">
        <h3>➕ Add a dish</h3>
        <div className="field">
          <label htmlFor="di-name">Dish name</label>
          <input id="di-name" value={dishName} onChange={(e) => setDishName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="di-desc">Description</label>
          <input id="di-desc" value={dishDesc} onChange={(e) => setDishDesc(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="di-price">Price ($)</label>
          <input
            id="di-price"
            type="number"
            min="0.01"
            step="0.01"
            value={dishPrice}
            onChange={(e) => setDishPrice(e.target.value)}
            placeholder="11.75"
          />
        </div>
        <div className="field">
          <label htmlFor="di-cat">Category</label>
          <select
            id="di-cat"
            value={dishCategory}
            onChange={(e) => setDishCategory(e.target.value)}
          >
            <option value="">Choose…</option>
            {state.menu.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="di-num">Menu number (optional)</label>
          <input
            id="di-num"
            value={dishNumber}
            onChange={(e) => setDishNumber(e.target.value)}
            placeholder="#17"
          />
        </div>
        <button
          type="button"
          className="checkout-btn"
          disabled={busy || !dishName.trim() || !dishCategory || !dishPrice}
          onClick={async () => {
            await act(
              {
                action: "add_item",
                name: dishName,
                description: dishDesc,
                price_cents: Math.round(Number(dishPrice) * 100),
                category: dishCategory,
                number: dishNumber,
              },
              "➕ Dish added to the menu. You can upload its photo below."
            );
            setDishName("");
            setDishDesc("");
            setDishPrice("");
            setDishNumber("");
          }}
        >
          Add dish to menu
        </button>
      </section>

      <section className="panel">
        <h3>🍽️ Dishes — availability & photos</h3>
        {state.menu.categories.map((cat) => (
          <div key={cat}>
            <h4 style={{ margin: "1rem 0 0.3rem" }}>{cat}</h4>
            {state.menu.items
              .filter((item) => item.category === cat)
              .map((item) => {
                const soldOut = unavailableSet.has(item.id);
                const photo = state.photos[item.id] ?? item.image;
                return (
                  <div className="cart-line" key={item.id}>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt=""
                        width={44}
                        height={44}
                        style={{ borderRadius: 8, objectFit: "cover" }}
                      />
                      <span>
                        {item.number ? `${item.number} ` : ""}
                        {item.name} · {formatCents(item.price_cents)}
                        <br />
                        <span style={{ color: soldOut ? "#c0392b" : "#2e7d32" }}>
                          {soldOut ? "Sold out 🔴" : "Available ✅"}
                        </span>
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      <label className="auth-link" style={{ cursor: "pointer" }}>
                        📷 Photo
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadPhoto(item.id, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "set_availability",
                              item_id: item.id,
                              available: soldOut,
                            },
                            soldOut
                              ? `${item.name} is available again.`
                              : `${item.name} marked sold out.`
                          )
                        }
                      >
                        {soldOut ? "Make available" : "Mark sold out"}
                      </button>
                    </span>
                  </div>
                );
              })}
          </div>
        ))}
      </section>

      <button
        type="button"
        onClick={async () => {
          const supabase = getBrowserClient();
          await supabase?.auth.signOut();
        }}
      >
        Log out
      </button>
    </main>
  );
}
