// Database menu (admin-extensible) with the static lib/menu.ts as the
// fallback. If the menu tables are missing, empty, or unreachable, the
// site uses the built-in menu exactly as before — adding the tables only
// ADDS the admin's new categories and items on top of the same data
// (the SQL seeds the tables with the current menu).

import { getServiceClient } from "./supabase/server";
import { MENU, CATEGORIES, MENU_BY_ID, type MenuItem } from "./menu";

export interface DbMenu {
  categories: string[];
  items: MenuItem[];
  fromDb: boolean;
}

export async function getDbMenu(): Promise<DbMenu> {
  try {
    const supabase = getServiceClient();
    const [cats, items] = await Promise.all([
      supabase.from("menu_categories").select("name, sort").order("sort", { ascending: true }),
      supabase.from("menu_items").select("*").order("sort", { ascending: true }),
    ]);
    if (cats.error || items.error || !items.data || items.data.length === 0) {
      return { categories: [...CATEGORIES], items: MENU, fromDb: false };
    }
    const categories =
      cats.data && cats.data.length > 0
        ? cats.data.map((c) => c.name as string)
        : [...CATEGORIES];
    // Any category used by an item but missing from the list still shows.
    for (const row of items.data) {
      if (!categories.includes(row.category as string)) {
        categories.push(row.category as string);
      }
    }
    return {
      categories,
      items: items.data.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        description: (row.description as string) ?? "",
        price_cents: row.price_cents as number,
        category: row.category as string,
        number: (row.number as string | null) ?? undefined,
        image: `/images/${row.id as string}.jpg`,
      })),
      fromDb: true,
    };
  } catch {
    return { categories: [...CATEGORIES], items: MENU, fromDb: false };
  }
}

/** Trusted price source for checkout: DB menu when available. */
export async function getPricingMenuById(): Promise<Record<string, MenuItem>> {
  const db = await getDbMenu();
  if (!db.fromDb) return MENU_BY_ID;
  return Object.fromEntries(db.items.map((i) => [i.id, i]));
}
