# eBay Two-Way Integration — Test Plan

Companion to `docs/ebay-integration-scope.md`. Covers every phase of the eBay
integration. All testing happens in eBay's **sandbox** first; a final smoke pass runs
against production with one real low-value card before general use.

Legend: **[U]** unit, **[I]** integration (hits eBay sandbox), **[E]** end-to-end (UI),
**[R]** regression, **[S]** security.

---

## 0. Test environment & prerequisites

- eBay **sandbox** developer keys, a sandbox **RuName**, and a sandbox **seller** account
  (the owner's test account) with managed payments enabled.
- A sandbox **buyer** account to purchase listings and trigger the eBay→site sale path.
- App pointed at sandbox base URLs (`api.sandbox.ebay.com`, `auth.sandbox.ebay.com`) via env
  flag, so no real listings/money are touched.
- A Supabase test project (or test user) with seeded listings — a mix of:
  - graded (PSA/SGC/BGS, various grades), raw (different `raw_grade`s),
  - with 1 photo, multiple photos, and zero photos,
  - with and without `shipping_options`,
  - card listings and `listing_type='set'` listings.
- Ability to run the poller on demand (manual trigger of `/api/ebay/sync`) and to fast-forward
  its `last_order_poll_at`.

**Exit criteria for the whole effort:** all P0/P1 cases pass in sandbox; the regression suite
(§8) is green; one production smoke test (§9) lists, sells, and withdraws a single real card
correctly; refresh-token reconnect works.

---

## 1. OAuth connect flow

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 1.1 | E | Seller clicks "Connect eBay," consents in sandbox | Redirected back to callback; `ebay_connections` row created with refresh token stored (encrypted) |
| 1.2 | I | Code→token exchange | Access + refresh tokens returned; access cached, refresh persisted; never logged in plaintext |
| 1.3 | U | Access-token expiry → auto-refresh | Expired access token transparently renewed via `grant_type=refresh_token`; no re-consent |
| 1.4 | E | Seller declines consent | Graceful "connection cancelled" message; no row written |
| 1.5 | E | `state` mismatch / CSRF on callback | Request rejected; no token stored |
| 1.6 | I | Refresh token invalid/expired (simulate revoke) | App detects, marks connection "needs reconnect," prompts re-auth; no crash |
| 1.7 | E | Disconnect eBay | Connection + tokens purged; eBay buttons disabled in UI |
| 1.8 | S | Refresh token never reaches the client | Token absent from all client payloads/network responses; readable only via service-role |

## 2. One-time per-seller setup

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 2.1 | I | `SELLING_POLICY_MANAGEMENT` opt-in | Program opt-in succeeds; `getOptedInPrograms` confirms; `policies_opted_in` set |
| 2.2 | I | Already opted in | Idempotent — no error, no duplicate |
| 2.3 | I | Fetch existing business policies | Fulfillment/payment/return IDs captured onto the connection |
| 2.4 | I | Missing a required policy | App surfaces a clear "create your X policy on eBay" prompt (or auto-creates per design) |
| 2.5 | I | Create inventory location | `merchantLocationKey` created (204) and stored; re-run is idempotent |
| 2.6 | I | Setup runs once, not on every list | Setup is skipped when the connection already has policy IDs + location |

## 3. Field mapping & validation (pre-publish)

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 3.1 | U | Graded card → condition `2750` + `conditionDescriptors` (27501 grader, 27502 grade, optional 27503 cert) | Correct descriptor IDs; grader/grade **value** IDs resolved from `getItemConditionPolicies`, not hardcoded |
| 3.2 | U | Raw card → condition `4000` | No graded descriptors sent; `conditionDescription` populated from raw grade |
| 3.3 | U | Aspect mapping | Sport + Graded (required) populated; Player/Set/Year/Manufacturer/Card Number/Parallel mapped when present |
| 3.4 | I | Required aspects resolved live | `getItemAspectsForCategory` consulted; any aspect with `aspectRequired:true` enforced |
| 3.5 | U | Image URLs | All `photos[]` passed as HTTPS; >24 trimmed to 24; zero-photo card flagged (can't publish without an image) |
| 3.6 | U | Price/qty | `pricingSummary.price` = `asking_price`; quantity = 1 |
| 3.7 | U | Title/description length + HTML | Title truncated to eBay's limit; description sanitized |
| 3.8 | U | Category resolution | Leaf category resolved dynamically (not a hardcoded 261328) |

## 4. Listing push pipeline (site → eBay)

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 4.1 | E | Push a complete graded listing | Inventory item → offer → publish; `ebay_listing_id`/`ebay_offer_id` stored; `ebay_status='published'`; live in sandbox |
| 4.2 | E | Push a complete raw listing | Same, raw condition path |
| 4.3 | E | Listing missing a required aspect (e.g. Sport) → **direct-publish-when-complete** behavior | Publish blocked; review modal opens asking only for the missing field; publishes after fill |
| 4.4 | I | `publishOffer` rejects (eBay validation error) | Error captured to `ebay_last_error`; `ebay_status='error'`; surfaced in UI; offer left unpublished for retry |
| 4.5 | E | Re-push an errored listing after fix | Succeeds; status flips to published |
| 4.6 | U | Idempotency / double-click | Re-running create uses same SKU (= listing id); no duplicate eBay listing |
| 4.7 | E | Bulk push N listings | Each independent; partial failures reported per-listing, successes still publish |
| 4.8 | E | Push a `listing_type='set'` listing | Handled per design (single offer for the set) or cleanly excluded with a message |
| 4.9 | I | Price/availability edit after publish | `updateOffer` reflects new price/qty on the live listing |

## 5. Direction A — sold on our site → withdraw on eBay

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 5.1 | E | Buyer buys the card on our marketplace | On sale, `withdrawOffer` called; eBay listing ends; `ebay_status='withdrawn'`; `sold_channel='marketplace'` |
| 5.2 | I | FB auction/claim sale of a card that's also on eBay | Existing `applyListingSale` path also triggers eBay withdraw |
| 5.3 | U | Withdraw keeps the offer | Offer object persists (not deleted) so it can be re-published |
| 5.4 | E | Re-list after a fallen-through sale | `publishOffer` on the retained offer brings it back live |
| 5.5 | I | Withdraw when card was never on eBay (`ebay_offer_id` null) | No-op; no error |
| 5.6 | I | Withdraw API fails (eBay 5xx) | Retried/queued; flagged for reconciliation; sale on our side still completes |

## 6. Direction B — sold on eBay → mark sold on our site (poller)

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 6.1 | E | Sandbox buyer purchases a pushed card; run poller | `getOrders` returns it; `lineItem.sku` matched to our listing; `applyListingSale(..., 'ebay', 'sold', price)`; card pulled from inventory |
| 6.2 | U | SKU → listing match | Correct listing flipped; `sold_price` = eBay order line total; `sold_at` stamped once |
| 6.3 | U | Incremental polling window | Only orders since `last_order_poll_at` processed; watermark advances |
| 6.4 | U | Idempotent re-poll | Re-processing the same order does not double-apply or re-stamp `sold_at` |
| 6.5 | I | Multi-line order (buyer buys 2 of our cards together) | Every line item matched; all corresponding listings flipped |
| 6.6 | I | Order line with an unknown SKU (listed outside our app) | Ignored gracefully; no error |
| 6.7 | I | Poller runs with no new orders | No-op; watermark still advances; no spurious writes |
| 6.8 | I | Poll across token expiry | Access token refreshed mid-run; poll completes |

## 7. Oversell race (fast-withdraw + frequent-poll)

| ID | Type | Scenario | Expected |
|---|---|---|---|
| 7.1 | E | Card sells on our site; eBay withdraw fires immediately | eBay listing ends within seconds; not buyable on eBay afterward |
| 7.2 | E | Card sells on eBay; next poll (≤5 min) marks it sold here | Listing flips sold on our side; removed from marketplace/storefront |
| 7.3 | I | Simulated true double-sale (sold both places within the race window) | System detects the conflict, flags it for manual resolution, alerts the seller; neither side silently oversells without a record |
| 7.4 | U | Poll cadence config | Poller honors the configured interval; back-to-back runs don't overlap/double-process |

## 8. Regression — existing flows must be unaffected [R]

| ID | Scenario | Expected |
|---|---|---|
| 8.1 | Marketplace buy flow (no eBay involved) | Unchanged: purchase RPC, email, inventory pull all work |
| 8.2 | FB auction + claim sale sync (`applyListingSale`/`clearListingSale`) | Unchanged behavior; eBay channel addition doesn't alter auction/claim buckets |
| 8.3 | `sold_channel` enum extended to include `'ebay'` | Existing 'marketplace'/'auction'/'claim' rows + metrics/badges unaffected |
| 8.4 | Public storefront `/seller/[handle]` + Browse `ebay-hits` feed | Still work; app-token Browse path untouched by the new user-token code |
| 8.5 | My Listings page for sellers with no eBay connection | Renders normally; eBay actions hidden/disabled, no errors |

## 9. Security & secrets [S]

| ID | Scenario | Expected |
|---|---|---|
| 9.1 | Refresh tokens encrypted at rest, service-role only | Not exposed via any client route or RLS-readable table |
| 9.2 | A seller can only push/withdraw **their own** listings | Cross-user attempts rejected server-side |
| 9.3 | Account-deletion webhook challenge-response | `GET ?challenge_code=…` → `200` `{challengeResponse: SHA256(challengeCode+verificationToken+endpoint)}` |
| 9.4 | Account-deletion notice (real) | Targeted user's eBay tokens/data purged |
| 9.5 | (If used) Trading-API notification endpoint verifies signature | Unsigned/forged payloads rejected |
| 9.6 | eBay error bodies/tokens not leaked to client or logs | Sanitized error surfaces only |

## 10. Production smoke test (gate before general use)

1. Switch one connected (owner) account to production keys/RuName.
2. Push **one** real low-value card → confirm it goes live on eBay.
3. Edit its price → confirm update on the live listing.
4. Buy it on our site → confirm the eBay listing is withdrawn within seconds (7.1).
5. Re-list it; buy it on eBay with a second account → confirm the poller marks it sold here and
   pulls it from inventory (6.1).
6. Confirm the account-deletion webhook is reachable and returns the correct challenge response.

Pass = green-light wider use; then generalize from single-seller to multi-seller.

## 11. Tooling / how to simulate
- **eBay sale (Direction B):** log into the sandbox **buyer** account, purchase the pushed
  listing, then trigger `/api/ebay/sync`.
- **Token expiry:** shorten the cached access-token TTL or clear the cache to force a refresh.
- **Race (7.3):** withhold the withdraw call, complete an eBay purchase, then let the poller and
  the site-sale path both run.
- **Webhook:** send a crafted `challenge_code` GET and assert the SHA-256 response.
