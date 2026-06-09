# eBay Two-Way Integration — Scope

Status: planning / scoping. All API facts verified against developer.ebay.com (June 2026).
Exact constant values (category IDs, condition-descriptor value IDs) must be resolved
live via API calls before shipping — they are category-specific and change over time.

## 1. Goal

Let a seller connect their eBay account once, push their site marketplace listings to
eBay as fixed-price listings (single quantity), and keep the two in sync **both ways**:

- **Sold on our site → end the eBay listing.**
- **Sold on eBay → mark the card sold on our site** (and pull it from inventory).

## 2. What we already have (head start)

- An eBay developer app + keys (`EBAY_APP_ID` / `EBAY_CERT_ID`) and a working
  **client_credentials (application) token** flow in `app/api/feed/ebay-hits/route.ts`
  (used for the Browse API). This same app token works for the **Taxonomy API**.
- A clean sold-state model in `lib/listingStatusSync.ts`:
  `sold_channel: 'marketplace' | 'auction' | 'claim'`, `sold_state: 'claimed' | 'sold'`,
  plus `applyListingSale()` / `clearListingSale()` helpers (idempotent, already wired for
  Facebook auctions + claim sales). **eBay becomes a fourth channel (`'ebay'`)** that reuses
  these helpers.
- `listings` table with all card fields (year, brand, player, card_number, condition_type,
  raw_grade, grading_company, grade, asking_price, photos[], shipping_options), `status`
  (draft/active/sold/removed), `sold_price`, `sold_at`.
- Marketplace purchase path already flips listings sold and pulls the row from inventory
  (`/api/inventory/mark-row`) — the eBay-sold path mirrors this.

## 3. Authentication

Two token types, both needed:

| Token | Grant | Used for | Lifetime |
|---|---|---|---|
| Application token (have it) | client_credentials | Browse API, **Taxonomy API** | access 2h |
| **User token (new)** | authorization_code | Inventory, Account, Fulfillment (per-seller) | access **2h**, refresh **~18 months** |

**User OAuth flow (new):**
1. Redirect seller to `https://auth.ebay.com/oauth2/authorize?client_id=…&redirect_uri=<RuName>&response_type=code&scope=<scopes>&state=<csrf>`.
2. eBay redirects back to the RuName accept URL with `?code=…`.
3. Exchange: `POST https://api.ebay.com/identity/v1/oauth2/token` (Basic auth `client_id:client_secret`, form body `grant_type=authorization_code&code=…&redirect_uri=<RuName>`) → `access_token`, `refresh_token`, `refresh_token_expires_in`.
4. Store the **refresh token** (encrypted). Mint access tokens on demand via
   `grant_type=refresh_token` (no re-consent until refresh token expires or is revoked).

**Scopes** (space-separated, URL-encoded in the consent URL):
- `https://api.ebay.com/oauth/api_scope/sell.inventory`
- `https://api.ebay.com/oauth/api_scope/sell.account`
- `https://api.ebay.com/oauth/api_scope/sell.fulfillment` (or `.readonly` for sync-only)
- `https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly` (on the **app** token)

**Setup prerequisites (eBay developer portal):**
- Configure a **RuName** (separate for sandbox + production) with HTTPS accept/decline URLs.
- Register the **mandatory marketplace-account-deletion** webhook endpoint + verification token (required for any production app — see §7).

## 4. One-time per-seller setup (after connect)

1. **Opt in to business policies:** `POST /sell/account/v1/program/opt_in` with program
   `SELLING_POLICY_MANAGEMENT` (check via `getOptedInPrograms`). Required before offers can
   reference policies.
2. **Ensure business policies exist** and capture their IDs via the Account API
   (`getFulfillmentPolicies` — needs `marketplace_id`, `getPaymentPolicies`,
   `getReturnPolicies`); create any missing ones. We can seed a fulfillment policy from the
   listing's `shipping_options`.
3. **Create an inventory location:** `POST /sell/inventory/v1/location/{merchantLocationKey}`
   (name + postalCode + country; `locationTypes: WAREHOUSE`). Required before publishing.

## 5. Listing push pipeline (per card)

Base: `https://api.ebay.com/sell/inventory/v1` (user token, `sell.inventory` scope).

