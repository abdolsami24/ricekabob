// Money rules for Madinah Market. ALL money is integer cents.
// - Sales tax: 8% of subtotal (TAX_RATE env, default 0.08), rounded to cent.
// - Tip: percent of subtotal (0-30%) or a custom amount capped at $200.00.
// - Delivery fee: straight-line distance bands from the restaurant.

import { getMenuItem } from "./menu";

export interface OrderLine {
  id: string;
  name: string;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface Totals {
  subtotal_cents: number;
  tax_cents: number;
  delivery_fee_cents: number;
  tip_cents: number;
  total_cents: number;
}

export function taxRate(): number {
  const raw = Number(process.env.TAX_RATE ?? "0.08");
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : 0.08;
}

export function taxFor(subtotal_cents: number): number {
  return Math.round(subtotal_cents * taxRate());
}

/** Distance bands: within N miles -> fee in cents. Beyond the last band, no delivery. */
export const DELIVERY_BANDS: { miles: number; fee_cents: number }[] = [
  { miles: 1, fee_cents: 699 },
  { miles: 2, fee_cents: 799 },
  { miles: 3, fee_cents: 899 },
  { miles: 4, fee_cents: 999 },
];

/** Returns the fee for a distance, or null when the address is out of area. */
export function deliveryFeeForMiles(miles: number): { fee_cents: number; band_miles: number } | null {
  if (!Number.isFinite(miles) || miles < 0) return null;
  for (const band of DELIVERY_BANDS) {
    if (miles <= band.miles) return { fee_cents: band.fee_cents, band_miles: band.miles };
  }
  return null;
}

/** Tip in cents from either a percent choice or a custom amount. Server-validated. */
export function computeTipCents(
  subtotal_cents: number,
  tip_percent?: number,
  tip_custom_cents?: number
): number {
  if (typeof tip_custom_cents === "number" && Number.isFinite(tip_custom_cents)) {
    return Math.min(Math.max(Math.round(tip_custom_cents), 0), 20000); // cap $200.00
  }
  if (typeof tip_percent === "number" && Number.isFinite(tip_percent)) {
    const pct = Math.min(Math.max(tip_percent, 0), 30); // 0-30%
    return Math.round((subtotal_cents * pct) / 100);
  }
  return 0;
}

/**
 * Builds trusted order lines from client-sent {id, qty} pairs.
 * Throws on unknown items or bad quantities. Prices come only from lib/menu.
 */
export function buildLines(input: { id: string; qty: number }[]): OrderLine[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Cart is empty");
  if (input.length > 50) throw new Error("Too many items");
  const merged = new Map<string, number>();
  for (const raw of input) {
    const id = String(raw?.id ?? "");
    const qty = Math.floor(Number(raw?.qty));
    if (!getMenuItem(id)) throw new Error(`Unknown item: ${id}`);
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new Error(`Bad quantity for ${id}`);
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  const lines: OrderLine[] = [];
  for (const [id, qty] of merged) {
    const menuItem = getMenuItem(id)!;
    lines.push({
      id,
      name: menuItem.name,
      qty,
      unit_price_cents: menuItem.price_cents,
      line_total_cents: menuItem.price_cents * qty,
    });
  }
  return lines;
}

export function computeTotals(
  lines: OrderLine[],
  delivery_fee_cents: number,
  tip_cents: number
): Totals {
  const subtotal_cents = lines.reduce((sum, l) => sum + l.line_total_cents, 0);
  const tax_cents = taxFor(subtotal_cents);
  return {
    subtotal_cents,
    tax_cents,
    delivery_fee_cents,
    tip_cents,
    total_cents: subtotal_cents + tax_cents + delivery_fee_cents + tip_cents,
  };
}
