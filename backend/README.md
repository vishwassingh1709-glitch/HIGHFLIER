# HIGHFLIER Backend

Supplier-fulfilled, multi-category e-commerce backend for the Indian market. Node.js + Express + MongoDB, built as a production-shaped REST API with verified business flows, supplier adapter architecture, Razorpay payments, admin operations, scheduled synchronisation and automated tests.

> **Reality check — read before using this in production**
>
> - No real supplier API credentials or documentation were provided. The only working supplier integration is the clearly labelled **`MockSupplierAdapter`**; every mock response carries `mock: true`. The **`GenericRestSupplierAdapter`** is a reusable framework and does **not** invent or call any supplier endpoints. Real supplier fulfilment has **not** been tested.
> - No Razorpay keys were provided. Online payments work only in **`PAYMENTS_MOCK_MODE`** (clearly labelled, HMAC-signed fake gateway) or with your own Razorpay test/live keys. No real payment has been processed.
> - Cloudinary and SMTP credentials are optional and absent by default, so image uploads return `503 IMAGE_SERVICE_NOT_CONFIGURED` and email links are logged/previewed instead of sent.
> - See [CREDENTIALS_REQUIRED.md](CREDENTIALS_REQUIRED.md) for the exact configuration needed to switch each integration from mock to real.

---

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js >= 20 (tested on v24), JavaScript ES Modules |
| HTTP | Express 4 |
| Database | MongoDB + Mongoose 8 |
| Auth | JWT access (15 min) + rotating refresh tokens bound to server-side sessions, bcryptjs |
| Validation | Zod (request body/query/params) |
| Payments | Razorpay SDK (orders, verification, webhooks, refunds) + explicit mock gateway |
| Images | Cloudinary (optional, lazy-configured) |
| Email | Nodemailer (SMTP optional; development preview) |
| Logging | Pino + pino-http with secret redaction |
| Docs | OpenAPI 3.0.3 + Swagger UI + generated Postman collection |
| Tests | Vitest + Supertest + mongodb-memory-server |

## Architecture

```
backend/
├── server.js                 # bootstrap: DB, HTTP server, cron jobs, graceful shutdown
├── src/
│   ├── app.js                # Express app, security, raw webhook body, docs, routes
│   ├── routes.js             # /api/v1 route composition
│   ├── config/               # env schema, logger, Mongo connection + transactions
│   ├── middleware/           # auth/RBAC, validation, sanitisation, rate limits, errors
│   ├── models/               # 19 Mongoose models with indexes
│   ├── modules/              # feature modules (routes/controller/service/validators)
│   │   ├── auth/ users/
│   │   ├── categories/ brands/ products/
│   │   ├── cart/ wishlist/
│   │   ├── orders/           # checkout, lifecycle, cancellation, returns
│   │   ├── payments/         # Razorpay + mock gateway, webhooks, refunds
│   │   ├── suppliers/        # adapters, catalogue/inventory sync, supplier orders
│   │   ├── reviews/ coupons/ inventory/ uploads/ admin/
│   ├── jobs/                 # node-cron scheduler (5 built-in jobs)
│   ├── docs/                 # OpenAPI document and Swagger UI mount
│   └── utils/                # JWT, crypto, money, idempotency, SSRF, locks, errors
├── scripts/                  # seedAdmin, seedDemo, checkOpenApi, generatePostman
├── tests/                    # 15 test suites (88 tests)
└── postman/                  # generated collection + environment
```

Every feature follows the same shape: route (auth + validation) → controller (HTTP) → service (business rules, transactions) → model. Errors use one envelope and one set of codes.

## Quick start

Requirements: Node.js 20+, a MongoDB instance (local, Docker or Atlas).