1. **Resolve category + required aspects** (app token, Taxonomy API):
   - `GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US` → tree id.
   - `GET /commerce/taxonomy/v1/category_tree/{treeId}/get_item_aspects_for_category?category_id=261328`
     → aspects with `aspectConstraint.aspectRequired`. **Resolve the card-singles leaf
     dynamically** (261328 = "Sports Trading Card Singles" today; verify, possible restructure).
   - For graded value IDs: `GET /sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies`.
2. **Create/replace inventory item:** `PUT /sell/inventory/v1/inventory_item/{sku}`
   (`sku` = our listing id). Body:
   - `availability.shipToLocationAvailability.quantity = 1`
   - `condition`: `LIKE_NEW` (id `2750`) if graded, `USED_VERY_GOOD` (id `4000`) if raw
   - `conditionDescriptors` for graded: `27501`=Grader, `27502`=Grade, `27503`=Cert# (optional)
     — value IDs from `getItemConditionPolicies`
   - `product`: `title`, `description`, `imageUrls` (our Supabase **HTTPS** URLs — self-hosted
     allowed, up to 24, don't mix with EPS), `aspects` (Sport + Graded required; Player, Set,
     Season/Year, Manufacturer, Card Number, Parallel/Features recommended — mapped from our row)
3. **Create offer:** `POST /sell/inventory/v1/offer` — `sku`, `marketplaceId: EBAY_US`,
   `format: FIXED_PRICE`, `categoryId`, `listingDescription`, `listingPolicies`
   (fulfillment/payment/return IDs), `pricingSummary.price` (= `asking_price`),
   `merchantLocationKey` → returns `offerId`.
4. **Publish:** `POST /sell/inventory/v1/offer/{offerId}/publish` → returns eBay `listingId`.
5. Persist `ebay_offer_id`, `ebay_listing_id`, `ebay_status` on our listing row.

**Review gate (the "semi-automated" part):** before publish, show the seller a screen
pre-filled from the listing with any **required** aspects we couldn't auto-derive
(Sport, Graded, grader/grade). Save as an unpublished offer (draft) until complete, then
publish. Avoids `publishOffer` failures on missing required aspects.

## 6. Two-way sync

### Direction A — sold on our site → end eBay listing
Hook into the existing sale path (marketplace purchase RPC, FB auction/claim sync that calls
`applyListingSale`). When a listing with an `ebay_offer_id` flips to sold:
- `POST /sell/inventory/v1/offer/{offerId}/withdraw` — ends the live listing but **keeps the
  offer + inventory item** so it can be re-published later if the sale falls through.
- Set `ebay_status = 'withdrawn'`.

### Direction B — sold on eBay → mark sold on our site
**Backbone = polling** (most reliable; eBay best practice even with push):
- Scheduled poller (Vercel cron) per connected seller:
  `GET /sell/fulfillment/v1/order?filter=lastmodifieddate:[<lastPoll>..]` (user token,
  `sell.fulfillment[.readonly]`).
- For each `order.lineItems[]`, match `lineItem.sku` (= our listing id) → call
  `applyListingSale(supabase, userId, [listingId], 'ebay', 'sold', price)` and pull the row
  from inventory (same as a marketplace purchase). Store `last_order_poll_at`.
- Orders only appear after checkout completes (excludes pending payment) — good for us.

**Optional near-real-time layer:** legacy Trading API Platform Notifications
(`FixedPriceTransaction` / `ItemSold` via `SetNotificationPreferences`) push a SOAP/XML
notification on sale. The **modern Commerce Notification API has no confirmed seller
"order/sold" topic** (verify via `getTopics`), so push, if used, comes from the Trading API —
and must still be reconciled against `getOrders`.

### The oversell race (biggest risk)
Single-quantity cards listed in two places: between a sale on platform X and the takedown on
platform Y, both could sell. Mitigations to decide on:
- Poll eBay frequently (1–5 min) and withdraw the eBay offer **immediately** on our-side sale.
- **Reserve-on-checkout:** when a buyer opens checkout on our site, withdraw the eBay offer
  *first*, then confirm the purchase; re-publish if they abandon. Tightest protection, more
  moving parts.
- Accept residual risk + a clear "if double-sold, cancel one" runbook (eBay cancellations hurt
  seller metrics, so bias toward protecting the eBay side).

