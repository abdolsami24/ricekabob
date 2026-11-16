// Exact Madinah Market menu — 36 items, 6 categories.
// Prices are integer cents. This file is the single trusted price source:
// the server always recomputes totals from here, never from the browser.

export interface MenuItem {
  id: string;
  /** Menu number as printed on the restaurant menu (where one exists). */
  number?: string;
  name: string;
  description: string;
  price_cents: number;
  category: string;
  image: string;
}

export const CATEGORIES = [
  "Platters",
  "Sandwiches",
  "Hot Bread Hot Steak",
  "Side Orders",
  "Kabobs Only",
  "Drinks",
] as const;

function item(
  id: string,
  name: string,
  description: string,
  price_cents: number,
  category: string,
  number?: string
): MenuItem {
  return { id, name, description, price_cents, category, number, image: `/images/${id}.jpg` };
}

export const MENU: MenuItem[] = [
  // ---- Platters -------------------------------------------------------------
  item("combo-platter", "Combo Platter", "Chicken and gyros over rice with salad and sauce.", 1175, "Platters", "#5"),
  item("chicken-shawarma-rice", "Chicken Shawarma over Rice", "Marinated chicken shawarma served over rice.", 1175, "Platters", "#6"),
  item("lamb-gyro-rice", "Lamb Gyro over Rice", "Seasoned lamb gyro slices over rice.", 1175, "Platters", "#7"),
  item("chicken-biryani", "Chicken Biryani", "Fragrant spiced rice with chicken.", 1175, "Platters", "#8"),
  item("kobideh-kabob", "Kobideh Kabob", "Two skewers of seasoned ground beef kabob over rice.", 1175, "Platters", "#9"),
  item("chicken-nuggets-fries", "Chicken Nuggets with French Fries", "7 pieces of chicken nuggets with french fries.", 899, "Platters", "#10"),
  item("chicken-tikka-kabob", "Chicken Tikka Kabob", "Grilled marinated chicken tikka over rice.", 1175, "Platters", "#11"),
  item("lamb-shank", "Lamb Shank over Rice", "Slow-cooked tender lamb shank over rice.", 1375, "Platters", "#12"),
  item("sultani-kabob", "Sultani Kabob", "One skewer kobideh and one skewer chicken kabob over rice.", 1375, "Platters", "#13"),
  item("falafel-platter", "Falafel Platter", "Falafel over rice with salad and tahini.", 1175, "Platters", "#14"),
  item("fry-fish-rice", "Fry Fish over Rice", "Crispy fried fish served over rice.", 1175, "Platters", "#15"),
  item("chicken-wings-fries", "Chicken Wings with Fries", "Chicken wings served with french fries.", 899, "Platters", "#16"),

  // ---- Sandwiches -----------------------------------------------------------
  item("gyros-sandwich", "Gyros Sandwich", "Lamb gyros wrapped in warm pita with vegetables and sauce.", 899, "Sandwiches", "#1"),
  item("chicken-shawarma-sandwich", "Chicken Shawarma Sandwich", "Chicken shawarma wrap with pickles and garlic sauce.", 899, "Sandwiches", "#2"),
  item("falafel-sandwich", "Falafel Sandwich", "Falafel wrap with salad and tahini sauce.", 899, "Sandwiches", "#3"),
  item("beef-burger-fries", "Beef Burger and Fries", "Beef burger served with french fries.", 899, "Sandwiches", "#4"),
  item("kobideh-sandwich", "Kobideh Kabob Sandwich", "Ground beef kobideh skewer wrapped in fresh bread.", 999, "Sandwiches"),
  item("chicken-kabob-sandwich", "Chicken Kabob Sandwich", "Grilled chicken kabob wrapped in fresh bread.", 999, "Sandwiches"),

  // ---- Hot Bread Hot Steak (Kabob) ------------------------------------------
  item("hot-steak-kobideh", "Hot Bread Hot Steak (Kobideh Kabob)", "Kobideh kabob served sizzling on hot fresh bread.", 1199, "Hot Bread Hot Steak"),
  item("hot-steak-chicken", "Hot Bread Hot Steak (Chicken Kabob)", "Chicken kabob served sizzling on hot fresh bread.", 1199, "Hot Bread Hot Steak"),

  // ---- Side Orders ----------------------------------------------------------
  item("french-fries", "French Fries", "Golden crispy french fries.", 249, "Side Orders"),
  item("falafel-4pcs", "4 pcs Falafel", "Four pieces of freshly fried falafel.", 329, "Side Orders"),
  item("pita-bread", "Pita Bread", "One warm pita bread.", 125, "Side Orders"),
  item("plain-rice-plate", "Plain Rice Plate", "A plate of steamed rice.", 499, "Side Orders"),
  item("veggie-samosa-3", "3 pcs Veggie Samosa", "Three crispy vegetable samosas.", 499, "Side Orders"),
  item("veggie-samosa-10", "10 pcs Veggie Samosa", "Ten crispy vegetable samosas — good for sharing.", 1499, "Side Orders"),

  // ---- Kabobs Only ----------------------------------------------------------
  item("kobideh-skewer", "Kobideh Kabob Only", "One skewer of seasoned ground beef kobideh.", 299, "Kabobs Only"),
  item("chicken-skewer", "Chicken Kabob Only", "One skewer of grilled chicken kabob.", 299, "Kabobs Only"),
  item("grilled-tomatoes", "Grilled Tomatoes", "Two grilled tomatoes.", 249, "Kabobs Only"),

  // ---- Drinks ---------------------------------------------------------------
  item("yogurt-drink", "Yogurt Drink", "Chilled yogurt drink (doogh).", 259, "Drinks"),
  item("water-bottle", "Bottle of Water", "Bottled drinking water.", 79, "Drinks"),
  item("can-soda", "Can Soda", "One can of soda.", 159, "Drinks"),
  item("bottle-soda", "Bottle of Soda", "One bottle of soda.", 249, "Drinks"),
  item("ginseng-energy", "Ginseng Energy Drink", "Ginseng energy drink.", 199, "Drinks"),
  item("red-bull", "Red Bull 8oz", "Red Bull energy drink, 8 oz can.", 299, "Drinks"),
  item("monster", "Monster Drink", "Monster energy drink.", 299, "Drinks"),
];

export const MENU_BY_ID: Record<string, MenuItem> = Object.fromEntries(
  MENU.map((m) => [m.id, m])
);

export function getMenuItem(id: string): MenuItem | undefined {
  return MENU_BY_ID[id];
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