```bash
cd backend
npm install

# 1. Create your environment file and replace the placeholders
cp .env.example .env
# Generate the encryption key:
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"

# Optional: if your development network cannot resolve MongoDB Atlas SRV records,
# set DNS_SERVERS=8.8.8.8,8.8.4.4 in .env. This is development-only; without it,
# Node.js uses the system DNS resolver. Production always uses system DNS.

# 2. Seed an admin (reads ADMIN_* from .env)
npm run seed:admin

# 3. Optional: seed a labelled mock supplier + catalogue + WELCOME10 coupon
npm run seed:demo

# 4. Start
npm run dev        # or: npm start
```

The API listens on `http://localhost:5000` by default:

- API base: `http://localhost:5000/api/v1`
- Swagger UI: `http://localhost:5000/api-docs`
- OpenAPI JSON: `http://localhost:5000/api-docs.json`
- Liveness: `GET /api/v1/health` · Readiness: `GET /api/v1/health/ready`
- In development, CORS allows the Swagger UI origin `http://localhost:5000` in addition to the configured origins. Production allows only origins explicitly listed in `CORS_ORIGINS`.
- Optional `DNS_SERVERS` accepts comma-separated IPv4 or IPv6 resolver addresses. The DNS bootstrap runs before the backend or database seeding scripts load Mongoose; it applies the configured resolvers only when `NODE_ENV=development`. If unset, Node.js uses the operating system's DNS configuration. Production always uses the system resolver, even if `DNS_SERVERS` is set.
- In development, startup checks the MongoDB SRV record before importing the application. If SRV resolution succeeds but the MongoDB TLS handshake fails, verify that Atlas allows the machine's current public egress IP and that the network/VPN permits MongoDB TLS traffic; TLS is not disabled.

### First-run mock flow

1. `POST /api/v1/auth/register`, then `POST /api/v1/auth/login` (or seed an admin).
2. `npm run seed:demo` creates the mock supplier, imports its catalogue and a `WELCOME10` coupon.
3. Add an address (`POST /users/me/addresses`), add a product to the cart, then checkout with `paymentMethod: "cod"` or with `PAYMENTS_MOCK_MODE=true` for the mock online flow.
4. Sign in as the seeded admin and inspect `/api/v1/admin/dashboard`, `/admin/orders`, `/admin/supplier-orders` and `/admin/sync-logs`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the API (connects DB, starts cron jobs) |
| `npm run dev` | Preload the optional development DNS configuration, then start the API with `node --watch` |
| `npm test` | Run all 15 test suites (88 tests) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Run with Vitest coverage |
| `npm run seed:admin` | Create or promote an admin from `ADMIN_*` env vars |
| `npm run seed:demo` | Idempotently seed the mock supplier catalogue + `WELCOME10` coupon |
| `npm run docs:check` | Validate the OpenAPI document and every local `$ref` |
| `npm run postman:generate` | Regenerate the Postman collection/environment from OpenAPI |

The DNS bootstrap is preloaded before the API starts under both `npm run dev` and `npm start`. It also runs before either database seeding script loads Mongoose; production ignores `DNS_SERVERS`.

## API overview

`121` documented operations under `/api/v1`:

| Area | Highlights |
| --- | --- |
| Health | `GET /health`, `GET /health/ready` |
| Auth (9) | register, login, refresh rotation, logout, me, forgot/reset password, email verify, resend verification |
| Users (8) | profile, password change, address book with default address |
| Catalogue (6) | categories, brands, product listing with filters/sorting/pagination, product by id or slug |
| Reviews (5) | verified-purchase create, product review list with summary, my reviews, edit, delete |
| Cart (5) | get/add/update/remove/clear with live pricing and stock checks |
| Wishlist (4) | list, add, remove one, clear |
| Orders (5) | checkout with idempotency, list, detail, cancel, return request |
| Coupons (1) | server-side coupon validation |
| Payments (6) | config, create payment order, verify, mock pay, payment by order, signed webhook |
| Admin (42) | dashboard, users, reports, audit/webhook/sync logs, catalogue CRUD, reviews, orders, coupons, payments |
| Suppliers (14) | CRUD, encrypted credentials, connection test, capabilities, markup, catalogue/inventory/stale-scan sync, logs |
| Supplier orders (7) | list, stats, detail, retry one, retry due, status sync, cancel |
| Inventory (3) | stock list, ledger transactions, per-variant stock adjustment |
| Uploads (4) | config, single image, multiple images, delete image |

