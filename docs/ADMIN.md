# Odour admin panel

The admin panel lives at `/admin` (login: `/admin/login`). It is a single EJS shell
(`views/AdminPanel.ejs`) plus vanilla JavaScript sections that load their data from
paginated JSON endpoints. No build step, no new runtime dependencies.

## Files

| Area | Files |
| --- | --- |
| Shell & login views | `views/AdminPanel.ejs`, `views/adminlogin.ejs`, `views/partials/admin/icons.ejs` |
| Styles (scoped to `.oa`, never loaded on the storefront) | `public/admin-assets/admin.css` |
| Front-end core (escaping templates, API client, router, modal/drawer/toast, list) | `public/admin-assets/js/core.js`, `charts.js`, `boot.js` |
| Sections | `dashboard.js`, `analytics.js`, `orders.js`, `products.js`, `inventory.js`, `customers.js`, `catalog.js` (categories, brands), `marketing.js` (discounts, banners), `content.js` (blog), `team.js` (admins, activity, account) |
| New JSON API (`/admin/api/v2`) | `routes/adminApi.js` |
| Pre-existing admin endpoints (kept, hardened) | `routes/admin.js` |
| Auth, permissions, CSRF | `middlewares/adminAuth.js` |
| Attribution | `helper/attribution.js`, `scripts/backfill-visit-sources.js` |
| Inventory adjustments & CSV | `services/adminInventory.js` |
| Query helpers (paging, Tehran date ranges) | `helper/adminQuery.js` |

Admin assets are served from `/admin-assets/…` (not `/admin/…`: a `public/admin` folder
would make `express.static` redirect `/admin` to `/admin/`). Vazirmatn is served from the
`vazirmatn` npm package at `/admin/fonts/vazirmatn/…`. The rich-text editor (Quill 1.3.7)
is loaded from cdnjs (already allowed by the CSP) only when an editor opens; if it cannot
load, a plain HTML textarea is shown instead.

## Sections

Dashboard · Traffic sources · Orders · Customers · Products · Inventory · Categories ·
Brands · Discount codes · Banners · Blog · Admins & permissions · Activity · My account.

Every list is filtered, sorted and paginated on the server, and filters are kept in the
URL hash (`#/orders?status=…`) so refresh and shared links keep them.

## Security

* **Permissions are enforced on the server.** New endpoints declare them per route
  (`requirePermission`), pre-existing `/admin/*` endpoints are covered by
  `legacyPermissionGuard` (path → permission map). Hiding UI is only cosmetic.
* **Permission model** (`models/Admins.js → effectivePermissions`):
  * `super_admin` → everything.
  * `admin` whose permissions were saved from the new UI (`permissionsManaged: true`) or
    who already had a non-empty `permissions` list → exactly those permissions.
  * Legacy `admin` with an empty list (created before this panel) → the full access it
    always had, **except** `manage_admins`. A super admin can tighten it at any time.
  * Nobody can grant a permission they do not hold; only a super admin can create/edit a
    super admin; the last active super admin cannot be demoted or deactivated; admins
    cannot deactivate themselves.
* **CSRF**: the panel gets a per-session token (`<meta name="csrf-token">`); every
  non-GET request under `/admin` must send it as `X-CSRF-Token`.
* **Login**: rate-limited (10 failures / 15 min / IP), session id regenerated on login
  (session fixation) while keeping a storefront login in the same browser.
* **Uploads**: images only (MIME + extension), 10 MB per file. `delete-image` accepts a
  bare file name only (path traversal fix) and never deletes a file a product still uses.
* Order details never include gateway payment tokens or return-session hashes.
* All dynamic text in the UI is HTML-escaped by the `html` template tag.

## Traffic-source & acquisition tracking

Model (`helper/attribution.js`):

