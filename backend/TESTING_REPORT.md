# HIGHFLIER Backend — Testing Report

**Last verified:** 2026-11-01
**Environment:** Windows PowerShell, MongoDB via `mongodb-memory-server`
**Command:** `npm test` (`vitest run`)

## Result

| Metric | Value |
| --- | --- |
| Test files | 15 passed / 15 |
| Tests | **88 passed / 88** |
| Failing / skipped | 0 / 0 |
| Exit code | 0 |
| Wall-clock duration | ~14 s |

Each test file starts its own in-memory MongoDB instance, resets the database between tests, and exercises the real Express app through Supertest. No external service, no seeded production data, and no mocked business logic: only external gateways are replaced with clearly labelled mock adapters.

## Suites

| File | Tests | What is verified |
| --- | --- | --- |
| `dns.test.js` | 5 | Optional resolver parsing, development-only DNS configuration, SRV preflight and preload ordering before Mongoose import, and sanitized TLS startup diagnostics |
| `cors.test.js` | 2 | Swagger UI origin allowed only in development; production keeps its configured allowlist |
| `foundation.test.js` | 7 | Service descriptor, liveness/readiness, OpenAPI + Swagger UI, security headers, request IDs, structured 404, malformed JSON, NoSQL operator stripping, tampered JWT rejection |
| `auth.test.js` | 7 | Customer registration with hashed password and no self-assigned admin role, duplicate/invalid login rejection, profile and inactive-account handling, refresh rotation and reuse detection, password reset via email outbox with session revocation, password change, admin-only route enforcement |
| `products.test.js` | 6 | Category/brand creation with unique slugs, public listing filters/sorting/pagination, product lookup by slug or id hiding drafts, admin price/images/activation updates, validation and discontinuation, admin role enforcement |
| `cart-wishlist.test.js` | 8 | Auth requirement, duplicate merge and server-side totals, unavailable/insufficient stock rejection, quantity updates/removal/clear, stale-line detection, payload validation, wishlist de-duplication, discontinued-product rejection |
| `coupons.test.js` | 5 | Admin coupon creation and duplicate codes, live-cart validation, minimum value/expiry/scope/usage limits, percentage cap and subtotal ceiling, admin listing/update/deactivation |
| `orders.test.js` | 11 | Checkout auth, COD order committing stock and clearing cart, idempotency-key replay, missing stock/address and COD-blocked supplier rejection, end-to-end mock online payment with signature verification, order ownership scoping and filters, cancellation with stock restoration, refund on cancellation, return request accept/reject/validation, return window, admin status/tracking/notes with guarded transitions |
| `payments.test.js` | 10 | Labelled mock payment config, payment-order creation, mock pay completion and cross-user replay block, failed payment cancelling the order and releasing stock, unsigned/invalid webhook rejection, idempotent `payment.captured`, `payment.failed` cancellation, signed refund webhook, admin listing and partial/full refunds, manual COD refund with optional restock |
| `payments-unconfigured.test.js` | 1 | No gateway configured: honest config response, online checkout blocked, COD still available |
| `suppliers.test.js` | 7 | Supplier creation with AES-256-GCM credentials never returned, admin-only access, mock connection test without false live claims, idempotent catalogue import with markup, inventory sync with ledger entry, stale inventory marking, unsafe URL/adapter rejection |
| `supplier-orders.test.js` | 6 | Paid-order forwarding with admin views, one supplier order per supplier, processing/shipped/delivered sync with mock tracking, missing-capability flagging and safe retries, admin cancellation, no duplicates on repeated scheduling |
| `reviews.test.js` | 5 | Verified-purchaser-only single review, public lists with summaries/filtering/ownership flags, customer update/delete with rating recalculation, admin moderation with recalculation, admin-only moderation |
| `admin.test.js` | 5 | Admin surface protection, dashboard aggregates, customer role/activation/session management, sales/product/low-stock/supplier reports, audit/webhook/sync log access |
| `uploads.test.js` | 3 | Upload configuration and admin access, clear `503 IMAGE_SERVICE_NOT_CONFIGURED`, file type/required field/folder validation |

Total: **88 tests**.

## Security assertions covered

- Passwords are hashed (bcryptjs) and never returned.
- Registration cannot grant the admin role; admin routes reject customers with `403`.
- Access tokens are verified; tampered tokens return `401`.
- Refresh tokens rotate; reuse revokes the session.
- Input validation rejects malformed payloads with `422` and issue details.
- NoSQL operator injection is stripped before validation.
- Supplier credentials are encrypted at rest and never serialised in any response.
- Live supplier URLs are rejected unless HTTPS and allowlisted.
- Razorpay webhooks require a valid raw-body HMAC signature; duplicate events are deduplicated.
- Checkout and supplier-order forwarding are idempotent; stock and coupon limits are updated atomically.
- Uploads enforce type/size/count limits before touching storage.

## Commands

```bash
npm test               # full suite
npm run test:watch     # watch mode
npm run test:coverage  # coverage report (writes coverage/)
npm run docs:check     # OpenAPI validation (95 paths / 121 operations / 37 schemas)
```

## What was and was not exercised with real services

| Integration | Tested here | Real service tested? |
| --- | --- | --- |
| MongoDB | Yes, real in-memory server per file | Standalone memory server; replica-set transaction path not exercised in CI |
| Supplier APIs | Mock adapter only | **No** — no credentials or API documentation supplied |
| Razorpay | Mock gateway + HMAC signature logic | **No** — no keys supplied |
| Cloudinary | Unconfigured behaviour + validation | **No** — no keys supplied |
| SMTP email | Development outbox/preview assertions | **No** — no SMTP credentials supplied |
| Cron scheduler | Logic invoked directly; not wall-clock scheduled in tests | N/A |

## Known gaps

- Real supplier catalogue/inventory/order/tracking calls cannot be validated until a supplier provides API documentation and credentials.
- Real Razorpay order creation, capture, webhook delivery and refunds require keys and a public webhook URL; only the signature/verification logic is tested against the mock gateway.
- Load, soak and performance testing were not performed.
- The transaction fallback for standalone MongoDB is implemented but the replica-set commit path is not part of the automated suite.
- Frontend, browser and accessibility testing are explicitly out of scope for this backend deliverable.

## Reproducing

```bash
cd backend
npm install
npm test
```

If the suite fails to start, confirm the Node version is >= 20 and that `mongodb-memory-server` can download/start a MongoDB binary in your environment (some restricted networks require `MONGOMS_SYSTEM_BINARY`).