Full request/response schemas, examples and auth requirements are in Swagger.

## Business behaviour

- **Auth:** short-lived access JWT with a password-change claim; refresh tokens are hashed, single-use and rotated. Reuse of a rotated token revokes the session. Logout revokes the session.
- **Customers vs admins:** role-based middleware on every admin route. Admin seeding is explicit; registration always creates a customer.
- **Catalogue:** prices are stored in integer paise plus decimal rupee fields for display. Supplier markups produce selling prices; imported products are inactive unless `AUTO_ACTIVATE_IMPORTED_PRODUCTS=true` (the demo seed explicitly activates them after a successful sync).
- **Cart:** quantities are re-validated against live purchasable products and available stock on every read/write.
- **Checkout:** totals are always calculated server-side (items, coupon, shipping, COD fee, tax). Stock is reserved atomically with `$expr` guards, the cart is cleared only after success, and the `Idempotency-Key` header returns the original order for retries.
- **Order lifecycle:** explicit state machine with audited transitions. Cancellation releases/restores stock through the inventory ledger. Return requests are customer-initiated; admins approve/reject and can refund.
- **Payments:** online orders create a gateway order. Razorpay verification checks the HMAC signature server-side; webhooks are verified against the raw body and deduplicated (`WebhookEvent`). COD is only offered when every supplier supports it. Refunds are recorded against payments.
- **Supplier orders:** a paid order is grouped into one supplier order per supplier (`hf:<orderNumber>:<supplierId>`), forwarded through the adapter, retried with backoff, status-synced, and tracked back onto the customer order. Forwarding is idempotent.
- **Inventory:** every stock change is written to an `InventoryTransaction` ledger; scheduled jobs expire stale reservations and mark stale supplier inventory unavailable.
- **Reviews:** only verified purchasers of delivered/returned items may review; one review per user/product; ratings are recalculated after moderation.
- **Coupons:** percentage/fixed, minimum spend, usage caps, per-user limits and optional restricted products/categories, enforced atomically at usage time.

## Supplier adapter framework

```
BaseSupplierAdapter
├── MockSupplierAdapter        # labelled mock: catalogue, inventory, orders, tracking, refunds
└── GenericRestSupplierAdapter # HTTPS + allowlist + configurable endpoint path/method/field map
```

- Supplier credentials are encrypted at rest with AES-256-GCM (`APP_ENCRYPTION_KEY`) and never returned by any endpoint (only a `hasCredentials` flag).
- Live supplier URLs must be HTTPS and match `SUPPLIER_ALLOWED_HOSTS`; requests are time-limited and SSRF-guarded.
- `GenericRestSupplierAdapter` is configured per supplier (endpoint paths, HTTP methods, request/response field maps, auth header style). It contains no hard-coded supplier URLs and will not pretend to work without your supplier's real documentation.
- Adding a bespoke supplier means implementing the `BaseSupplierAdapter` contract and registering it in `src/modules/suppliers/adapters/index.js`.

## Security

- Helmet security headers, CORS allowlist, request IDs, structured 404/error envelopes.
- Rate limits: global, auth, write and payment scopes.
- Zod validation on every mutating route and query; NoSQL operator keys are stripped by sanitisation middleware.
- JWT secrets and encryption key are validated at startup; credentials are encrypted and redacted from logs.
- Razorpay webhook signature verification against the raw request body; webhook replay protection.
- Idempotency protection for checkout; atomic stock and coupon usage updates; per-user unique constraints on reviews and idempotency keys.
- Secrets live only in `.env` (git-ignored). `.env.example` contains placeholders only.

## Scheduled jobs

