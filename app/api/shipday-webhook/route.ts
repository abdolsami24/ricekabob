// POST /api/shipday-webhook
// Receives delivery status callbacks from Shipday. Protected by the shared
// token in SHIPDAY_WEBHOOK_TOKEN (send it as ?token=... or the
// "x-shipday-token" header, matching how it is registered in Shipday).
// Always answers 200 {"ok":true}. Never changes money or items — it only
// records the latest delivery status text on the order.

import { NextResponse } from "next/server";
import { getServiceClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export async function POST(req: Request) {
  const expected = process.env.SHIPDAY_WEBHOOK_TOKEN;
  const url = new URL(req.url);
  const provided = url.searchParams.get("token") ?? req.headers.get("x-shipday-token") ?? "";
  const tokenOk = Boolean(expected) && provided === expected;
  console.log(`[shipday-webhook] token:${tokenOk ? "match" : expected ? "mismatch" : "absent"}`);

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    console.log("[shipday-webhook] non-JSON payload ignored");
    return NextResponse.json({ ok: true });
  }
  // Log the payload (status fields only — no secrets are ever in it).
  console.log("[shipday-webhook] payload:", JSON.stringify(payload).slice(0, 1000));

  if (!tokenOk || !supabaseConfigured()) {
    return NextResponse.json({ ok: true });
  }

  const status = pickString(payload, [
    "orderStatus",
    "status",
    "deliveryStatus",
    "event",
    "state",
  ]);
  const orderNumber = pickString(payload, ["orderNumber", "order_number", "orderNo"]);
  const shipdayId = pickString(payload, ["orderId", "order_id", "shipdayOrderId"]);

  if (status) {
    try {
      const supabase = getServiceClient();
      const value = `Shipday: ${status}`;
      let updated = false;
      if (orderNumber && /^\d+$/.test(orderNumber)) {
        const { data } = await supabase
          .from("orders")
          .update({ shipday_status: value })
          .eq("id", Number(orderNumber))
          .select("id");
        updated = Boolean(data && data.length > 0);
      }
      if (!updated && shipdayId) {
        await supabase
          .from("orders")
          .update({ shipday_status: value })
          .eq("shipday_order_id", shipdayId);
      }
    } catch (err) {
      console.error("[shipday-webhook] update failed:", err);
    }
  }
  return NextResponse.json({ ok: true });
}
