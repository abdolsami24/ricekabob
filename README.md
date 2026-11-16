# Madinah Market — Modern Website (Next.js + TypeScript)

Online ordering for **Madinah Market** (Denver Halal), 3126 S Parker Rd, Aurora, CO — phone **720-763-0786**.
Customers order **pickup or delivery** and pay on this website by Stripe. Delivery drivers are dispatched through **Shipday** (no marketplace commission). Includes a kitchen display (KDS) with a voice alarm, a customer TV order board, order tracking, and a PWA (installable web app).

---

## 1. What you need (accounts)

| Service | Why | Where the value goes |
|---|---|---|
| **Supabase** (free tier is fine) | Database + kitchen login | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Vercel** (free tier is fine) | Hosts the website | You paste all env vars into the Vercel project |
| **Stripe** | Card payments | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **Shipday** | Delivery drivers | `SHIPDAY_API_KEY`, `SHIPDAY_WEBHOOK_TOKEN` |

> ⚠️ **Secret keys are pasted by YOU into Supabase/Vercel/Stripe/Shipday dashboards — never into chat, never into this project's files.** The only file that lists them is `.env.example`, with placeholders.

## 2. Local setup (on a computer)

```bash
npm install
cp .env.example .env.local   # then fill in your values
npm run dev                  # http://localhost:3000
```

## 3. Supabase setup (one time)

1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste the whole of `supabase/schema.sql` → **Run**. This creates the `orders` table with privacy rules (RLS): the public can never read orders directly.
3. **Authentication → Users → Add user**: create the kitchen login (email + password) that staff will use on `/kitchen`.
4. **Project Settings → API**: copy the Project URL, the `anon` key, and the `service_role` key into your env vars.

## 4. Environment variables

Copy every name from `.env.example`. Where each value comes from:

- `NEXT_PUBLIC_SITE_URL` — your site address (e.g. `https://madinahdenver.com`, or the `*.vercel.app` address while testing).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase → Project Settings → API.
- `SUPABASE_SERVICE_ROLE_KEY` — same page, the **secret** `service_role` key. Server only. Never share it.
- `STRIPE_SECRET_KEY` — Stripe → Developers → API keys. **Leave it EMPTY to run in TEST MODE** (no real charges; orders are marked “test paid” so you can test everything safely).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe → Developers → API keys (starts with `pk_`).
- `STRIPE_WEBHOOK_SECRET` — created in step 5 below (starts with `whsec_`).
- `SHIPDAY_API_KEY` — Shipday → Integrations → API Credentials → Show API Key.
- `SHIPDAY_WEBHOOK_TOKEN` — a long random token **you invent**; you paste the same value into Shipday's webhook settings (step 6).
- `OWNER_NOTIFICATION_EMAIL` — already set to the owner's Yahoo address.
- `EMAIL_API_URL` / `EMAIL_API_KEY` — OPTIONAL. If set (e.g. a Resend-style HTTP email API), owner order emails are sent through it; if empty, order emails are written to the server log instead. Email is best-effort and never blocks an order.
- `TAX_RATE=0.08`, `RESTAURANT_LAT=39.65987`, `RESTAURANT_LNG=-104.85051` — already correct.
- `NEXT_PUBLIC_BOARD_TEST_MODE` — `true` only while testing the TV board (shows all of today's orders). **Must be `false` for real customers** (then the board shows paid orders from the last 4 hours only).

## 5. Stripe webhook (real payments)

Stripe → Developers → Webhooks → **Add endpoint**:

- URL: `https://YOUR-DOMAIN/api/stripe-webhook`
- Event: `checkout.session.completed`
- Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`, then redeploy.

## 6. Shipday webhook (delivery status)

Shipday → Integrations → Webhooks:

- URL: `https://YOUR-DOMAIN/api/shipday-webhook?token=YOUR-SHIPDAY_WEBHOOK_TOKEN`
  (use the exact token you put in the env vars; the endpoint also accepts an `x-shipday-token` header)
- The kitchen card and the tracking page will then show live statuses like “Shipday: ORDER_INSERTED”.

## 7. Deploy to Vercel

1. Push this project to a Git repo (or use `vercel` CLI / “Import project” and upload the folder).
2. In Vercel: **Project → Settings → Environment Variables** — paste every variable from your `.env.local`.
3. Deploy. Open the site, then set `NEXT_PUBLIC_SITE_URL` to the real domain and redeploy.
4. Add your custom domain in **Project → Settings → Domains** when ready.

## 8. Pages

| Page | Who | What |
|---|---|---|
| `/` | Customers | Menu, cart, pickup/delivery, tip, tax, checkout (cart survives reload; `?source=qr` shows the QR welcome note) |
| `/track` | Customers | Order number + phone (last 10 digits must match) → live timeline |
| `/kitchen` | Staff (login) | Live orders, “New order!” voice alarm, status buttons, ticket printing, auto-print |
| `/display` | TV in the shop | Big PREPARING / READY order numbers only — no names or prices, no login needed |

**Kitchen printing note:** the “Print ticket” button prints an 80 mm ticket through the browser. For silent automatic printing, run Chrome with the `--kiosk-printing` flag on the kitchen computer.

**Dish photos:** put real photos in `public/images/` named exactly like the menu ids (e.g. `lamb-shank.jpg`, `kobideh-kabob.jpg` — see `lib/menu.ts`). Missing photos degrade gracefully to a plain background.

## 9. Test-mode checklist (before real money)

With `STRIPE_SECRET_KEY` empty:

1. Place a pickup order → totals show subtotal + 8% tax + tip to the cent → the kitchen alarm sounds within ~5 s → owner email/log entry appears.
2. In `/kitchen`, move the order Accept → Preparing → Ready → the TV board moves the number to READY and flashes/announces.
3. Open `/track` with the order number + the same phone → timeline is correct. A wrong phone shows nothing.
4. Place a delivery order to an address ~2 miles away → fee is **$7.99**. An address 5+ miles away blocks checkout. After test-pay, the order is sent to Shipday (if the key is set) and the kitchen card shows the dispatch state.
5. Privacy: open `/kitchen` logged out → only a login screen. `/api/board-orders` returns numbers and statuses only.
6. Reload the storefront with items in the cart → the cart is still there.
7. On a phone, install the PWA (“Install app” / Add to Home Screen) → it opens full-screen with the Madinah icon and the menu loads.

## 10. Go-live checklist

- [ ] Real Stripe keys pasted into Vercel; Stripe webhook created; one small real order tested end-to-end.
- [ ] `NEXT_PUBLIC_BOARD_TEST_MODE=false` and redeployed.
- [ ] Shipday API key + webhook token set; one real delivery test done, then cancelled in Shipday if it was a test.
- [ ] Kitchen login user created in Supabase Auth; staff know the password (do not write it in this repo).
- [ ] Custom domain connected on Vercel; `NEXT_PUBLIC_SITE_URL` updated; Stripe + Shipday webhook URLs updated to the domain.
- [ ] PWA icons checked on a real phone (`public/icons/icon-192.png`, `icon-512.png`).
- [ ] Real dish photos added to `public/images/` where available.

## Money rules (built in — do not change casually)

- Sales tax **8%** of the food subtotal. Tips: percent of subtotal (max 30%) or a custom amount (max $200).
- Delivery fee by straight-line distance from the restaurant: ≤1 mi **$6.99** · ≤2 mi **$7.99** · ≤3 mi **$8.99** · ≤4 mi **$9.99** · beyond 4 miles: no delivery (pickup offered). The fee is always recomputed on the server at checkout — the browser's numbers are never trusted.
