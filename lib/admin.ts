// Admin-controlled site state — server-side only (service-role client).
// Settings, dish availability and promotions live in Supabase (see
// supabase/admin-schema.sql). Everything fails safe: if the tables are
// missing or empty, ordering is ON, every dish is available, and there
// are no promotions — the site behaves exactly as before this feature.

import { getServiceClient } from "./supabase/server";
import {
  HOURS_SETTING_KEYS,
  hoursConfigFromMap,
  type HoursConfig,
} from "./hours";

export interface SiteSettings {
  ordering_enabled: boolean;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  ordering_enabled: true,
  pickup_enabled: true,
  delivery_enabled: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[];

export async function getSettings(): Promise<SiteSettings> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from("site_settings").select("key, value");
    if (error) return { ...DEFAULT_SETTINGS };
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of data ?? []) {
      const key = row.key as keyof SiteSettings;
      if (SETTING_KEYS.includes(key)) {
        settings[key] = row.value === true || row.value === "true";
      }
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSetting(key: keyof SiteSettings, value: boolean): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

export function isSettingKey(key: string): key is keyof SiteSettings {
  return (SETTING_KEYS as string[]).includes(key);
}

/**
 * Opening hours from site_settings (the eight hours_* keys, stored as
 * "HH:MM" strings). Fails safe to the built-in defaults.
 */
export async function getHoursConfig(): Promise<HoursConfig> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", [...HOURS_SETTING_KEYS]);
    if (error) return hoursConfigFromMap({});
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) map[row.key as string] = row.value;
    return hoursConfigFromMap(map);
  } catch {
    return hoursConfigFromMap({});
  }
}

/** Saves the eight "HH:MM" strings (already validated by the caller). */
export async function setHoursConfig(values: Record<string, string>): Promise<void> {
  const supabase = getServiceClient();
  const now = new Date().toISOString();
  const rows = HOURS_SETTING_KEYS.map((key) => ({
    key,
    value: values[key],
    updated_at: now,
  }));
  const { error } = await supabase
    .from("site_settings")
    .upsert(rows, { onConflict: "key" });
  if (error) throw error;
}

/** Ids of dishes the admin marked sold out. Empty set = all available. */
export async function getUnavailableIds(): Promise<Set<string>> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("dish_availability")
      .select("item_id")
      .eq("available", false);
    if (error) return new Set();
    return new Set((data ?? []).map((r) => r.item_id as string));
  } catch {
    return new Set();
  }
}

export async function setDishAvailability(itemId: string, available: boolean): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("dish_availability")
    .upsert(
      { item_id: itemId, available, updated_at: new Date().toISOString() },
      { onConflict: "item_id" }
    );
  if (error) throw error;
}

export interface Promotion {
  id: number;
  title: string;
  body: string;
  active: boolean;
  sort: number;
  created_at: string;
  item_id: string | null;
}

export async function listPromotions(activeOnly: boolean): Promise<Promotion[]> {
  try {
    const supabase = getServiceClient();
    let query = supabase
      .from("promotions")
      .select("id, title, body, active, sort, created_at, item_id")
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    if (activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) return [];
    return (data as Promotion[]) ?? [];
  } catch {
    return [];
  }
}

export async function createPromotion(
  title: string,
  body: string,
  itemId?: string | null
): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("promotions")
    .insert({ title, body, active: true, item_id: itemId || null });
  if (error) throw error;
}

export async function setPromotionActive(id: number, active: boolean): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.from("promotions").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deletePromotion(id: number): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) throw error;
}

// ---- Dish photos -----------------------------------------------------------

/** item_id -> uploaded photo URL. Empty map = all built-in photos. */
export async function getDishPhotos(): Promise<Record<string, string>> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from("dish_photos").select("item_id, url");
    if (error) return {};
    return Object.fromEntries((data ?? []).map((r) => [r.item_id as string, r.url as string]));
  } catch {
    return {};
  }
}

export async function setDishPhoto(itemId: string, url: string): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("dish_photos")
    .upsert(
      { item_id: itemId, url, updated_at: new Date().toISOString() },
      { onConflict: "item_id" }
    );
  if (error) throw error;
}

export const DISH_PHOTOS_BUCKET = "dish-photos";

/** Uploads a dish photo to Supabase Storage; returns its public URL. */
export async function uploadDishPhoto(
  itemId: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<string> {
  const supabase = getServiceClient();
  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";
  const path = `${itemId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(DISH_PHOTOS_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(DISH_PHOTOS_BUCKET).getPublicUrl(path);
  await setDishPhoto(itemId, data.publicUrl);
  return data.publicUrl;
}

// ---- Menu management (categories + items) ----------------------------------

export function slugifyItemId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "item";
}

export async function addCategory(name: string): Promise<void> {
  const supabase = getServiceClient();
  const { count } = await supabase
    .from("menu_categories")
    .select("name", { count: "exact", head: true });
  const { error } = await supabase
    .from("menu_categories")
    .insert({ name, sort: count ?? 0 });
  if (error) throw error;
}

export async function addMenuItem(input: {
  name: string;
  description: string;
  price_cents: number;
  category: string;
  number?: string;
}): Promise<string> {
  const supabase = getServiceClient();
  // Unique slug id from the name.
  let id = slugifyItemId(input.name);
  for (let n = 2; ; n++) {
    const { data } = await supabase
      .from("menu_items")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!data) break;
    id = `${slugifyItemId(input.name)}-${n}`;
  }
  const { count } = await supabase
    .from("menu_items")
    .select("id", { count: "exact", head: true });
  const { error } = await supabase.from("menu_items").insert({
    id,
    name: input.name,
    description: input.description,
    price_cents: input.price_cents,
    category: input.category,
    number: input.number || null,
    sort: count ?? 0,
  });
  if (error) throw error;
  return id;
}
