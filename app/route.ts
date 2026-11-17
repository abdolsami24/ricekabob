// /api/admin — admin-controlled site state.
// GET  (no login): public view — settings, sold-out dish ids, ACTIVE
//      promotions. The storefront reads this on load.
// GET  (staff token): full view — also inactive promotions.
// POST (staff token only): actions —
//      { action: "set_setting", key, value }
//      { action: "set_availability", item_id, available }
//      { action: "promo_create", title, body }
//      { action: "promo_set_active", id, active }
//      { action: "promo_delete", id }
// POST returns the refreshed full state.

import { NextResponse } from "next/server";
import { supabaseConfigured, verifyKitchenUser } from "@/lib/supabase/server";
import {
  getSettings,
  setSetting,
  isSettingKey,
  getUnavailableIds,
  setDishAvailability,
  listPromotions,
  createPromotion,
  setPromotionActive,
  deletePromotion,
  getDishPhotos,
  uploadDishPhoto,
  addCategory,
  addMenuItem,
} from "@/lib/admin";
import { getMenuItem } from "@/lib/menu";
import { getDbMenu } from "@/lib/menuDb";

export const dynamic = "force-dynamic";

async function staffState() {
  const [settings, unavailable, promotions, photos, menu] = await Promise.all([
    getSettings(),
    getUnavailableIds(),
    listPromotions(false),
    getDishPhotos(),
    getDbMenu(),
  ]);
  return {
    settings,
    unavailable: [...unavailable],
    promotions,
    photos,
    menu: { categories: menu.categories, items: menu.items },
  };
}

export async function GET(req: Request) {
  const [settings, unavailable, activePromos, photos] = await Promise.all([
    getSettings(),
    getUnavailableIds(),
    listPromotions(true),
    getDishPhotos(),
  ]);
  const publicState = {
    settings,
    unavailable: [...unavailable],
    promotions: activePromos.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      item_id: p.item_id ?? null,
    })),
    photos,
  };
  // A valid staff token upgrades the response to the full admin view.
  if (supabaseConfigured()) {
    const user = await verifyKitchenUser(req).catch(() => null);
    if (user) {
      const full = await staffState();
      return NextResponse.json({ ...full, staff: true });
    }
  }
  return NextResponse.json(publicState);
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }
  const user = await verifyKitchenUser(req);
  if (!user) {
    return NextResponse.json({ error: "Staff login required." }, { status: 401 });
  }
  // Dish photo upload arrives as multipart form data.
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      const itemId = String(form.get("item_id") ?? "");
      const file = form.get("file");
      if (!itemId || !(file instanceof File)) {
        return NextResponse.json({ error: "Missing dish or file." }, { status: 400 });
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        return NextResponse.json(
          { error: "Please choose a JPG, PNG or WebP image." },
          { status: 400 }
        );
      }
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "Image is too large (max 5 MB)." }, { status: 400 });
      }
      await uploadDishPhoto(itemId, await file.arrayBuffer(), file.type);
    } catch (err) {
      console.error("[admin] photo upload failed:", err);
      return NextResponse.json({ error: "Photo upload failed." }, { status: 500 });
    }
    const full = await staffState();
    return NextResponse.json({ ...full, staff: true });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  try {
    switch (body.action) {
      case "set_setting": {
        const key = String(body.key ?? "");
        if (!isSettingKey(key)) throw new Error("Unknown setting");
        await setSetting(key, body.value === true);
        break;
      }
      case "set_availability": {
        const itemId = String(body.item_id ?? "");
        const menu = await getDbMenu();
        if (!menu.items.some((i) => i.id === itemId) && !getMenuItem(itemId)) {
          throw new Error("Unknown dish");
        }
        await setDishAvailability(itemId, body.available === true);
        break;
      }
      case "promo_create": {
        const title = String(body.title ?? "").trim().slice(0, 120);
        const text = String(body.body ?? "").trim().slice(0, 400);
        const itemId = String(body.item_id ?? "").trim();
        if (!title) throw new Error("A promotion needs a title");
        if (itemId) {
          const menu = await getDbMenu();
          if (!menu.items.some((i) => i.id === itemId)) {
            throw new Error("Unknown dish for the promotion");
          }
        }
        await createPromotion(title, text, itemId || null);
        break;
      }
      case "promo_set_active": {
        await setPromotionActive(Math.floor(Number(body.id)), body.active === true);
        break;
      }
      case "promo_delete": {
        await deletePromotion(Math.floor(Number(body.id)));
        break;
      }
      case "add_category": {
        const name = String(body.name ?? "").trim().slice(0, 60);
        if (!name) throw new Error("A category needs a name");
        await addCategory(name);
        break;
      }
      case "add_item": {
        const name = String(body.name ?? "").trim().slice(0, 80);
        const description = String(body.description ?? "").trim().slice(0, 300);
        const price_cents = Math.floor(Number(body.price_cents));
        const category = String(body.category ?? "").trim().slice(0, 60);
        const number = String(body.number ?? "").trim().slice(0, 10);
        if (!name) throw new Error("A dish needs a name");
        if (!category) throw new Error("Choose a category");
        if (!Number.isFinite(price_cents) || price_cents < 1 || price_cents > 100000) {
          throw new Error("Enter a valid price");
        }
        await addMenuItem({ name, description, price_cents, category, number });
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[admin] action failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 }
    );
  }
  const full = await staffState();
  return NextResponse.json({ ...full, staff: true });
}
