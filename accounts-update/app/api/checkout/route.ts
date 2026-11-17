// POST /api/checkout
// Body: { items: [{id, qty}], customer_name, customer_phone, fulfillment,
//         delivery_address?, tip_percent?, tip_custom_cents?, note? }
// The server rebuilds the order from lib/menu (browser prices are never
// trusted), saves it as "unpaid", then either returns a Stripe Checkout URL
// (real mode) or { test_mode: true, order_id } (test mode).

import { NextResponse } from "next/server";
import { buildLines, computeTotals, computeTipCents } from "@/lib/pricing";
import { quoteDelivery } from "@/lib/geocode";
import { getServiceClient, supabaseConfigured, verifyCustomerUser } from "@/lib/supabase/server";
import { getStripe, siteUrl, stripeTestMode } from "@/lib/stripe";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return bad("Ordering is not configured yet (database). Please call the restaurant.", 503);
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const customer_name = String(body.customer_name ?? "").trim().slice(0, 80);
  const customer_phone = String(body.customer_phone ?? "").trim().slice(0, 30);
  const fulfillment = body.fulfillment === "delivery" ? "delivery" : "pickup";
  const delivery_address = String(body.delivery_address ?? "").trim().slice(0, 300);
  const note = String(body.note ?? "").trim().slice(0, 200);

  if (customer_name.length < 2) return bad("Please enter your name");
  if (customer_phone.replace(/\D/g, "").length < 7) return bad("Please enter your phone number");

  let lines;
  try {
    lines = buildLines(body.items as { id: string; qty: number }[]);
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Invalid cart");
  }

  // Delivery fee is computed on the server from the address — never trusted.
  let delivery_fee_cents = 0;
  if (fulfillment === "delivery") {
    if (delivery_address.length < 6) return bad("Please enter the delivery address");
    const quote = await quoteDelivery(delivery_address);
    if (!quote.ok) {
      return bad(
        quote.error === "far"
          ? "Sorry — that address is more than 4 miles away, so delivery is not available. Please choose pickup."
          : "We could not find that address. Please check it and try again."
      );
    }
    delivery_fee_cents = quote.fee_cents;
  }

  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  const tip_cents = computeTipCents(
    subtotal,
    typeof body.tip_percent === "number" ? body.tip_percent : undefined,
    typeof body.tip_custom_cents === "number" ? body.tip_custom_cents : undefined
  );
  const totals = computeTotals(lines, delivery_fee_cents, tip_cents);

  // Optional: if the customer is signed in, link the order to their
  // account so it appears in their order history. Guests simply omit the
  // Authorization header and stay anonymous, as before.
  const customerUser = await verifyCustomerUser(req).catch(() => null);

  const supabase = getServiceClient();
  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: customerUser?.id ?? null,
      customer_name,
      customer_phone,
      items_json: lines,
      subtotal_cents: totals.subtotal_cents,
      tax_cents: totals.tax_cents,
      delivery_fee_cents: totals.delivery_fee_cents,
      tip_cents: totals.tip_cents,
      total_cents: totals.total_cents,
      fulfillment,
      delivery_address: fulfillment === "delivery" ? delivery_address : null,
      payment_status: "unpaid",
      kitchen_status: "new",
    })
    .select("id")
    .single();
  if (error || !order) {
    console.error("[checkout] insert failed:", error);
    return bad("Could not create the order. Please try again.", 500);
  }
  const orderId = order.id as number;

  // TEST MODE: no Stripe key — the client will call /api/test-pay next.
  if (stripeTestMode()) {
    return NextResponse.json({ test_mode: true, order_id: orderId });
  }

  // Real mode: Stripe Checkout with separate line items so the Stripe total
  // equals the order total exactly.
  try {
    const stripe = getStripe();
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map((l) => ({
      quantity: l.qty,
      price_data: {
        currency: "usd",
        unit_amount: l.unit_price_cents,
        product_data: { name: l.name },
      },
    }));
    if (totals.tax_cents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: totals.tax_cents,
          product_data: { name: "Sales tax (8%)" },
        },
      });
    }
    if (totals.delivery_fee_cents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: totals.delivery_fee_cents,
          product_data: { name: "Delivery fee" },
        },
      });
    }
    if (totals.tip_cents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: totals.tip_cents,
          product_data: { name: "Tip — thank you!" },
        },
      });
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      metadata: { order_id: String(orderId) },
      success_url: `${siteUrl()}/?order=${orderId}&paid=1`,
      cancel_url: `${siteUrl()}/?order=${orderId}&cancelled=1`,
    });
    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", orderId);
    return NextResponse.json({ url: session.url, order_id: orderId });
  } catch (err) {
    console.error("[checkout] Stripe session failed:", err);
    return bad("Payment could not be started. Please try again.", 502);
  }
}
