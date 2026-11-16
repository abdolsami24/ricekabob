import Storefront from "@/components/Storefront";

// The server tells the storefront whether the site is in TEST MODE
// (no STRIPE_SECRET_KEY configured) so the banner can be shown.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const testMode = !process.env.STRIPE_SECRET_KEY;
  return <Storefront testMode={testMode} />;
}
