// GET  /api/account/me — the signed-in customer's profile (created on
//      first call). Requires Authorization: Bearer <supabase token>.
// POST /api/account/me — update display_name / phone / default_address.

import { NextResponse } from "next/server";
import { supabaseConfigured, verifyCustomerUser, getServiceClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/profiles";
import { getPointsBalance, getPointsHistory } from "@/lib/points";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const user = await verifyCustomerUser(req);
  if (!user) {
    return NextResponse.json({ error: "Login required." }, { status: 401 });
  }
  const profile = await ensureProfile(user);
  // Loyalty (best-effort: null until the loyalty schema has been run).
  let points: { balance: number; history: unknown[] } | null = null;
  try {
    const [balance, history] = await Promise.all([
      getPointsBalance(user.id),
      getPointsHistory(user.id),
    ]);
    points = { balance, history };
  } catch {
    points = null;
  }
  return NextResponse.json({ email: user.email ?? null, profile, points });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const user = await verifyCustomerUser(req);
  if (!user) {
    return NextResponse.json({ error: "Login required." }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  await ensureProfile(user);
  const updates = {
    display_name: String(body.display_name ?? "").trim().slice(0, 80) || null,
    phone: String(body.phone ?? "").trim().slice(0, 30) || null,
    default_address: String(body.default_address ?? "").trim().slice(0, 300) || null,
  };
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("id, role, display_name, phone, default_address, created_at")
    .single();
  if (error) {
    console.error("[account/me] update failed:", error);
    return NextResponse.json({ error: "Could not save your details." }, { status: 500 });
  }
  return NextResponse.json({ email: user.email ?? null, profile: data });
}