1. Each storefront page request is classified into a *touch*: `utm_source` (with
   `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) wins; then Google click ids
   (`gclid`…); then the Referer host; no referer = **direct**.
2. Channels: Google, Torob, Snapp, Instagram, other search engines, social networks,
   referral sites, UTM campaign, direct, unknown.
3. **Not touches**: navigation inside the site, and returns from payment gateways
   (Zarinpal, SnappPay, TorobPay, Shaparak, …). Paying with SnappPay therefore never makes
   a customer "acquired from Snapp".
4. A signed, HttpOnly first-party cookie `odr_src` (90 days, marketing parameters only —
   no IP, no user id) stores:
   * **firstTouch** – the first touch recorded for the browser;
   * **lastTouch** – the most recent *non-direct* touch (a later direct visit never
     overwrites it).
5. Each `Visit` stores `entry` (first page of a visit from outside the site), `source`,
   `medium`, `campaign`, `utmSource`, `referrerHost`.
6. When an order is created, both touches are copied to `Order.acquisition` (purely
   additive; checkout logic and amounts are untouched). New OTP accounts store the first
   touch in `User.acquisition`.
7. Reports: visits/visitors per source (entries only), referring domains, landing pages,
   UTM campaigns, trend, orders, successful sales, revenue and conversion per source with a
   first-touch / last-touch switch. Conversion = successful orders ÷ unique visitors of the
   same source, shown only when both are tracked.
8. Historical orders have no acquisition data and are reported as
   **"Unknown / Not tracked"** — nothing is guessed.

### Back-filling historical visits (optional)

Visits recorded before this release have a stored `referer` but no `source`. To classify
them from that recorded data:

```bash
SITE_URL=https://www.odour.ir node scripts/backfill-visit-sources.js            # dry run: counts only
SITE_URL=https://www.odour.ir node scripts/backfill-visit-sources.js --apply    # write
node scripts/backfill-visit-sources.js --rollback                               # dry run of rollback
node scripts/backfill-visit-sources.js --rollback --confirm                     # remove ONLY back-filled fields
```

It only touches visits without `source`, marks what it wrote (`sourceBackfilled: true`),
is idempotent/resumable, and the rollback removes exactly those fields. Until it runs,
the traffic page shows how many page views in the range have no source data.

## Database changes (all additive and optional)

| Collection | Change | Existing records |
| --- | --- | --- |
| `orders` | `acquisition { firstTouch, lastTouch, model, capturedAt }`; `statusHistory[].note` now filled when an admin adds a note; indexes `createdAt`, `paymentStatus+createdAt`, `acquisition.lastTouch.source+createdAt` | Untouched; no acquisition = "Unknown / Not tracked" |
| `visits` | `entry, source, medium, campaign, utmSource, referrerHost`; index `entry+visitTimestamp` | Untouched (see back-fill) |
| `users` | `acquisition` (first touch at sign-up) | Untouched |
| `admins` | `permissionsManaged` (default `false`); new permission values `manage_banners`, `manage_inventory` | Legacy behaviour preserved (see permission model) |
| `recentactions` | New action / target-type enum values | Untouched |
| `discountcodes` | `usageLimit` validator accepts empty (= unlimited) | Untouched |
| `weblogs` | `images[]` accepts `/uploads/…` paths as well as absolute URLs | Untouched |

Indexes are created by Mongoose on start-up (background builds). No migration is
required to run the new version.

## Inventory

* Stock changes from the Inventory page are single conditional `$inc` updates (the same
  pattern checkout uses to reserve/release stock): **delta** changes can never go below
  zero, and **set** changes only apply if the stock still equals what the admin saw —
  otherwise the request is rejected with 409 and nothing changes. Reservations by
  concurrent orders are never overwritten.
* Matrix (colour × size) products: per-combination stock and per-combination "pause
  sale" (`variantStocks[].isOutOfStock`); totals and colour/size summaries are recomputed
  by the existing `Product` pre-save hook.
* CSV: export current stock, fill `new_stock`, import → preview → apply. Each row is
  applied as a guarded "set" against the exported `current_stock`; rows that changed in
  the meantime are rejected. Cells are protected against spreadsheet formula injection.
* The product editor only sends stock fields the admin actually edited, so saving a
  product never overwrites a concurrent reservation with stale numbers.

## Behaviour fixes in pre-existing endpoints

* `PUT /admin/products/edit/:id` no longer wipes fields that are not in the request
  (colours, sizes, images, tags, specs, special-offer slot, offer price, English name).
* Product deletion is refused while an open order holds reserved stock for it; shared
  image files (e.g. after "duplicate") are no longer deleted with the copy.
* Categories with sub-categories/products/articles and brands with products cannot be
  deleted (409 with counts); a category cannot become a child of its own descendant;
  categories now save SEO fields; brands save logo/description/status.
* Blog: saving an article with uploaded images failed (schema expected URL strings);
  publishing from the edit form now sets `publishedAt`.
* Discount codes: creating a code without a usage limit failed; an expired code can be
  edited/deactivated without picking a new date.
* `GET /admin` no longer loads every user, product and order into memory.
* `/admin/login` now redirects an already signed-in admin (it checked the storefront
  user's role before).

## Known limitations

* Discount restrictions to products/categories (`applicableProducts/Categories`) exist in
  the schema but are **not enforced by checkout**; the panel shows them read-only instead
  of offering a control that would have no effect. Enforcing them requires a change to
  checkout pricing (`routes/cart.js`, `routes/order.js`, `services/orderPricing.js`).
* Cancelling an order manually (status → "لغو شده") does not refund or restore stock —
  unchanged business rule. Paid SnappPay/TorobPay orders must be cancelled through the
  gateway buttons (which refund and restore stock); the panel warns about this.
* Attribution starts with this release; visits are attributed per browser (cookie).
  Blocked cookies or a different device show as a new direct/first visit.
* The legacy, non-matrix colour/size counters are still edited as part of the product
  form (read-modify-write, as before). Use the Inventory page for live stock changes.

## Tests

```bash
npm test                     # unit tests (incl. tests/attribution.test.js, tests/adminPanel.test.js)
npm run check                # syntax check of critical files
TEST_DB_URL=mongodb://127.0.0.1:27017/odour_admin_test npm run test:integration
```

The integration suite boots the real app against a scratch database (the name must
contain "test"; it is dropped before and after) and covers login/CSRF, dashboard and
attribution aggregates, partial product edits, atomic inventory changes and CSV import,
order filters/sanitising/notes/tracking, customers, catalog safeguards, discounts,
blog images, server-side permissions, storefront pages and checkout (attribution is
written on the order; a failed payment request rolls back stock and cart).
