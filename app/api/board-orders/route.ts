// GET /api/board-orders
// PUBLIC, SAFE feed for the customer TV board. Returns ONLY: id,
// kitchen_status, payment_status, created_at — never names, phones,
// addresses or prices.
//
// Real-launch rule: only PAID orders from the last 4 hours; completed and
// cancelled never appear. When NEXT_PUBLIC_BOARD_TEST_MODE=true the rule is
// relaxed for testing (all of today's active orders, any payment state).

import { NextResponse } from "next/server";
import { getServiceClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ orders: [] });
  }
  const testMode = process.env.NEXT_PUBLIC_BOARD_TEST_MODE === "true";
  const supabase = getServiceClient();
  let query = supabase
    .from("orders")
    .select("id, kitchen_status, payment_status, created_at")
    .not("kitchen_status", "in", '("completed","cancelled")')
    .order("created_at", { ascending: true })
    .limit(60);

  if (testMode) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    query = query.gte("created_at", startOfDay.toISOString());
  } else {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    query = query
      .eq("payment_status", "paid")
      .gte("created_at", fourHoursAgo.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error("[board-orders] query failed:", error);
    return NextResponse.json({ orders: [] });
  }
  return NextResponse.json({ orders: data ?? [], test_mode: testMode });
}
