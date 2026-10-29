# Implementation status

_Last updated: 2026-10-29 — Phase 6 (Deployment) prepared and verified locally; first VPS deploy pending._ Plan: [`phased-plan.md`](phased-plan.md).

## Environment observed

| Tool                | Status                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Node.js / npm       | v24.19.0 / 11.17.0                                                                       |
| Git                 | PortableGit 2.56.0.4 (not on PATH); remote: private `afsararavedu/kirana-voice-billing`  |
| Docker              | **Not installed** — Compose work deferred to Phase 6 (VPS)                               |
| PostgreSQL          | **Not installed** — local dev/test use `embedded-postgres` (real PostgreSQL 17 binaries) |
| Playwright Chromium | Installed via `npx playwright install chromium`                                          |

npm 11 blocks dependency install scripts by default. Approved (recorded in root `package.json` →
`allowScripts`): `prisma`, `@prisma/client`, `@prisma/engines`, `esbuild`,
`@embedded-postgres/windows-x64`.

## Branding (Waycup Chai), 2026-10-29

- Every page (shared `Layout`) has a footer: "© {year} Waycup Chai. All rights reserved.", a link to
  https://waycupchai.com and "Developed by ARM Gen Alpha Technologies", translated in en/hi/te/ur
  (brand names kept in Latin script, isolated left-to-right inside Urdu). Hidden when printing, so
  receipts are unchanged.
- Logos from the owner's artwork in `apps/web/public/`: round logo in the header and as the
  favicon / home-screen icon, wordmark on the sign-in and create-account pages.
- Not used: the banner and pack-label artwork (marketing content with phone numbers and prices),
  and the SBI UPI QR photo (a photo of the card is not reliably scannable, and one fixed QR would
  send every store's payments to the same account).
- Verified: `SiteFooter.test.tsx` (4 languages), web 31/31, e2e 20/20, lint, format, build; checked
  in the browser at desktop and 375 px width in English and Urdu.

## Phase 6 — deployment prepared (VPS deploy not yet run)

Exit criteria ("staging deploy observed healthy; restore drill documented") need the VPS and are
**not met yet**. Everything that can run without Docker has been built and verified.

### What was built (`deploy/`, runbook in [`deployment.md`](deployment.md))

- `Dockerfile.api` (Node 24, non-root, tini, readiness health check; Prisma CLI is now a runtime
  dependency so the image can run `prisma migrate deploy`), `Dockerfile.web` (build → Caddy).
- `docker-compose.yml`: `db` (PostgreSQL 17, UTF-8, volume), one-off `migrate` (profile, owner
  role), `api` (restricted role, read-only filesystem, no-new-privileges, `TRUST_PROXY=1`, secure
  cookies), `web` (Caddy, the only service with published ports). `backend` network is internal.
- `Caddyfile`: automatic HTTPS, HSTS, CSP, `Permissions-Policy: microphone=(self)` for voice,
  immutable caching for hashed assets, `/api/*` proxied to the API, 3 MB request cap.
- `postgres/roles.sql` + `init/10-roles.sh` (created once on an empty volume) and
  `postgres/grants.sql` (re-applied after each migration): `kirana_owner` runs migrations;
  `kirana_app` reads/writes rows only — no DDL, no TRUNCATE, no access to `_prisma_migrations`, no
  UPDATE/DELETE on any table guarded by `forbid_history_rewrite()` (found automatically), 30 s
  statement timeout.
- Scripts: `vps-check.sh` (read-only compatibility check), `deploy.sh` (build → verified backup
  if data exists → migrate → grants → start → HTTPS health), `backup.sh` (pg_dump + TOC check +
  checksum + retention), `restore.sh` (`--drill` into a scratch DB; `--live` only with
  `CONFIRM=replace-live-database`, after a safety backup).
- `deploy/.env.example`, `deploy/api.env.example` (placeholders; real files are git- and
  docker-ignored), `.dockerignore`, `.gitattributes` (LF for scripts).

### Defects found and fixed while verifying

- **Migrations would have failed on the VPS:** `prisma migrate deploy` starts with
  `CREATE SCHEMA IF NOT EXISTS`, which PostgreSQL checks against the database CREATE privilege
  even when the schema exists. The owner role now has it.
- **Returns would have failed for the restricted role:** `SELECT … FOR UPDATE` on `Sale` needs an
  UPDATE privilege. Granted on `Sale.id` only; the append-only trigger still refuses any update.

### Verified here (no Docker on this PC)

- `apps/api/test/deploy.test.ts` (9 tests): compose/Caddy/Dockerfile invariants and secret hygiene;
  and on real PostgreSQL — roles.sql as the image runs it, migrations as `kirana_owner`, grants.sql,
  then register → store → GSTIN → product → stock receipt → CSV import → Telugu voice parse →
  quote → voice bill → return → tax-invoice receipt → daily report → audit log → logout as
  `kirana_app` with production settings (`__Host-` Secure cookie); and the app role is refused
  CREATE/DROP/ALTER/TRUNCATE, `_prisma_migrations`, and UPDATE/DELETE on bills and history.
- Production web build served with the Caddyfile's headers: app, Google Fonts, voice parse, Telugu
  receipt and daily report work with no CSP violations.

### Still to run on the VPS

Image builds, Caddy, the shell scripts, `vps-check.sh`, staging deploy, backup and restore drill
(record results in `deployment.md` §6), then production.

## Phase 5 — completed features

### Decisions adopted (no providers had been chosen; change in `.env` without code changes)

- **Speech provider `browser` (default):** the device's own speech recognition (Web Speech API;
  Chrome on Android/desktop recognises en-IN, hi-IN, te-IN, ur-IN). No key; the app never receives
  or stores audio. **Privacy:** Chrome sends the audio to Google's speech service — tell staff, and
  set `SPEECH_PROVIDER=none` (typing only) if that is not acceptable.