Enabled with `JOBS_ENABLED=true` (default) and expressed in Asia/Kolkata time:

| Job | Default |
| --- | --- |
| Catalogue sync | hourly |
| Inventory sync | every 15 minutes |
| Supplier order retry | every 5 minutes |
| Supplier status/tracking sync | every 10 minutes |
| Reservation expiry | every minute |

Run a single API instance with cron enabled, or disable jobs and invoke the equivalent admin endpoints from an external scheduler when horizontally scaling.

## Testing and documentation

```bash
npm test              # 15 files, 88 tests
npm run docs:check    # OpenAPI validity + $ref resolution
```

Test coverage includes auth and RBAC, catalogue/pricing, cart/wishlist, checkout/cancellation/returns, payments/webhooks/refunds, supplier sync and supplier orders, admin, reviews, uploads, development DNS startup ordering, security and error handling. All database integration tests run against a throwaway in-memory MongoDB. See [TESTING_REPORT.md](TESTING_REPORT.md).

The OpenAPI document is the source of truth for the API; the Postman collection is generated from it.

### Postman

1. Import `postman/HIGHFLIER.postman_collection.json` and `postman/HIGHFLIER.postman_environment.json`.
2. Select the **HIGHFLIER Local** environment and start the API.
3. Run **Auth → POST /auth/login**; the test script stores `accessToken`/`refreshToken` for later requests.
4. Run seeding and the mock flow above, then use the **Admin**, **Admin - Suppliers** and **Admin - Supplier orders** folders.

Regenerate after changing the API with `npm run postman:generate`. Multipart upload requests include empty file fields; select a local image in Postman before sending.

## Deployment notes

1. Provision MongoDB 4.2+; prefer a replica set or Atlas so multi-document transactions are available if you add them. Stock reservation already uses atomic conditional updates (`$expr` + `$inc`), so overselling is prevented on standalone MongoDB as well. A `withTransaction` helper is available for replica-set-only workflows.
2. Set `NODE_ENV=production`, strong `JWT_*` secrets, a fixed `APP_ENCRYPTION_KEY` (changing it invalidates stored supplier credentials), your `MONGODB_URI`, `CORS_ORIGINS` and `API_BASE_URL`.
3. Keep `PAYMENTS_MOCK_MODE=false` in production. Configure Razorpay keys/webhook secret to accept real payments.
4. Terminate TLS at a reverse proxy and set `TRUST_PROXY=true` only when it is actually behind a trusted proxy.
5. Run `npm run seed:admin` once, then remove the admin password from any shared environment file.
6. Health probes: `/api/v1/health` (liveness) and `/api/v1/health/ready` (readiness).
7. Persist logs and monitor the five cron jobs; sync failures are recorded in `SyncLog` and visible in `/admin/sync-logs`.

### Backups and recovery

- Enable automated snapshots/continuous backups on MongoDB Atlas, or schedule `mongodump`/`mongorestore` (or filesystem snapshots) for self-hosted MongoDB. Test a restore before launch.
- Back up `.env` and `APP_ENCRYPTION_KEY` through a secret manager, separately from database backups. Losing the key makes stored supplier credentials unreadable.
- Keep the Cloudinary account backed up or export product images to durable storage if image loss would be unacceptable.
- Retain audit, webhook and sync logs according to your privacy and tax obligations; they are application data and are included in normal database backups.

### Legal and tax

The backend models GST as a configurable flat `TAX_PERCENT` and does not issue GST invoices. Before launch, obtain professional legal/tax review for GST invoicing, consumer disclosures, privacy/data handling, supplier permissions, returns/refunds and RTO liability.

## Known limitations

- Real supplier fulfilment, real Razorpay payments, real image hosting and real email delivery are **not verified** because credentials were not supplied.
- Tax is a configurable flat percentage (`TAX_PERCENT`), not a jurisdiction-complete GST engine.
- The mock supplier is for development/demo only and must not be presented as real fulfilment.
