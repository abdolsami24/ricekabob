// POST /api/delivery-fee  { address }
// Public quote endpoint used by the storefront while the customer types.
// Returns { fee_cents, miles, label } or { error: "far" | "not_found" }.
// The fee is always recomputed again on the server at checkout time.

import { NextResponse } from "next/server";
import { quoteDelivery } from "@/lib/geocode";
import { formatCents } from "@/lib/menu";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let address = "";
  try {
    const body = (await req.json()) as { address?: string };
    address = String(body.address ?? "").trim();
  } catch {
    /* handled below */
  }
  if (address.length < 6) {
    return NextResponse.json({ error: "not_found" }, { status: 400 });
  }
  const quote = await quoteDelivery(address);
  if (!quote.ok) {
    return NextResponse.json({ error: quote.error });
  }
  return NextResponse.json({
    fee_cents: quote.fee_cents,
    fee: formatCents(quote.fee_cents),
    miles: quote.miles,
    label: quote.label,
  });
}