- **Extractor `rules` (default):** a deterministic on-server parser for English, Hindi, Telugu and
  Urdu (native script and common romanised forms, native digits, "aadha/dedh/dhai/paav", "అర",
  "آدھا"). No network, no key, no cost; fully tested.
- **Extractor `anthropic` (opt-in):** Claude through the official `@anthropic-ai/sdk`, structured
  output (`messages.parse` + `zodOutputFormat`), `effort: low`, 15 s timeout, one retry. Model from
  `ANTHROPIC_MODEL`, default `claude-opus-5-5`; `claude-sonnet-5-5` or `claude-haiku-5-5` are
  cheaper choices if accuracy holds. **Any failure — refusal, timeout, invalid output — falls back
  to the rules parser**, so server-side refusal fallbacks were not enabled. **Not exercised against
  the live API** (no key on this machine): covered by unit tests with a stubbed SDK only.
- **Compatibility check:** `VOICE_EXTRACTOR=anthropic` without `ANTHROPIC_API_KEY`, or with a
  model outside the verified list, stops the server at startup. The client offers the microphone
  only when the server's speech provider supports the user's speech locale and the browser exposes
  speech recognition; otherwise the cashier types.
- **Clarify, never guess:** a name matching several products → "Which one?"; no quantity → "How
  much?"; a unit that does not convert (packet vs piece, litre vs kg) or an impossible quantity
  (1.5 soaps, 0.5 g of a per-kg item) → asks for the quantity in the product's unit. A money amount
  ("10 rupees of chilli") never becomes a quantity.
- **Voice suggests, the cashier confirms:** suggestions join the normal cart, which the server
  prices from the catalog and the cashier confirms with the total shown (Phase 3). A bill with any
  voice line is labelled `source: VOICE` (shown as "Voice bill"); pricing is identical.

### What was built

- `POST /stores/:id/voice/parse {transcript ≤ 500 chars, locale}` (any member, 30/min per user):
  transcript → extractor → strict `extractionSchema` (name, quantity, unit only; extra fields such
  as a price fail validation and the output is discarded) → tenant-scoped catalog matching (exact
  alias first, then contains, active products only, ≤ 5 candidates) → unit conversion with exact
  decimals (g↔kg, ml↔l, dozen→piece) → per-line status. Read-only: writes nothing.
- `GET /voice/config`: speech provider, its locales, extractor and model (never the key).
- Transcripts and API keys are redacted from logs; transcripts are never stored.
- Finalize accepts `source: 'MANUAL' | 'VOICE'` (recorded on the sale and in the audit entry).
- **Counter UI:** a Voice card on New bill — Speak (in the user's speech language, independent of
  the UI language), editable transcript, Find items, per-line review (pick among look-alikes, edit
  quantity, untick), "Add N to bill". Manual search keeps working alongside it.
- **Build guard:** `apps/web/scripts/check-bundle.mjs` fails the web build if a provider key,
  `ANTHROPIC_API_KEY` or a direct provider URL appears in the bundle.

### Defects found and fixed during Phase 5

- **"do"/"दो"/"دو" means both "two" and "give"** ("do kilo chawal" vs "chawal de do"): the parser
  first treated it as filler and lost the quantity. It is now the verb only after "de/दे/دے" or at the
  end of a phrase. Covered by fixtures.
- **Microphone e2e used the real recognizer:** current Chromium exposes unprefixed
  `SpeechRecognition`, which the app prefers; the test now stubs both names.
- ESLint lacked Node globals for the new web build script.

## Phase 4 — completed features

### Decisions adopted (the owner had not chosen; change here if they decide otherwise)

