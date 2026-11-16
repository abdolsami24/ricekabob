// GET /api/kitchen/orders
// KITCHEN ONLY. Requires a valid Supabase Auth access token
// (Authorization: Bearer ...). Returns today's orders with full detail
// for the kitchen board. Without a login it refuses — the order list is
// never public.

import { NextResponse } from "next/server";
import { getServiceClient, supabaseConfigured, verifyKitchenUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }
  const user = await verifyKitchenUser(req);
  if (!user) {
    return NextResponse.json({ error: "Kitchen login required." }, { status: 401 });
  }
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .gte("created_at", startOfDay.toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[kitchen/orders] query failed:", error);
    return NextResponse.json({ error: "Could not load orders." }, { status: 500 });
  }
  // Hide Stripe's internal id from the board payload; staff never need it.
  const orders = (data ?? []).map((o) => ({ ...o, stripe_session_id: undefined }));
  return NextResponse.json({ orders });
}
