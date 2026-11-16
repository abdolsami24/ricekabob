// Stripe server client — created lazily so the app can run (and build)
// with no key configured. An empty STRIPE_SECRET_KEY means TEST MODE:
// orders are marked "test_paid" by /api/test-pay with no real charge.

import Stripe from "stripe";

export function stripeTestMode(): boolean {
  return !process.env.STRIPE_SECRET_KEY;
}

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured (site is in test mode)");
  if (!stripeClient) {
    stripeClient = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  }
  return stripeClient;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}
