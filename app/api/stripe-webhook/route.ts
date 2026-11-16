// POST /api/stripe-webhook
// Signed Stripe webhook. On checkout.session.completed it marks the order
// "paid" (idempotently), which fires the owner email + Shipday dispatch.

import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getServiceClient, supabaseConfigured } from "@/lib/supabase/server";
import { markOrderPaid } from "@/lib/orders";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature || !supabaseConfigured()) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature check failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    try {
      let orderId = Number(session.metadata?.order_id ?? 0);
      if (!orderId) {
        // Fall back to the session id stored on the order at checkout time.
        const supabase = getServiceClient();
        const { data } = await supabase
          .from("orders")
          .select("id")
          .eq("stripe_session_id", session.id)
          .maybeSingle();
        orderId = Number(data?.id ?? 0);
      }
      if (orderId) await markOrderPaid(orderId, "paid");
    } catch (err) {
      console.error("[stripe-webhook] order update failed:", err);
      // Still answer 200 so Stripe does not retry forever on a data problem;
      // the failure is logged for the owner to investigate.
    }
  }
  return NextResponse.json({ received: true });
}