## 7. Mandatory: marketplace account-deletion webhook
Required for every production app regardless of features.
- Register HTTPS endpoint + verification token (32–80 chars) in the portal.
- Challenge-response: eBay `GET <endpoint>?challenge_code=…`; respond `200` with
  `{ "challengeResponse": SHA256(challengeCode + verificationToken + endpoint) }`,
  `Content-Type: application/json`. (Confirm field ordering live.)
- On a real deletion notice, purge that user's eBay data.

## 8. Data-model changes (Supabase)

New table `ebay_connections`:
`user_id (pk)`, `refresh_token` (encrypted, service-role only), `refresh_token_expires_at`,
`merchant_location_key`, `fulfillment_policy_id`, `payment_policy_id`, `return_policy_id`,
`policies_opted_in bool`, `connected_at`, `scopes`.

New table `ebay_sync_state`: `user_id (pk)`, `last_order_poll_at`.

`listings` additions:
`ebay_offer_id`, `ebay_listing_id`, `ebay_status` ('none'|'draft'|'published'|'withdrawn'|'error'),
`ebay_synced_at`, `ebay_last_error`. (SKU = existing `id`.)

`sold_channel`: add `'ebay'` to the TS union (`lib/listingStatusSync.ts`) and any DB check.

Secrets: refresh tokens are long-lived credentials — encrypt at rest, never expose to the
client, access only via service-role server routes.

## 9. New server routes / jobs

- `GET /api/ebay/connect` → build consent URL, redirect (user-authenticated).
- `GET /api/ebay/callback` → exchange code, store refresh token, run one-time setup (§4).
- `POST /api/ebay/list` → push selected listing(s): taxonomy resolve → inventory item →
  offer → (review) → publish.
- `POST /api/ebay/withdraw` → withdraw offer(s); also called internally from the sale path.
- `POST /api/ebay/sync` → the cron poller (Direction B).
- `GET|POST /api/ebay/webhook/account-deletion` → challenge-response + deletion handling.
- (optional) `POST /api/ebay/webhook/notifications` → Trading API push, signature-verified.

Reusable from current code: env-var pattern, token-fetch/cache structure (extend for
per-user tokens), fetch plumbing.

## 10. UI

- **Settings:** "Connect eBay account" (+ connected state / disconnect).
- **My Listings:** per-listing "List on eBay" + status badge (Draft / Live / Withdrawn / Error),
  a review modal for required aspects, and a bulk "Push to eBay."
- Show the eBay listing URL once published; surface `ebay_last_error` on failures.

## 11. Build phases

0. **eBay app config** — RuName (sandbox+prod), scopes, account-deletion endpoint; sandbox creds.
1. **Connect flow** — OAuth, `ebay_connections`, one-time setup (opt-in, policies, location).
2. **Push pipeline** — taxonomy mapping + review gate + create/publish; status on My Listings.
3. **Direction A sync** — withdraw on our-side sale (hook into `applyListingSale`).
4. **Direction B sync** — `getOrders` poller → mark sold; **account-deletion webhook**
   (required before production).
5. **Hardening (optional)** — Trading API push notifications; reserve-on-checkout oversell guard.

## 12. Decisions (locked)
- **Environment:** sandbox first, then promote to production.
- **Oversell strategy:** fast-withdraw + frequent poll — withdraw the eBay offer immediately
  on an our-side sale, poll eBay every 1–5 min. (Reserve-on-checkout deferred unless the
  residual race proves to be a problem.)
- **Publish mode:** direct publish when a listing has all required fields auto-derivable;
  fall back to the review gate only when a required aspect is missing.
- **Seller scope:** build and prove end-to-end against the owner's own eBay account first,
  then generalize the per-seller connection model to other sellers.

## 13. Verify-live-before-coding checklist
- Card-singles leaf category id (261328 today; resolve dynamically).
- `aspectRequired` set for that category (read at runtime).
- Condition-descriptor **value** IDs (grader/grade) via `getItemConditionPolicies`.
- Exact Taxonomy scope string and account-deletion hash field ordering.
- Inventory API daily call limit (Application Growth Check) + seller listing limits/fees
  (account-level, not API-documented).
- Whether any modern Notification API seller order topic exists (via `getTopics`).
