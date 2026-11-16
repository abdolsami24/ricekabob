import KitchenBoard from "@/components/KitchenBoard";

export const dynamic = "force-dynamic";

export default function KitchenPage() {
  const testMode = !process.env.STRIPE_SECRET_KEY;
  return <KitchenBoard testMode={testMode} />;
}
