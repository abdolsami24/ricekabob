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
import { getPointsBalance, redemptionFor, redeemPointsForOrder } from "@/lib/points";
import { getSettings, getUnavailableIds } from "@/lib/admin";
import { getPricingMenuById } from "@/lib/menuDb";
import { validatePickupTime } from "@/lib/hours";
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

  // Admin switches: the whole system, or one fulfillment type, may be off.
  const settings = await getSettings();
  if (!settings.ordering_enabled) {
    return bad("Online ordering is currently closed. Please call us at 720-763-0786.", 403);
  }
  if (fulfillment === "pickup" && !settings.pickup_enabled) {
    return bad("Pickup ordering is currently off. Please choose delivery or call us.", 400);
  }
  if (fulfillment === "delivery" && !settings.delivery_enabled) {
    return bad("Delivery ordering is currently off. Please choose pickup or call us.", 400);
  }

  // Scheduled pickup ("pickup for later"): today only, inside pickup hours.
  let scheduled_for: string | null = null;
  if (fulfillment === "pickup" && typeof body.scheduled_for === "string" && body.scheduled_for) {
    const problem = validatePickupTime(body.scheduled_for);
    if (problem) return bad(problem);
    scheduled_for = new Date(body.scheduled_for).toISOString();
  }

  let lines;
  try {
    lines = buildLines(
      body.items as { id: string; qty: number }[],
      await getPricingMenuById()
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Invalid cart");
  }

  // Sold-out dishes (admin-marked) cannot be ordered.
  const unavailable = await getUnavailableIds();
  const soldOut = lines.find((l) => unavailable.has(l.id));
  if (soldOut) {
    return bad(`${soldOut.name} just sold out — please remove it from your cart.`);
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

  // Optional: if the customer is signed in, link the order to their
  // account so it appears in their order history. Guests simply omit the
  // Authorization header and stay anonymous, as before.
  const customerUser = await verifyCustomerUser(req).catch(() => null);

  // Loyalty redemption (signed-in customers only): the server checks the
  // real balance and applies whole 100-point blocks ($5.00 each) off the
  // subtotal. The client's numbers are never trusted.
  let discount_cents = 0;
  let points_redeemed = 0;
  if (body.use_points === true && customerUser) {
    try {
      const balance = await getPointsBalance(customerUser.id);
      const redemption = redemptionFor(balance, subtotal);
      discount_cents = redemption.discount_cents;
      points_redeemed = redemption.points;
    } catch (err) {
      console.error("[checkout] points balance check failed:", err);
    }
  }
  const totals = computeTotals(lines, delivery_fee_cents, tip_cents, discount_cents);

  const supabase = getServiceClient();
  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: customerUser?.id ?? null,
      customer_name,
      customer_phone,
      items_json: lines,
      subtotal_cents: totals.subtotal_cents,
      discount_cents: totals.discount_cents,
      points_redeemed,
      tax_cents: totals.tax_cents,
      delivery_fee_cents: totals.delivery_fee_cents,
      tip_cents: totals.tip_cents,
      total_cents: totals.total_cents,
      fulfillment,
      delivery_address: fulfillment === "delivery" ? delivery_address : null,
      scheduled_for,
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

  // Record the redemption in the ledger (idempotent per order).
  if (points_redeemed > 0 && customerUser) {
    try {
      await redeemPointsForOrder(customerUser.id, orderId, points_redeemed);
    } catch (err) {
      console.error("[checkout] points redeem failed:", err);
    }
  }

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
    // Loyalty discount: Stripe line items can't be negative, so use a
    // one-time amount-off coupon — the charged total stays exact.
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (totals.discount_cents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: totals.discount_cents,
        currency: "usd",
        duration: "once",
        name: "Loyalty points",
      });
      discounts = [{ coupon: coupon.id }];
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      ...(discounts ? { discounts } : {}),
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
