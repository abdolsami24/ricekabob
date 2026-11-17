import Storefront from "@/components/Storefront";
import { getDbMenu } from "@/lib/menuDb";

// The server tells the storefront whether the site is in TEST MODE
// (no STRIPE_SECRET_KEY configured) so the banner can be shown, and
// loads the menu (database menu when the admin tables exist, else the
// built-in menu from lib/menu).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const testMode = !process.env.STRIPE_SECRET_KEY;
  const menu = await getDbMenu();
  return <Storefront testMode={testMode} menu={menu.items} categories={menu.categories} />;
}
