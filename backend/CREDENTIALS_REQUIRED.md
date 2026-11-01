# HIGHFLIER Backend — Credentials and External Services

This document lists **exactly** what is required to replace each mock/unconfigured integration with a real one. No credential was invented, guessed or embedded in the codebase. All values belong in `backend/.env` (copy from `.env.example`); never commit that file or paste real secrets into tickets, chat logs or source code.

Legend: **Required** = the backend will not run acceptably without it; **Optional** = the related feature stays explicitly unavailable until configured.

---

## 1. Runtime essentials (required)

| Variable | What it is | Why it is needed | How to verify |
| --- | --- | --- | --- |
| `MONGODB_URI` | MongoDB connection string (local, Docker or Atlas) | Persistence for every module | `GET /api/v1/health/ready` returns `status: "ready"` |
| `JWT_ACCESS_SECRET` | 64+ random chars, different from refresh | Signs 15-minute access tokens | Login succeeds and `/auth/me` works |
| `JWT_REFRESH_SECRET` | 64+ random chars, different from access | Signs rotating refresh tokens | `POST /auth/refresh` succeeds |
| `APP_ENCRYPTION_KEY` | Base64-encoded 32-byte key | AES-256-GCM encryption of supplier credentials | Supplier create + connection test succeeds; changing this key invalidates stored credentials |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Initial admin account | `npm run seed:admin` creates/promotes the admin | Login with that email and call `/api/v1/admin/dashboard` |

Generate secrets:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"   # JWT secrets
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" # APP_ENCRYPTION_KEY
```

`CORS_ORIGINS`, `API_BASE_URL`, `TRUST_PROXY` must match your deployment; they are not third-party credentials.

---

## 2. Razorpay (required for real online payments; optional for mock/demo)

**Current behaviour without keys:** `GET /api/v1/payments/config` reports no gateway; creating an online payment order returns `503 PAYMENT_NOT_CONFIGURED`; COD remains available when suppliers support it. With `PAYMENTS_MOCK_MODE=true`, a clearly labelled mock gateway is used instead — it never moves real money.

| Variable | Where to obtain it |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Account & Settings → API Keys (start with **Test Mode**) |
| `RAZORPAY_KEY_SECRET` | Same screen (shown once) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Webhooks → create endpoint → secret you choose |

**Webhook endpoint to register:** `https://<your-public-domain>/api/v1/payments/webhook`

**Events used by the backend:** `payment.captured`, `payment.authorized`, `payment.failed`, `refund.created`, `refund.processed`.

**Verification steps**

1. Set the three variables, keep `PAYMENTS_MOCK_MODE=false`, restart the API.
2. `GET /api/v1/payments/config` must report `configured: true` with provider `razorpay`.
3. Place an online order, create the payment order, pay with a Razorpay test card/UPI, and confirm the signature verification updates the order.
4. Send a test webhook from the Razorpay dashboard and confirm `WebhookEvent` deduplication and order status.
5. Trigger a refund from an admin account and confirm the refund appears on the payment.

Until this is done, any claim of "real payments working" would be false.

---

## 3. Cloudinary (optional; admin image uploads)

**Current behaviour without keys:** every upload returns `503 IMAGE_SERVICE_NOT_CONFIGURED`; no file is stored.

| Variable | Where to obtain it |
| --- | --- |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary Dashboard → Product Environment |
| `CLOUDINARY_API_KEY` | Same |
| `CLOUDINARY_API_SECRET` | Same |
| `CLOUDINARY_FOLDER` | Optional folder prefix, default `highflier` |

**Verification:** `GET /api/v1/admin/uploads/config` reports `configured: true`; upload a JPEG/PNG/WebP/AVIF ≤ 5 MB via `POST /admin/uploads/image` and confirm the returned secure URL.

---

## 4. SMTP email (optional; password reset and verification)

**Current behaviour without SMTP:** reset/verification links are written to the development email outbox/log preview; no email is delivered. In production without SMTP, users cannot receive links by email.

| Variable | Notes |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Your mail provider (e.g. transactional email service) |
| `SMTP_USER`, `SMTP_PASS` | Usually an API key or SMTP credential from that provider |
| `MAIL_FROM` | Verified sender identity |

**Verification:** request `POST /api/v1/auth/forgot-password` and complete the emailed link; or register and complete `GET /auth/verify-email`.

---

## 5. Real supplier integration (required for real fulfilment)

**Current behaviour without supplier access:** only `MockSupplierAdapter` works. It returns catalogue, inventory, orders, tracking and refunds marked `mock: true`. `GenericRestSupplierAdapter` is a reusable framework and contains **no invented endpoints** — it cannot work until you supply the supplier's actual API contract and credentials. No real supplier order has ever been placed by this system.

### 5.1 Configuration the backend needs

| Item | Detail |
| --- | --- |
| `SUPPLIER_ALLOWED_HOSTS` | Comma-separated HTTPS hostnames the adapter may call (SSRF allowlist) |
| `SUPPLIER_HTTP_TIMEOUT_MS` | Request timeout, default 15000 |
| Supplier base URL | Per supplier, stored in the admin supplier record |
| Supplier credentials | Set via `PUT /api/v1/admin/suppliers/{id}/credentials`; encrypted at rest |
| Adapter type | `generic_rest` for contract-driven REST suppliers; a bespoke adapter if the supplier needs custom signing/protocol |

### 5.2 Supplier documentation the backend needs

Please provide, per supplier:

1. **Base URL and environment** (sandbox and production) and whether it is HTTPS.
2. **Authentication scheme** — API key header/query, Basic auth, OAuth2 client credentials, HMAC signing, IP allowlist. Include header names and any token refresh rules.
3. **Catalogue endpoint** — method, path, query parameters, pagination, and a sample response containing product id, SKU, title, description, category, brand, images, cost, MRP, variants and stock.
4. **Inventory endpoint** — method, path, batching limits, and response fields with stock semantics (available vs on-hand).
5. **Order placement endpoint** — method, path, required request body (shipping address, line items, amounts), idempotency support, and sample success/error responses.
6. **Order status and tracking endpoint** — method, path, status vocabulary, tracking number/carrier/URL fields.
7. **Cancellation and refund endpoints** — if supported, with request/response samples.
8. **Rate limits, retry guidance and error codes** — especially which errors are retryable.
9. **Webhook support** (if any) — signature algorithm, secret, event names and delivery guarantees.
10. **Sandbox credentials** — for initial integration testing; production credentials only when ready to go live.

If the supplier has no API, the adapter framework cannot manufacture one; fulfilment would require a different integration (file/EDI/admin process), which must be decided explicitly.

---

## 6. Postman and local developer values (not secrets)

The generated collection uses `{{baseUrl}}`, `{{rootUrl}}`, and tokens captured by the login/refresh requests. `{{razorpayWebhookSignature}}` is only meaningful when testing a real signed webhook; the mock payment tests generate signatures internally.

---

## 7. Reality statement

- **No real supplier fulfilment has been performed or verified.**
- **No real payment has been processed or verified.**
- **No image has been stored on real hosting; no real email has been delivered.**
- Mock responses are always labelled (`mock: true` / `isMock`) and must not be presented to customers as real supplier or payment activity.

Once the items above are supplied, the corresponding integrations can be enabled and verified without code changes, except for a bespoke supplier adapter if the supplier's protocol is not covered by `GenericRestSupplierAdapter`.