- **Invoice numbers:** one consecutive series per store per **Indian financial year** (1 April –
  31 March, IST), formatted `PREFIX/26-27/123`, or `26-27/123` without a prefix. Max 16 characters
  (GST rule 46): a prefix of up to 4 letters/digits leaves room for 99,999 bills a year; beyond
  that a bill is refused with `INVOICE_SERIES_FULL` rather than issuing an invalid number. The
  internal bill number (#1, #2, …) is kept for links and the sales list.
- **The prefix is locked once the financial year has a bill** (`409 INVOICE_PREFIX_LOCKED`) so a
  year never mixes two series. Set it before the first bill; it can change again from 1 April.
- **Tax invoice vs bill:** a receipt is titled "Tax Invoice" when the store had a GSTIN at the time
  of sale, otherwise "Bill". GST is shown either way because product prices carry a GST rate.
- **CGST/SGST:** every counter sale is treated as intra-state. Per GST rate, CGST = round(tax/2)
  half-up and SGST = tax − CGST, so the halves always add back to the stored tax (an odd paisa goes
  to CGST). IGST is not supported.
- **Business time is IST** for financial years, "today" in reports and times on receipts,
  whatever the server's or phone's time zone.
- **Daily report** counts bills on the day they were made and refunds on the day they were given
  (even for an older bill), so the figures match the cash drawer. Owners/managers only.
- **Low-stock report** lists active products that are out of stock (≤ 0) or at/below their alert
  level, out-of-stock first. Every member may see it.

### Receipts

- **Store details** (owner only): address, phone, GSTIN (format + mod-36 check character
  validated), invoice prefix, receipt footer — on the store page, alongside the receipt language.
- **Seller snapshot:** name, address, phone, GSTIN and footer are copied onto each bill
  (`Sale.seller`), so reprinting an old bill never shows later changes. Item names were already
  snapshotted per language in Phase 3.
- `GET /stores/:id/sales/:saleId/receipt[?lang=xx]` returns a ready-to-print receipt: names
  resolved for the language (local name, else the catalog name), GST summary by rate with CGST/SGST,
  payments with change, refunds and net amount. Any member of the store may print; cross-tenant
  requests are 404.
- **Receipt page** (`/stores/:id/sales/:saleId/receipt`): renders in the bill's receipt language
  regardless of the user's UI language; a selector reprints in another language. Urdu receipts are
  `dir="rtl"` with figures isolated as LTR (minus signs inside the isolate). The Print button uses
  the browser's print dialog; print CSS hides the app chrome and sizes the receipt for 80 mm thermal
  paper (`max-inline-size: 72mm`), which also prints as a narrow column on A4.

### Reports and audit log

- `GET /stores/:id/reports/daily[?date=YYYY-MM-DD]`: bill and return counts; taxable, GST,
  discount and gross totals; refunds; net sales; collected/refunded/net per payment method (cash net
  = what should be in the drawer); GST by rate with CGST/SGST. All five aggregates are read in one
  REPEATABLE READ snapshot. Impossible dates (e.g. 30 February) are 400.
- `GET /stores/:id/reports/low-stock` (up to 500 rows) with shortfall below the alert level.
- `GET /stores/:id/audit-logs?limit&before&entityType`: newest first, cursor paging, filter by
  Store/Product/Sale, actor display names. A cursor id from another store returns an empty page
  rather than neighbouring rows.
- Pages: Daily sales (date picker, defaults to today IST), Low stock (links to each product),
  Activity log (translated action names, change details "field: from → to", links to the bill or
  product, filter, load more). Linked from the store page by role.

### Database (migration `20261029180000_receipts`)

- `Store`: `address`, `phone`, `gstin` (CHECK on format), `invoicePrefix` (CHECK `^[A-Z0-9]{1,4}$`),
  `receiptFooter`.
- `Sale`: `fiscalYear`, `invoiceSeq`, `invoiceNumber` (unique per store; unique
  `(store, fiscalYear, invoiceSeq)`; CHECKs on positivity and allowed characters), `seller` JSON.
- `InvoiceCounter (storeId, fiscalYear) → nextSeq`, allocated by
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` while finalize holds the Store row lock, so serials
  are gap-free and consecutive exactly like bill numbers; a refused bill consumes nothing.
- **Existing bills are backfilled** (year from the IST bill time, serials in bill-number order, no
  prefix, seller = store name). `Sale` is append-only, so the migration disables its guard trigger
  for the single backfill `UPDATE` inside the migration transaction and re-enables it.

### Defects found and fixed during Phase 4

- **Urdu receipt date was scrambled:** it was forced left-to-right, but the Urdu date contains the
  month name in Urdu script. Found by looking at the receipt in the browser; dates now take their
  direction from their content. (Snapshots updated.)
- **Minus signs outside the LTR isolate** would sit on the far side of amounts in Urdu; moved
  inside on the receipt, the bill page and the daily report.
- **Test teardown failed on Windows** (`EBUSY` deleting the throwaway database folder while the
  just-stopped server still held it), failing `npm test` even with every test green. Throwaway data
  folders are now deleted by our own code with retries, and leftovers are cleared at the next start.
- **The e2e API used production rate limits**: with 16 tests signing up from one address, the
  20-per-window auth limit started refusing them on the phone run. The e2e server now raises the
  limits, as the integration tests already did; production defaults are unchanged and still tested
  in `test/auth.test.ts`.

## Phase 3 — completed features

### Business rules adopted (defaults proposed before the phase; change here if the owner decides otherwise)

- **GST:** computed per line, rounding half-up to the paisa, then summed. Tax-inclusive (MRP)
  prices: `taxable = round(net × 100 / (100 + rate))`, `GST = total − taxable`. Tax-exclusive:
  `GST = round(net × rate / 100)`, added on top. Discounts are absolute rupees per line, applied
  before tax. Implemented once, in `apps/api/src/modules/sales/pricing.ts`.
- **Overselling is blocked.** A bill that exceeds recorded stock fails with the list of short items
  (`409 INSUFFICIENT_STOCK`); the counter disables Confirm and shows "Only N in stock". If the shelf
  and the books disagree, the fix is a stock count (Phase 2).
- **Discounts:** OWNER/MANAGER only (403 `DISCOUNT_NOT_ALLOWED` for cashiers); recorded per line
  and in the audit log. Cashiers can bill.
- **Returns/cancellation:** OWNER/MANAGER only. Cancelling a bill = returning every line.
- No cash round-off to the nearest rupee, no credit (udhaar) payments, no customer records yet.

**Data model** (migration `20261029120000_billing`)

- `Sale` (per-store gap-free `number`, totals, `source` MANUAL/VOICE, receipt-language snapshot,
  cashier), `SaleItem` (full product snapshot: name, local names, unit, price, tax flags, gross,
  discount, taxable, GST, total), `SalePayment` (CASH/UPI/CARD, split payments, `tendered` for
  cash), `SaleReturn` + `SaleReturnItem` (refund method, refund and GST refunded, restocked flag).
- New ledger types `SALE` and `RETURN`, linked to their sale/return.
- **Database guards:** all five billing tables append-only (triggers); CHECKs enforce
  `grandTotal = taxableTotal + taxTotal`, `lineTotal = taxableValue + taxAmount`,
  `discount ≤ gross`, positive quantities and payments, `tendered` only for cash and ≥ amount;
  composite FKs keep lines, payments and returns inside their own store and sale.
- A sale is never modified. Its status (Paid / Partly returned / Returned) is **derived** from
  return records at read time.

**API** (`/api/v1/stores/:storeId/sales`, tenant-gated)

| Route                   | Roles          | Notes                                                               |
| ----------------------- | -------------- | ------------------------------------------------------------------- |
| `POST /quote`           | all            | Read-only pricing from the tenant catalog + stock shortages         |
| `POST /`                | all            | Finalize; `Idempotency-Key` required; `expectedGrandTotal` required |
| `GET /`, `GET /:saleId` | all            | Newest first, paged by bill number                                  |
| `POST /:saleId/returns` | OWNER, MANAGER | `Idempotency-Key` required                                          |

- Clients never send prices — the request schema is strict and has no price field.
- **Finalize transaction:** lock products in sorted id order → idempotency replay check →
  re-price from the catalog → `409 TOTAL_CHANGED` (with a fresh quote) if the total differs from
  what the cashier showed → stock check → payments must equal the total exactly → allocate bill
  number under the store row lock → insert sale, lines, payments, `SALE` ledger rows, cached stock,
  audit, stored idempotent response. Any failure rolls back everything, including the number.
- **Returns:** lock the sale row (serialises concurrent returns), reject over-returns across all
  previous returns, refund cumulatively —
  `round(total × (prev+qty)/sold) − round(total × prev/sold)` — so any sequence of partial
  returns refunds exactly the line total; optional restock writes `RETURN` ledger rows.

**Web**

- **New bill** (counter): multilingual product search; editable quantities (fractional only for
  weight/volume); line discounts for owners/managers; every change re-quoted by the server (the
  browser computes no prices); shortages shown per line; Cash / UPI / Card; cash received →
  change shown; Confirm button shows the exact total; one idempotency key per distinct request body
  so a retried confirm cannot double-bill; `TOTAL_CHANGED` refreshes the quote and asks the cashier
  to re-confirm with the customer.
- **Sales** list and **bill** page (lines with local names, GST rate, discounts, returned
  quantities, totals, payment and change, returns history) with a return form ("return
  everything" = cancel bill; restock toggle; refund method).
- On phones, cart lines become stacked cards.
- All new strings in en/hi/te/ur.

### Defects found and fixed during Phase 3

- **Mobile layout:** on a 412 px phone the page laid out at 498 px, so the browser zoomed out. Cause:
  `.stack` grid items default to `min-width: auto` and grew to fit wide tables, defeating the
  tables' own horizontal scroll; separately, visually hidden elements escaped their containers.
  This also affected the Phase 2 product page. Fixed with `minmax(0, 1fr)` and positioning
  contexts; the e2e suite now asserts no horizontal page overflow on the counter, bill and products
  pages. (Found because the mobile e2e test could not click Confirm.)
- The shared `MOVEMENT_TYPES` list lacked the new `SALE`/`RETURN` types (caught by the type checker).

## Phase 2 — completed features

**Data model** (migration `20261029000000_catalog_inventory`)

- `Product`: store-scoped; canonical name + per-language `localNames` (for receipts); optional SKU
  (unique per store); `UnitOfMeasure` (KG, G, L, ML, PIECE, PACK, DOZEN; immutable after creation);
  `sellingPrice Decimal(12,2)`, `taxRate Decimal(5,2)`, `priceIncludesTax` (MRP-style default);
  cached `stockQuantity Decimal(12,3)`; `lowStockThreshold`; archive via `isActive` (no deletes).
- `ProductAlias`: every searchable name (canonical, local names, spoken aliases), normalised (NFKC,
  zero-width joiners stripped, case/punctuation folded) and ordered. Not unique across products by
  design — Phase 5 must ask for clarification on shared aliases.
- `InventoryMovement`: append-only ledger (OPENING, RECEIVE, ADJUST, COUNT, DAMAGE, EXPIRY) with
  signed `quantityDelta`, `balanceAfter`, actor and monotonic `seq`.
- `IdempotencyKey`: stored responses per `(store, scope, key)` — reused by Phase 3 sale finalisation.
- **Database-level guards** (hand-written in the migration): CHECK constraints for non-negative
  price/stock/threshold, tax rate 0–100, non-zero deltas, non-negative balances; triggers that block
  UPDATE/DELETE on `InventoryMovement` and `AuditLog`; composite FKs `(storeId, productId) →
Product(storeId, id)` so a ledger row or alias can never reference another store's product.

**API** (all under `/api/v1/stores/:storeId/products`, tenant-gated)

| Route                                                                         | Roles          |
| ----------------------------------------------------------------------------- | -------------- |
| `GET /` (search `q` across all scripts, cursor pagination, `includeInactive`) | all members    |
| `POST /`, `PATCH /:id`, `POST /import`                                        | OWNER, MANAGER |
| `GET /:id`, `GET /:id/stock-movements`                                        | all members    |
| `POST /:id/stock-movements` (requires `Idempotency-Key`)                      | OWNER, MANAGER |

- Money/quantity cross the API as strings only (`"140.50"`, `"1.250"`); JSON numbers are rejected.
  Server arithmetic uses `decimal.js` via `Prisma.Decimal`, rounding half-up (money 2 dp, qty 3 dp).
  Countable units reject fractional quantities.
- Stock movement: `SELECT … FOR UPDATE` on the product row → idempotency replay check → balance
  check (409 `INSUFFICIENT_STOCK`) → ledger insert + cached balance update + audit + stored
  response, in one transaction. Concurrent identical retries resolve via the unique key.
- A physical count records a `COUNT` movement whose `balanceAfter` is the counted figure; a count
  that matches the books returns 200 with no ledger row.
- Product create/update/import and every stock movement write audit records (price changes record
  before/after).
- CSV import (RFC-4180 via `csv-parse`, BOM-tolerant, max 2000 rows / 1.5 MB, 2 MB body limit on
  this route only): validates every row, reports `{row, column, message}`, checks SKU duplicates in
  the file and catalog, supports dry run, and writes all rows in one transaction or none.

**Web**

- Products list with debounced multilingual search, stock with unit, price, low-stock and archived
  badges, cursor "load more"; add/edit form (local names, aliases, GST slabs, unit locked on edit);
  product page with stock-change form (one idempotency key per user action) and ledger; CSV import
  with dry-run preview and row-error table.
- Amounts/quantities formatted from strings with `Intl` (no float conversion), Latin digits and
  Indian lakh grouping in every UI language.
- All new strings in en/hi/te/ur; key-parity test enforces completeness.

### Defects found and fixed during Phase 2

- **Local DB encoding:** `embedded-postgres` on Windows initialised clusters as **WIN1252**, so
  Telugu/Hindi/Urdu text could not be stored. Now forced to UTF-8 (`initdb --encoding=UTF8
--locale=C`), with a test asserting `server_encoding = UTF8` and an Indic/Urdu round-trip.
  Production must also be UTF-8 (the official Postgres Docker image is by default) — verify in Phase 6.
- ICU formats `ur-IN` numbers with Western grouping (123,456) unlike en/hi/te (1,23,456); numbers
  now use one Indian convention for all languages.
- Stock counts were first stored as `ADJUST` with an English server-generated note; replaced by a
  dedicated `COUNT` type so the ledger stays language-neutral.

## Phase 1 — completed features

**Monorepo & tooling** — npm workspaces: `packages/shared` (Zod schemas, language constants, DTO
types), `apps/api`, `apps/web`. Strict TypeScript (`noUncheckedIndexedAccess`), ESLint flat config
(typescript-eslint, react-hooks, `no-console`), Prettier.

**API (`/api/v1`)**

- Env validated by Zod at startup; invalid config fails fast and reports field names only. Production
  refuses `COOKIE_SECURE=false`.
- pino structured logs with request IDs; cookies, auth headers, passwords and tokens redacted.
- helmet headers, `x-powered-by` off, 100 kB JSON limit, global rate limit + stricter auth limit,
  server request/header/keep-alive timeouts, graceful shutdown, stable JSON error shape that never
  leaks internals.
- `GET /health` (liveness) and `GET /health/ready` (DB check with 2 s timeout).
- Auth: register / login / logout / me / preferences. scrypt password hashing (params stored with
  hash), timing-equalised login, opaque session token in an httpOnly `SameSite=Lax` cookie
  (`__Host-` prefixed when secure), only the SHA-256 of the token stored, expiry enforced, session
  rotated on login.
- CSRF defence: SameSite cookies + Origin allowlist on state-changing requests + JSON-only bodies.
- Tenancy: `Store` + `StoreMembership(role OWNER|MANAGER|CASHIER)`. `requireStoreMember` derives
  `req.tenant` from the DB membership; non-members get the same 404 as nonexistent stores.
  `requireRole` gates owner-only actions. Client-supplied `ownerId`/`storeId` fields are stripped.
- Audit: append-only `AuditLog`, written in the same transaction as the change
  (`user.registered`, `store.created`, `store.updated` with before/after).
- Prisma 6 + PostgreSQL schema with `uuid`, `timestamptz`, `varchar` limits; initial migration
  `20261028000000_init` committed.

**Web**

- React 19 + Vite + React Router 7; i18next with complete `en`, `hi`, `te`, `ur` catalogs.
- `<html lang dir>` follows the UI language; Urdu switches the whole layout to RTL (CSS uses logical
  properties only). User-entered names wrapped in `<bdi>`; email/password fields forced LTR.
- Three independent language settings: UI language (per user, saved server-side), speech-input
  locale (per user, `en-IN|hi-IN|te-IN|ur-IN`), receipt language (per store, owner-only).
- Pages: sign in, register, stores (list/create), store detail, preferences. API errors shown as
  localized messages by code, never raw server text.

## Test evidence (commands run and results observed, 2026-10-29, after Phase 6 preparation)

| Check                  | Command                                                                | Result                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Formatting             | `npm run format:check`                                                 | All files pass                                                                                                                       |
| Lint                   | `npm run lint`                                                         | Exit 0, no warnings                                                                                                                  |
| Type check             | `npm run typecheck`                                                    | Exit 0 (shared, api, web)                                                                                                            |
| Prisma schema          | `npx prisma validate`                                                  | Valid                                                                                                                                |
| Migration ↔ schema     | `prisma migrate diff --from-url <migrated DB> --to-schema-datamodel`   | No difference after all 4 migrations (Phase 5 changed no schema)                                                                     |
| Migration validation   | `prisma migrate deploy` on empty UTF-8 PG 17 (test global setup)       | All 4 migrations applied cleanly                                                                                                     |
| Backfill on real data  | Phase 3 DB with 4 bills (incl. 23:59:59 and 00:00 IST on 31 Mar/1 Apr) | `25-26/1`, `25-26/2`, `26-27/1`, `26-27/2`; counters 3/3; Telugu store name intact; append-only trigger active again                 |
| Shared unit tests      | `npm run test -w @kirana/shared`                                       | 24/24 passed                                                                                                                         |
| API unit + integration | `npm run test -w @kirana/api`                                          | 170/170 passed (20 files), real PostgreSQL, clean exit                                                                               |
| Web unit tests         | `npm run test -w @kirana/web`                                          | 27/27 passed, incl. 4 receipt snapshots and the voice panel                                                                          |
| Production builds      | `npm run build`                                                        | all succeed; bundle check: no provider keys or provider URLs in the web bundle                                                       |
| Built API boots        | `npm run smoke:dist -w @kirana/api`                                    | `dist/server.js` in `NODE_ENV=production`: ready OK                                                                                  |
| End-to-end             | `npm run e2e`                                                          | 20/20 passed (desktop Chromium + Pixel 7), incl. typed and microphone voice flows                                                    |
| Visual check           | Browser pane, Urdu tax invoice, UI in English                          | RTL layout correct; ₹105.00 + ₹58.81 = ₹163.81; GST ₹13.97 (18%: CGST ₹4.49 + SGST ₹4.48); refund ₹29.41; net ₹134.40; change ₹36.19 |

Phase 5 test coverage highlights (`rule-extractor.test.ts`, `catalog-matcher.test.ts`,
`anthropic-extractor.test.ts`, `env.test.ts`, `test/voice.test.ts`, `VoicePanel.test.tsx`,
`e2e/voice.spec.ts`):

- **Fixture transcripts** in English, Hindi (Devanagari, romanised, Devanagari digits), Telugu and
  Urdu (Arabic-Indic digits, Arabic comma), including half/one-and-a-half/quarter words.
- **Adversarial transcripts:** money amounts never become quantities; "set price of rice to 1
  rupee", SQL, markup, emoji, 500-character and 80-item inputs all yield schema-valid name/quantity/
  unit output only; responses contain no price/total/tax keys; nothing is written to the database.
- **Adversarial LLM output** (fixture provider): a price field, a product id, a negative or float
  quantity, an unknown unit, 31 items, a total, plain text, a thrown error/timeout — each discarded,
  rules parser used, `fellBack: true`; valid output is used as-is.
- **Claude adapter** (SDK stubbed): structured-output request with `effort: low`, no forced tool
  choice, transcript fenced so a fake closing tag cannot escape; refusal / max_tokens / unparsable
  → ExtractionFailed. Startup refuses a missing key or an unlisted model.
- **Matching and clarification:** local names and aliases in all four languages; 500 g of a per-kg
  item → 0.5; a dozen eggs → 12 pieces; two soaps → AMBIGUOUS; archived products never suggested;
  packet vs piece → UNIT_MISMATCH; 1.5 soaps → INVALID_QUANTITY; no quantity → NEEDS_QUANTITY.
- **Tenancy/roles/limits:** another store's products (even its product id said aloud) never match;
  other tenants get 404; cashiers can use voice; sign-in required; per-user rate limit → 429.
- **UI:** microphone uses the speech locale (te-IN) while the UI is English; no recognizer or an
  unsupported locale → typing only; e2e typed order resolves look-alikes, server total ₹224.00,
  confirmed bill labelled "Voice bill"; stubbed-microphone Telugu order → ₹124.00, then a manual
  item → ₹154.00; no horizontal overflow on phone. Visual check: Urdu counter is RTL with Urdu
  product names.
  Phase 4 test coverage highlights (`test/receipts.test.ts`, `test/reports.test.ts`,
  `invoice.test.ts`, `Receipt.test.tsx`, `e2e/receipts.spec.ts`):

- **Invoice series:** `LK/26-27/1`, `/2` in order; a refused bill (stale total) consumes no serial;
  8 parallel bills get serials 1–8; a new year restarts at 1 even when last year reached 499;
  prefix change after the year's first bill → 409; FY boundary at IST midnight, not UTC.
- **Receipts:** Telugu tax invoice with local names and English fallback; reprint in Urdu via
  `?lang=ur`; unknown language → 400; CGST/SGST per rate; seller details frozen at sale time (later
  address/GSTIN change does not alter it; the next bill becomes a plain Bill); refunds and net after
  a partial return; cashiers can print; other tenants get 404 via either store path.
- **Daily report:** two bills (cash with ₹200 tendered, UPI + cash split), one cash refund, and
  another store's sales ignored → exact totals, per-method nets, GST by rate with the odd paisa on
  CGST; empty day; bad dates 400; cashier 403; outsider 404.
- **Low stock / audit:** ordering, shortfall, archived products excluded, restocked items drop
  off; audit paging across three pages, entity filter, foreign cursor → empty page.
- **Snapshot tests per language:** the full receipt HTML for en/hi/te/ur, plus assertions that an
  Urdu receipt is `lang="ur" dir="rtl"` while the UI is Hindi, that figures are LTR isolates, and
  that times are IST (09:15 UTC → 2:45 pm).
- **UI (e2e, desktop + phone):** owner saves store details (GSTIN upper-cased); Bill #1 prints as
  a plain English bill; reprint in Urdu is RTL with the Urdu item name; Print calls the browser's
  print; a later bill prints as a Telugu tax invoice with serial 2; daily report, low stock and
  activity log (with filter); no horizontal page overflow on phone.

Phase 3 test coverage highlights (`test/sales.test.ts`, `test/returns.test.ts`, `pricing.test.ts`):

- **Money:** tax-inclusive extraction and tax-exclusive addition; half-up at the paisa
  (4.995 → 5.00); `taxable + GST = total` for awkward rates; discounts before tax; partial returns
  3.33 + 3.34 + 3.33 = 10.00 exactly; client price fields rejected by the strict schema.
- **Confirm-what-was-shown:** a price edit between quote and confirm → `409 TOTAL_CHANGED` with a
  fresh quote and nothing written.
- **Overselling:** blocked, including duplicate lines for one product; a failed bill writes nothing
  and does not consume a bill number; 8 parallel bills against 5 units → exactly 5 succeed.
- **Idempotency:** retried confirm → one sale, identical response; 5 simultaneous confirms with one
  key → one sale. Same for returns.
- **Numbering/locking:** 8 parallel bills get numbers 1–8 with no gaps or duplicates; bills locking
  the same products in opposite orders do not deadlock; 4 parallel returns of the last units → one
  succeeds.
- **Cross-tenant:** another store's product cannot be quoted or billed (404 like a missing product);
  another store's sales cannot be listed, read or returned against, via either store path; nothing
  is written.
- **Database:** UPDATE/DELETE on sales, lines and payments fail (trigger); an inconsistent bill
  (`grandTotal ≠ taxable + tax`) is rejected by CHECK even when inserted directly.
- **Roles:** cashiers bill but cannot discount or process returns.
- **UI (e2e):** Telugu search → weighed quantity → server total → cash change → bill page → partial
  return → status and refund → stock 10 − 1.5 + 0.5 = 9 kg; oversell disables Confirm; no
  horizontal page overflow on phone.

Phase 2 test coverage highlights:

- **Cross-tenant** (`test/products.test.ts`): tenant B cannot list, read, update, import into, read
  the ledger of, or move stock for tenant A's products — via A's store path or by swapping A's
  product id into B's own path; responses are identical to nonexistent ids and nothing changes.
  Search never crosses stores. The DB itself rejects a movement referencing another store's product.
- **Concurrency** (`test/inventory.test.ts`): 20 parallel receive/damage requests produce no lost
  updates and a consistent `balanceAfter` chain; 6 parallel withdrawals against stock of 3 yield
  exactly 3 successes and 3 × 409.
- **Idempotency:** key required; retry replays the identical response with one ledger row; 5
  concurrent duplicates apply once; key reuse with a different body → 422.
- **History protection:** raw SQL UPDATE/DELETE on ledger and audit log fails (trigger); negative
  stock fails (CHECK) even bypassing the API.
- **Decimals:** float inputs, excess precision and fractional counts rejected; `0.1 + 0.2` and
  half-up rounding cases covered.
- **Roles:** CASHIER can read catalog and ledger but not create, edit, import or move stock.

Phase 1 cross-tenant tests (`test/tenancy.test.ts`) still pass unchanged.

## Known issues / risks

- **No Git** on this machine: the project is not under version control yet. `.gitignore` is ready.
- **Translations are machine-quality** (written by the developer, not native speakers). Hindi,
  Telugu and Urdu strings need native-speaker review before release.
- **Fonts load from Google Fonts.** For offline-tolerant shops, self-host Noto fonts (Phase 7).
- Web bundle is 528 kB (158 kB gzip; Vite warns above 500 kB) because `@kirana/shared` re-exports
  Zod schemas and all pages load eagerly; route-level code splitting is a cheap Phase 7 win.
- **GST compliance needs an accountant's review before go-live:** the invoice series format, the
  "Tax Invoice"/"Bill" titles, the fields printed (no HSN codes, no buyer details, no IGST for
  inter-state supplies) and the assumption that unregistered shops still show GST. Composition-
  scheme shops must issue a "Bill of Supply" without tax — not supported.
- Receipts print through the browser's print dialog. Direct ESC/POS printing to thermal printers
  (no dialog, auto-cut) is not implemented; test on the shop's actual printer and paper width.
- The daily report covers one day; date ranges, per-cashier totals and CSV export are not built.
- Activity-log details show raw field names (e.g. `sellingPrice: 10.00 → 12.00`); the action names
  are translated.
- `Sale.seller` and the invoice columns were backfilled for existing bills by a migration that
  briefly disables the `Sale` append-only trigger. Phase 6 must run migrations as the table owner,
  inside the transaction `prisma migrate deploy` uses, after a verified backup.
- **Billing serialises per store** (the bill-number counter row is locked during finalize). That is
  fine for one or two counters; revisit if a store runs many simultaneous counters.
- Idempotency keys are stored indefinitely; add a retention job (e.g. delete keys older than 7
  days) in Phase 6/7.
- Cash round-off to the nearest rupee, credit (udhaar) accounts and customer records are not
  implemented.
- **Phase 2 migration was edited before release** (added `ProductAlias.position` and the `COUNT`
  movement type). Safe only because it has never been applied to a persistent database. If you ran
  `npm run dev:db` between the phases, delete `apps/api/.pgdata-dev` before running it again. From
  now on, migrations are append-only.
- CSV row-level validation messages are English (from the shared schemas); column names and the
  surrounding UI are localised. Localising schema messages is a Phase 7 item.
- Search uses `LIKE '%term%'` on a B-tree-indexed column — fine for a kirana-sized catalog
  (hundreds to a few thousand items). Add `pg_trgm` GIN indexes if catalogs grow large or for
  Phase 5 fuzzy matching.
- Deleting a user would fail (FK `SET NULL` on the append-only ledger/audit log is blocked by the
  trigger). Accounts should be deactivated/anonymised, not deleted — design this in Phase 7.
- `MaxListenersExceededWarning` appears in API test output from many parallel supertest requests on
  one agent — test-harness only.
- Registration reveals whether an email is already registered (409). Acceptable for sign-up UX;
  revisit with invite-only onboarding.
- `embedded-postgres` is a dev/test convenience only. Production uses a real PostgreSQL server
  (Phase 6) with a least-privilege role — not yet provisioned.
- No password reset, staff invitation or session-management UI yet (Phase 7).
- Controllers are thin route handlers in `*.routes.ts` (validation → service → DTO); split into
  separate controller files if they grow.
- Vite build prints Rollup warnings about comment annotations inside `zod` — harmless.

- **Voice:** the Claude extractor has not been run against the live API (no key here) — try it on
  staging with real transcripts and compare with the rules parser before switching. Browser speech
  needs Chrome and network; recognition quality for Telugu/Urdu varies by device. The rules parser
  covers common phrasings only (numbers up to twelve in words; larger numbers must be digits).
  Server-side speech providers (e.g. a cloud STT for devices without Chrome) are not implemented;
  the `SPEECH_PROVIDER` setting is where one would be added.
- **`npm audit`** reports advisories in existing dependencies: `csv-parse` < 7.0.2 (moderate; used
  by CSV import — upgrade in Phase 7), `deepmerge-ts` via Prisma 6 (fix requires Prisma 7), and
  Vitest tooling (dev only). Not introduced by Phase 5.

## Next recommended step

**Finish Phase 6 on the VPS** following [`deployment.md`](deployment.md): push the code to a
private GitHub repository, prepare the server (§1), fill `deploy/.env` and `deploy/api.env` on the
server only, run `vps-check.sh`, deploy staging, take a backup and run the restore drill, then
production. Then Phase 7 (hardening).
