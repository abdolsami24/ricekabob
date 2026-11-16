// Shared order side-effects: the single place where an order becomes
// paid / test_paid. Used by the Stripe webhook and by /api/test-pay.
// Idempotent: an order that is already paid is never processed twice.

import { getServiceClient } from "./supabase/server";
import { notifyOwner, type NotifyOrder } from "./email";
import { dispatchToShipday, type ShipdayOrder } from "./shipday";

export type OrderRow = NotifyOrder &
  ShipdayOrder & {
    kitchen_status: string;
    stripe_session_id: string | null;
    shipday_status: string | null;
    created_at: string;
  };

export async function getOrder(orderId: number): Promise<OrderRow | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as OrderRow) ?? null;
}

/**
 * Marks an unpaid order as paid/test_paid, then fires the owner email and
 * (for delivery orders) Shipday dispatch. Side-effect failures are recorded
 * or logged, never thrown back at the payment flow.
 */
export async function markOrderPaid(
  orderId: number,
  status: "paid" | "test_paid"
): Promise<{ order: OrderRow; alreadyPaid: boolean }> {
  const supabase = getServiceClient();
  const order = await getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.payment_status === "paid" || order.payment_status === "test_paid") {
    return { order, alreadyPaid: true };
  }
  const { data, error } = await supabase
    .from("orders")
    .update({ payment_status: status })
    .eq("id", orderId)
    .eq("payment_status", "unpaid")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  const updated = (data as OrderRow) ?? { ...order, payment_status: status };

  // Owner email (best-effort).
  try {
    await notifyOwner(updated);
  } catch (err) {
    console.error("[orders] owner notification failed:", err);
  }

  // Shipday dispatch for delivery orders (best-effort, never twice).
  if (updated.fulfillment === "delivery" && !updated.shipday_order_id) {
    const result = await dispatchToShipday(updated);
    await supabase
      .from("orders")
      .update({
        shipday_status: result.status,
        ...(result.shipday_order_id ? { shipday_order_id: result.shipday_order_id } : {}),
      })
      .eq("id", orderId);
    updated.shipday_status = result.status;
    if (result.shipday_order_id) updated.shipday_order_id = result.shipday_order_id;
  }

  return { order: updated, alreadyPaid: false };
}
