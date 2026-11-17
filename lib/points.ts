// Loyalty points — server-side only (service-role client).
// Rules (confirmed by Sami, 2026-11-16):
// - Only signed-in customers (email or Google) earn or spend points.
// - Earn: 1 point per whole $1 of the PAID order total.
// - Redeem: 100 points = $5.00 off, in whole 100-point blocks, never more
//   than the order subtotal.
// - A cancelled order refunds its redeemed points and reverses its earned
//   points. Every movement is one ledger row; balance = sum(delta).
// - Idempotent: unique (order_id, reason) index makes re-runs no-ops.

import { getServiceClient } from "./supabase/server";

export const POINTS_PER_BLOCK = 100;
export const BLOCK_VALUE_CENTS = 500; // $5.00

export async function getPointsBalance(userId: string): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("user_id", userId)
    .limit(10000);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + (r.delta as number), 0);
}

/** How much of a balance can be applied to a subtotal, in whole blocks. */
export function redemptionFor(
  balance: number,
  subtotal_cents: number
): { blocks: number; points: number; discount_cents: number } {
  const blocks = Math.min(
    Math.floor(Math.max(balance, 0) / POINTS_PER_BLOCK),
    Math.floor(subtotal_cents / BLOCK_VALUE_CENTS)
  );
  return {
    blocks,
    points: blocks * POINTS_PER_BLOCK,
    discount_cents: blocks * BLOCK_VALUE_CENTS,
  };
}

async function insertLedgerRow(
  userId: string,
  orderId: number,
  delta: number,
  reason: "earn" | "redeem" | "refund" | "reversal"
): Promise<boolean> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("points_ledger")
    .insert({ user_id: userId, order_id: orderId, delta, reason });
  if (error) {
    // 23505 = unique violation: this movement was already recorded.
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
  return true;
}

/** Called when an order becomes paid. Awards points to its account owner. */
export async function earnPointsForPaidOrder(order: {
  id: number;
  user_id?: string | null;
  total_cents: number;
}): Promise<void> {
  if (!order.user_id) return; // guests earn nothing
  const points = Math.floor(order.total_cents / 100);
  if (points <= 0) return;
  await insertLedgerRow(order.user_id, order.id, points, "earn");
}

/** Spends points at checkout. Caller must have validated the balance. */
export async function redeemPointsForOrder(
  userId: string,
  orderId: number,
  points: number
): Promise<void> {
  if (points <= 0) return;
  await insertLedgerRow(userId, orderId, -points, "redeem");
}

/**
 * On cancellation: refund any points the order redeemed, and reverse any
 * points it earned. Both idempotent.
 */
export async function reversePointsForCancelledOrder(orderId: number): Promise<void> {
  const supabase = getServiceClient();
  const { data: order } = await supabase
    .from("orders")
    .select("user_id, points_redeemed")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.user_id) return;
  const userId = order.user_id as string;

  if ((order.points_redeemed as number) > 0) {
    await insertLedgerRow(userId, orderId, order.points_redeemed as number, "refund");
  }
  const { data: earnRow } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("order_id", orderId)
    .eq("reason", "earn")
    .maybeSingle();
  if (earnRow && (earnRow.delta as number) > 0) {
    await insertLedgerRow(userId, orderId, -(earnRow.delta as number), "reversal");
  }
}

export interface PointsHistoryRow {
  id: number;
  order_id: number | null;
  delta: number;
  reason: string;
  created_at: string;
}

export async function getPointsHistory(
  userId: string,
  limit = 30
): Promise<PointsHistoryRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("id, order_id, delta, reason, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as PointsHistoryRow[]) ?? [];
}
