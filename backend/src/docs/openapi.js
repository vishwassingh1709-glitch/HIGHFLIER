const objectId = { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '665f1c2a9b1e8a0012345678' };
const dateTime = { type: 'string', format: 'date-time' };
const money = { type: 'number', format: 'float', example: 1499 };
const decimal = { type: 'number', format: 'float', example: 1499.5 };

const json = (schema) => ({ 'application/json': { schema } });

const envelope = (dataSchema, { meta = false } = {}) => ({
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: dataSchema,
    ...(meta ? { meta: { $ref: '#/components/schemas/PaginationMeta' } } : {})
  }
});

const ok = (description, dataSchema, options = {}) => ({
  description,
  content: json(envelope(dataSchema, options))
});

const errorContent = (code, example) =>
  json({
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: code },
          message: { type: 'string', example },
          details: { description: 'Optional structured details (validation issues, duplicate fields).' },
          requestId: { type: 'string', example: 'req_8f1c2e' }
        }
      }
    }
  });

const errorResponse = (description, code, example) => ({
  description,
  content: errorContent(code, example)
});

const badRequest = () => ({
  description: 'Invalid request',
  content: errorContent('VALIDATION_ERROR', 'Request validation failed')
});

const unauthorized = () => ({
  description: 'Missing, invalid or expired access token',
  content: errorContent('UNAUTHORIZED', 'Authentication required')
});

const forbidden = () => ({
  description: 'Authenticated but not allowed (admin role required or resource not owned)',
  content: errorContent('FORBIDDEN', 'You do not have permission to perform this action')
});

const notFound = () => ({
  description: 'Resource not found',
  content: errorContent('NOT_FOUND', 'Resource not found')
});

const conflict = () => ({
  description: 'Conflicting state or duplicate resource',
  content: errorContent('CONFLICT', 'This action conflicts with the current state')
});

const validation = () => ({
  description: 'Schema validation failed (Zod)',
  content: json({
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Request validation failed' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', example: 'email' },
                message: { type: 'string', example: 'Email is invalid' },
                code: { type: 'string', example: 'invalid_string' }
              }
            }
          },
          requestId: { type: 'string' }
        }
      }
    }
  })
});

const serverError = () => ({
  description: 'Unexpected server error',
  content: errorContent('INTERNAL_ERROR', 'An unexpected error occurred')
});

const serviceUnavailable = () => ({
  description: 'Required external service is not configured',
  content: errorContent('SERVICE_UNAVAILABLE', 'Service unavailable')
});

const pageParam = {
  name: 'page',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, default: 1 }
};
const limitParam = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }
};
const paginationParams = [pageParam, limitParam];

const idPath = (name = 'id', description = 'MongoDB ObjectId') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: objectId
});

const bearer = [{ bearerAuth: [] }];

const roleNote = (text) => `${text} Requires the **admin** role.`;
const userNote = (text) => `${text} Requires an authenticated user.`;

const multipartBody = (schema) => ({
  required: true,
  content: { 'multipart/form-data': { schema } }
});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'HIGHFLIER Backend API',
    version: '1.0.0',
    description: `Supplier-fulfilled multi-category e-commerce API for India.

## Overview
- **Base URL:** \`/api/v1\` (health probes are mounted at \`/health\`).
- **Auth:** JWT access token in \`Authorization: Bearer <token>\`. Refresh tokens rotate on every use and are bound to a server-side session.
- **Money:** all amounts are INR decimals; Razorpay order amounts are converted to paise at the boundary.
- **Mock reality:** responses produced by the built-in mock supplier or mock payment mode are explicitly marked \`isMock\`/\`mock: true\`. They never represent real fulfilment or real money.
- **Idempotency:** checkout accepts an \`Idempotency-Key\` header (or \`idempotencyKey\` body field). Replaying the same key returns the original order.
- **Errors:** \`{ success: false, error: { code, message, details?, requestId } }\`.

## Rate limits
Global, auth, write and payment limiters apply per IP. Limits are configurable through environment variables.`,
    license: { name: 'Proprietary' }
  },
  servers: [{ url: '/api/v1', description: 'API v1' }],
  tags: [
    { name: 'Health', description: 'Liveness and readiness probes (mounted at /health).' },
    { name: 'Auth', description: 'Registration, login, tokens, password reset, email verification.' },
    { name: 'Users', description: 'Profile and saved addresses.' },
    { name: 'Catalogue', description: 'Public categories, brands and products.' },
    { name: 'Reviews', description: 'Verified-purchase product reviews.' },
    { name: 'Cart', description: 'Server-priced shopping cart.' },
    { name: 'Wishlist', description: 'Saved products.' },
    { name: 'Orders', description: 'Checkout, order history, cancellation and returns.' },
    { name: 'Coupons', description: 'Coupon validation.' },
    { name: 'Payments', description: 'Razorpay/mock payment intents, verification, webhooks, refunds.' },
    { name: 'Admin', description: 'Admin-only management endpoints.' },
    { name: 'Admin - Suppliers', description: 'Supplier connections, catalogue and inventory sync.' },
    { name: 'Admin - Supplier orders', description: 'Forwarding, retries and supplier status sync.' },
    { name: 'Admin - Inventory', description: 'Stock ledger and adjustments.' },
    { name: 'Admin - Uploads', description: 'Cloudinary-backed image uploads.' }
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    },
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description: 'Replays return the original order instead of creating a duplicate.',
        schema: { type: 'string', maxLength: 128 }
      },
      Page: pageParam,
      Limit: limitParam
    },
    schemas: {
      PaginationMeta: {
        type: 'object',
        required: ['page', 'limit', 'total', 'totalPages', 'hasNextPage', 'hasPrevPage'],
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 42 },
          totalPages: { type: 'integer', example: 3 },
          hasNextPage: { type: 'boolean', example: true },
          hasPrevPage: { type: 'boolean', example: false }
        }
      },
      Address: {
        type: 'object',
        required: ['fullName', 'phone', 'line1', 'city', 'state', 'pincode'],
        properties: {
          _id: objectId,
          label: { type: 'string', example: 'Home' },
          fullName: { type: 'string', example: 'Aarav Sharma' },
          phone: { type: 'string', example: '9876543210' },
          line1: { type: 'string', example: '12 MG Road' },
          line2: { type: 'string', example: 'Near Metro Station' },
          landmark: { type: 'string', example: 'Opposite City Mall' },
          city: { type: 'string', example: 'Bengaluru' },
          state: { type: 'string', example: 'Karnataka' },
          pincode: { type: 'string', example: '560001' },
          country: { type: 'string', example: 'India' },
          isDefault: { type: 'boolean', example: true }
        }
      },
      User: {
        type: 'object',
        properties: {
          _id: objectId,
          name: { type: 'string', example: 'Aarav Sharma' },
          email: { type: 'string', format: 'email', example: 'aarav@example.com' },
          role: { type: 'string', enum: ['customer', 'admin'] },
          phone: { type: 'string', nullable: true },
          addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
          defaultAddress: { allOf: [{ $ref: '#/components/schemas/Address' }], nullable: true },
          isActive: { type: 'boolean' },
          emailVerified: { type: 'boolean' },
          emailVerifiedAt: { ...dateTime, nullable: true },
          lastLoginAt: { ...dateTime, nullable: true },
          passwordChangedAt: { ...dateTime, nullable: true },
          createdAt: dateTime,
          updatedAt: dateTime,
          id: { type: 'string' }
        }
      },
      AuthTokens: {
        type: 'object',
        properties: {
          accessToken: { type: 'string', description: 'JWT signed with JWT_ACCESS_SECRET, 15m by default.' },
          refreshToken: { type: 'string', description: 'Rotating refresh token; store securely.' },
          tokenType: { type: 'string', example: 'Bearer' },
          accessTokenExpiresIn: { type: 'string', example: '15m' },
          refreshTokenExpiresAt: dateTime
        }
      },
      Category: {
        type: 'object',
        properties: {
          _id: objectId,
          name: { type: 'string', example: 'Home & Kitchen' },
          slug: { type: 'string', example: 'home-kitchen' },
          description: { type: 'string' },
          parentCategory: { ...objectId, nullable: true },
          image: {
            type: 'object',
            properties: { url: { type: 'string' }, alt: { type: 'string' } }
          },
          isActive: { type: 'boolean' },
          sortOrder: { type: 'integer' },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      Brand: {
        type: 'object',
        properties: {
          _id: objectId,
          name: { type: 'string', example: 'Highflier Home' },
          slug: { type: 'string', example: 'highflier-home' },
          description: { type: 'string' },
          logo: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              publicId: { type: 'string' },
              alt: { type: 'string' }
            }
          },
          isActive: { type: 'boolean' },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      ProductImage: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri', example: 'https://images.example.com/product.jpg' },
          publicId: { type: 'string' },
          alt: { type: 'string' },
          isPrimary: { type: 'boolean' }
        }
      },
      ProductVariant: {
        type: 'object',
        properties: {
          _id: objectId,
          sku: { type: 'string', example: 'MOCK-HK-001-STD' },
          supplierVariantId: { type: 'string' },
          name: { type: 'string', example: 'Standard' },
          attributes: { type: 'object', additionalProperties: true },
          supplierCost: { ...money, description: 'Admin-only. Removed from public product responses.' },
          mrp: money,
          sellingPrice: money,
          stock: { type: 'integer', example: 20 },
          reserved: { type: 'integer', example: 2 },
          availableStock: { type: 'integer', example: 18 },
          isActive: { type: 'boolean' },
          isPriceLocked: { type: 'boolean', description: 'Admin-only.' }
        }
      },
      Product: {
        type: 'object',
        properties: {
          _id: objectId,
          supplier: {
            type: 'object',
            properties: {
              _id: objectId,
              name: { type: 'string' },
              code: { type: 'string' },
              isMock: { type: 'boolean' }
            }
          },
          supplierProductId: { type: 'string', description: 'Admin-only on public endpoints.' },
          supplierSku: { type: 'string', description: 'Admin-only on public endpoints.' },
          title: { type: 'string', example: 'Mock Stainless Steel Cookware Set' },
          slug: { type: 'string', example: 'mock-stainless-steel-cookware-set' },
          description: { type: 'string' },
          shortDescription: { type: 'string' },
          category: { oneOf: [objectId, { type: 'object', additionalProperties: true }], nullable: true },
          brand: { oneOf: [objectId, { type: 'object', additionalProperties: true }], nullable: true },
          images: { type: 'array', items: { $ref: '#/components/schemas/ProductImage' } },
          attributes: { type: 'object', additionalProperties: true },
          variants: { type: 'array', items: { $ref: '#/components/schemas/ProductVariant' } },
          supplierCost: { ...money, description: 'Admin-only.' },
          sellingPrice: money,
          mrp: money,
          stock: { type: 'integer' },
          totalStock: { type: 'integer' },
          availableStock: { type: 'integer' },
          inStock: { type: 'boolean' },
          currency: { type: 'string', enum: ['INR'] },
          status: { type: 'string', enum: ['draft', 'active', 'inactive', 'discontinued'] },
          supplierStatus: { type: 'string', enum: ['available', 'unavailable', 'stale', 'discontinued'] },
          imported: { type: 'boolean', description: 'Admin-only.' },
          tags: { type: 'array', items: { type: 'string' } },
          ratingAverage: { type: 'number', example: 4.5 },
          ratingCount: { type: 'integer', example: 12 },
          salesCount: { type: 'integer' },
          lastSyncedAt: { ...dateTime, nullable: true },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      CartItem: {
        type: 'object',
        properties: {
          product: {
            type: 'object',
            nullable: true,
            properties: {
              _id: objectId,
              title: { type: 'string' },
              slug: { type: 'string' },
              status: { type: 'string' },
              supplierStatus: { type: 'string' },
              images: { type: 'array', items: { $ref: '#/components/schemas/ProductImage' } },
              category: { type: 'string', nullable: true },
              brand: { type: 'string', nullable: true },
              supplier: {
                type: 'object',
                properties: {
                  _id: objectId,
                  name: { type: 'string' },
                  code: { type: 'string' },
                  isMock: { type: 'boolean' }
                }
              }
            }
          },
          variant: {
            type: 'object',
            nullable: true,
            properties: {
              sku: { type: 'string' },
              name: { type: 'string' },
              attributes: { type: 'object', additionalProperties: true },
              unitPrice: money,
              availableStock: { type: 'integer' },
              isActive: { type: 'boolean' }
            }
          },
          quantity: { type: 'integer', example: 2 },
          lineTotal: money,
          available: { type: 'integer' },
          isPurchasable: { type: 'boolean' },
          issue: { type: 'string', nullable: true, example: null }
        }
      },
      Cart: {
        type: 'object',
        properties: {
          _id: objectId,
          items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
          itemCount: { type: 'integer', example: 2 },
          lineCount: { type: 'integer', example: 1 },
          subtotal: money,
          currency: { type: 'string', example: 'INR' }
        }
      },
      Wishlist: {
        type: 'object',
        properties: {
          _id: objectId,
          count: { type: 'integer', example: 1 },
          products: { type: 'array', items: { $ref: '#/components/schemas/Product' } }
        }
      },
      OrderAddress: {
        type: 'object',
        required: ['fullName', 'phone', 'line1', 'city', 'state', 'pincode'],
        properties: {
          fullName: { type: 'string' },
          phone: { type: 'string' },
          line1: { type: 'string' },
          line2: { type: 'string' },
          landmark: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          pincode: { type: 'string' },
          country: { type: 'string' }
        }
      },
      OrderItem: {
        type: 'object',
        properties: {
          _id: objectId,
          product: objectId,
          title: { type: 'string' },
          slug: { type: 'string' },
          image: { type: 'string' },
          variantSku: { type: 'string' },
          variantName: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
          unitPrice: money,
          unitMrp: money,
          quantity: { type: 'integer' },
          lineTotal: money,
          isMockSupplier: { type: 'boolean' }
        }
      },
      OrderStatusHistory: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          note: { type: 'string' },
          at: dateTime,
          actorType: { type: 'string', enum: ['customer', 'admin', 'system', 'supplier'] },
          actor: { ...objectId, nullable: true }
        }
      },
      ReturnRequest: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['none', 'requested', 'approved', 'rejected', 'completed'] },
          reason: { type: 'string' },
          note: { type: 'string' },
          requestedAt: { ...dateTime, nullable: true },
          resolvedAt: { ...dateTime, nullable: true },
          resolutionNote: { type: 'string' }
        }
      },
      Tracking: {
        type: 'object',
        properties: {
          courier: { type: 'string' },
          trackingNumber: { type: 'string' },
          trackingUrl: { type: 'string' },
          updatedAt: { ...dateTime, nullable: true },
          isMock: { type: 'boolean' }
        }
      },
      Order: {
        type: 'object',
        properties: {
          _id: objectId,
          orderNumber: { type: 'string', example: 'HF-2026-000042' },
          user: { oneOf: [objectId, { $ref: '#/components/schemas/User' }] },
          items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
          shippingAddress: { $ref: '#/components/schemas/OrderAddress' },
          currency: { type: 'string', example: 'INR' },
          subtotal: money,
          discount: money,
          shippingFee: money,
          codFee: money,
          taxAmount: money,
          total: money,
          amountPaid: money,
          amountRefunded: money,
          paymentMethod: { type: 'string', enum: ['online', 'cod'] },
          paymentStatus: {
            type: 'string',
            enum: ['pending', 'created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded', 'cod_pending']
          },
          status: {
            type: 'string',
            enum: [
              'pending_payment',
              'confirmed',
              'processing',
              'shipped',
              'delivered',
              'cancelled',
              'return_requested',
              'returned',
              'refunded'
            ]
          },
          statusHistory: { type: 'array', items: { $ref: '#/components/schemas/OrderStatusHistory' } },
          coupon: {
            type: 'object',
            properties: {
              couponId: { ...objectId, nullable: true },
              code: { type: 'string' },
              discount: money
            }
          },
          returnRequest: { $ref: '#/components/schemas/ReturnRequest' },
          tracking: { $ref: '#/components/schemas/Tracking' },
          supplierOrders: {
            type: 'array',
            description: 'Admin responses only.',
            items: { $ref: '#/components/schemas/SupplierOrder' }
          },
          fulfilmentIssue: {
            type: 'object',
            properties: { required: { type: 'boolean' }, message: { type: 'string' }, at: { ...dateTime, nullable: true } }
          },
          hasMockSupplier: { type: 'boolean' },
          customerNote: { type: 'string' },
          adminNote: { type: 'string', description: 'Admin responses only.' },
          stockReserved: { type: 'boolean' },
          stockCommitted: { type: 'boolean' },
          reservationExpiresAt: { ...dateTime, nullable: true },
          paidAt: { ...dateTime, nullable: true },
          confirmedAt: { ...dateTime, nullable: true },
          shippedAt: { ...dateTime, nullable: true },
          deliveredAt: { ...dateTime, nullable: true },
          cancelledAt: { ...dateTime, nullable: true },
          cancelReason: { type: 'string' },
          cancelledBy: { type: 'string', nullable: true },
          itemCount: { type: 'integer' },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      Refund: {
        type: 'object',
        properties: {
          providerRefundId: { type: 'string' },
          amount: money,
          status: { type: 'string', enum: ['pending', 'processed', 'failed'] },
          reason: { type: 'string' },
          createdAt: dateTime,
          processedAt: { ...dateTime, nullable: true },
          failureReason: { type: 'string' }
        }
      },
      Payment: {
        type: 'object',
        properties: {
          _id: objectId,
          order: objectId,
          provider: { type: 'string', enum: ['razorpay', 'mock', 'cod'] },
          method: { type: 'string', enum: ['online', 'cod'] },
          providerOrderId: { type: 'string' },
          providerPaymentId: { type: 'string' },
          amount: money,
          currency: { type: 'string', example: 'INR' },
          status: {
            type: 'string',
            enum: ['pending', 'created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded', 'cod_pending']
          },
          isMock: { type: 'boolean' },
          verifiedAt: { ...dateTime, nullable: true },
          capturedAt: { ...dateTime, nullable: true },
          failedAt: { ...dateTime, nullable: true },
          failureReason: { type: 'string' },
          signatureVerified: { type: 'boolean' },
          refunds: { type: 'array', items: { $ref: '#/components/schemas/Refund' } },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      PaymentCheckout: {
        type: 'object',
        properties: {
          provider: { type: 'string', example: 'mock' },
          mode: { type: 'string', enum: ['razorpay', 'mock'] },
          keyId: { type: 'string', nullable: true },
          orderId: objectId,
          orderNumber: { type: 'string' },
          providerOrderId: { type: 'string', example: 'order_MOCK_123' },
          amount: money,
          amountPaise: { type: 'integer', example: 149900 },
          currency: { type: 'string', example: 'INR' },
          isMock: { type: 'boolean' },
          checkout: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              prefill: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  contact: { type: 'string' }
                }
              },
              notes: { type: 'object', additionalProperties: { type: 'string' } }
            }
          },
          mockInstructions: { type: 'string' }
        }
      },
      Coupon: {
        type: 'object',
        properties: {
          _id: objectId,
          code: { type: 'string', example: 'WELCOME10' },
          description: { type: 'string' },
          discountType: { type: 'string', enum: ['percent', 'fixed'] },
          discountValue: { type: 'number', example: 10 },
          maxDiscount: money,
          minOrderValue: money,
          scope: { type: 'string', enum: ['all', 'category', 'product'] },
          categories: { type: 'array', items: objectId },
          products: { type: 'array', items: objectId },
          usageLimit: { type: 'integer', description: '0 = unlimited' },
          perUserLimit: { type: 'integer', description: '0 = unlimited' },
          usedCount: { type: 'integer' },
          startsAt: { ...dateTime, nullable: true },
          expiresAt: { ...dateTime, nullable: true },
          isActive: { type: 'boolean' },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      Review: {
        type: 'object',
        properties: {
          id: objectId,
          product: { oneOf: [objectId, { $ref: '#/components/schemas/Product' }] },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          title: { type: 'string' },
          comment: { type: 'string' },
          images: {
            type: 'array',
            items: { type: 'object', properties: { url: { type: 'string' }, publicId: { type: 'string' } } }
          },
          isVerifiedPurchase: { type: 'boolean' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
          author: {
            type: 'object',
            nullable: true,
            properties: { id: { type: 'string' }, name: { type: 'string' } }
          },
          mine: { type: 'boolean' },
          moderationNote: { type: 'string' },
          moderatedAt: { ...dateTime, nullable: true },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      ReviewSummary: {
        type: 'object',
        properties: {
          average: { type: 'number', example: 4.5 },
          total: { type: 'integer', example: 12 },
          distribution: {
            type: 'object',
            properties: {
              1: { type: 'integer' },
              2: { type: 'integer' },
              3: { type: 'integer' },
              4: { type: 'integer' },
              5: { type: 'integer' }
            }
          }
        }
      },
      SupplierCapabilities: {
        type: 'object',
        properties: {
          catalogue: { type: 'boolean' },
          pricing: { type: 'boolean' },
          inventory: { type: 'boolean' },
          orderPlacement: { type: 'boolean' },
          orderStatus: { type: 'boolean' },
          tracking: { type: 'boolean' },
          cancellation: { type: 'boolean' },
          returns: { type: 'boolean' },
          cod: { type: 'boolean' },
          serviceability: { type: 'boolean' }
        }
      },
      SupplierMarkupRule: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['percent', 'fixed'] },
          value: { type: 'number', example: 35 },
          minMarginPercent: { type: 'number', example: 0 }
        }
      },
      Supplier: {
        type: 'object',
        properties: {
          _id: objectId,
          name: { type: 'string', example: 'Mock Supplier (Demo)' },
          code: { type: 'string', example: 'mock-supplier' },
          description: { type: 'string' },
          baseUrl: { type: 'string' },
          allowedHosts: { type: 'array', items: { type: 'string' } },
          adapterType: { type: 'string', enum: ['mock', 'generic_rest'] },
          isMock: { type: 'boolean' },
          credentialsMeta: {
            type: 'object',
            properties: {
              configured: { type: 'boolean' },
              keys: { type: 'array', items: { type: 'string' } },
              updatedAt: { ...dateTime, nullable: true }
            }
          },
          config: { type: 'object', additionalProperties: true },
          capabilities: { $ref: '#/components/schemas/SupplierCapabilities' },
          markupRule: { $ref: '#/components/schemas/SupplierMarkupRule' },
          isActive: { type: 'boolean' },
          lastSyncAt: { ...dateTime, nullable: true },
          lastConnectionTest: {
            type: 'object',
            properties: {
              at: { ...dateTime, nullable: true },
              ok: { type: 'boolean' },
              message: { type: 'string' },
              mode: { type: 'string' }
            }
          },
          createdAt: dateTime,
          updatedAt: dateTime,
          credentials: { type: 'object', description: 'Never returned. Encrypted at rest with AES-256-GCM.', readOnly: true }
        }
      },
      SupplierOrderItem: {
        type: 'object',
        properties: {
          orderItemId: objectId,
          product: objectId,
          supplierProductId: { type: 'string' },
          supplierSku: { type: 'string' },
          supplierVariantId: { type: 'string' },
          sku: { type: 'string' },
          title: { type: 'string' },
          quantity: { type: 'integer' },
          unitPrice: money,
          supplierCost: money
        }
      },
      SupplierOrder: {
        type: 'object',
        properties: {
          _id: objectId,
          order: { oneOf: [objectId, { $ref: '#/components/schemas/Order' }] },
          supplier: { oneOf: [objectId, { $ref: '#/components/schemas/Supplier' }] },
          orderNumber: { type: 'string' },
          supplierOrderId: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'pending_submission',
              'submitting',
              'submitted',
              'accepted',
              'processing',
              'shipped',
              'delivered',
              'cancelled',
              'cancelled_by_supplier',
              'returned',
              'failed',
              'action_required'
            ]
          },
          statusHistory: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                note: { type: 'string' },
                source: { type: 'string', enum: ['system', 'admin', 'supplier', 'webhook'] },
                at: dateTime
              }
            }
          },
          items: { type: 'array', items: { $ref: '#/components/schemas/SupplierOrderItem' } },
          supplierCost: money,
          idempotencyKey: { type: 'string', example: 'hf:HF-2026-000042:665f...' },
          attempts: { type: 'integer' },
          lastAttemptAt: { ...dateTime, nullable: true },
          nextRetryAt: { ...dateTime, nullable: true },
          submittedAt: { ...dateTime, nullable: true },
          acceptedAt: { ...dateTime, nullable: true },
          shippedAt: { ...dateTime, nullable: true },
          deliveredAt: { ...dateTime, nullable: true },
          cancelledAt: { ...dateTime, nullable: true },
          lastError: { type: 'string' },
          retryable: { type: 'boolean' },
          requestPayload: { type: 'object', additionalProperties: true },
          responsePayload: { type: 'object', additionalProperties: true },
          rawStatus: { type: 'string' },
          tracking: { $ref: '#/components/schemas/Tracking' },
          isMock: { type: 'boolean' },
          lastSyncedAt: { ...dateTime, nullable: true },
          needsAttention: { type: 'boolean' },
          createdAt: dateTime,
          updatedAt: dateTime
        }
      },
      SyncLog: {
        type: 'object',
        properties: {
          _id: objectId,
          supplier: { oneOf: [objectId, { $ref: '#/components/schemas/Supplier' }] },
          type: {
            type: 'string',
            enum: ['catalogue', 'inventory', 'order_submit', 'order_status', 'tracking', 'connection_test']
          },
          status: { type: 'string', enum: ['started', 'success', 'partial', 'failed'] },
          message: { type: 'string' },
          stats: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              created: { type: 'integer' },
              updated: { type: 'integer' },
              skipped: { type: 'integer' },
              failed: { type: 'integer' }
            }
          },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: { message: { type: 'string' }, sku: { type: 'string' }, context: { type: 'string' } }
            }
          },
          triggeredBy: { type: 'string', enum: ['manual', 'cron', 'webhook', 'system'] },
          triggeredByUser: { ...objectId, nullable: true },
          requestId: { type: 'string' },
          startedAt: dateTime,
          finishedAt: { ...dateTime, nullable: true },
          createdAt: dateTime
        }
      },
      InventoryTransaction: {
        type: 'object',
        properties: {
          _id: objectId,
          product: { oneOf: [objectId, { $ref: '#/components/schemas/Product' }] },
          variantSku: { type: 'string' },
          type: {
            type: 'string',
            enum: ['import', 'sync', 'reservation', 'release', 'commit', 'admin_adjustment', 'return', 'restock']
          },
          quantity: { type: 'integer' },
          previousStock: { type: 'integer' },
          newStock: { type: 'integer' },
          reference: {
            type: 'object',
            properties: { kind: { type: 'string' }, id: { ...objectId, nullable: true } }
          },
          note: { type: 'string' },
          createdBy: { ...objectId, nullable: true },
          createdAt: dateTime
        }
      },
      AuditLog: {
        type: 'object',
        properties: {
          _id: objectId,
          actor: { oneOf: [objectId, { $ref: '#/components/schemas/User' }], nullable: true },
          actorRole: { type: 'string' },
          action: { type: 'string', example: 'user.update' },
          entityType: { type: 'string', example: 'user' },
          entityId: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          ip: { type: 'string' },
          userAgent: { type: 'string' },
          requestId: { type: 'string' },
          createdAt: dateTime
        }
      },
      WebhookEvent: {
        type: 'object',
        properties: {
          _id: objectId,
          provider: { type: 'string', enum: ['razorpay', 'mock'] },
          eventId: { type: 'string' },
          eventType: { type: 'string' },
          signatureVerified: { type: 'boolean' },
          status: { type: 'string', enum: ['received', 'processed', 'ignored', 'failed'] },
          payload: { type: 'object', additionalProperties: true },
          error: { type: 'string' },
          processedAt: { ...dateTime, nullable: true },
          createdAt: dateTime
        }
      },
      Dashboard: {
        type: 'object',
        properties: {
          users: {
            type: 'object',
            properties: { total: { type: 'integer' }, active: { type: 'integer' }, newToday: { type: 'integer' } }
          },
          products: {
            type: 'object',
            properties: { total: { type: 'integer' }, active: { type: 'integer' }, lowStock: { type: 'integer' } }
          },
          suppliers: { type: 'object', properties: { total: { type: 'integer' }, active: { type: 'integer' } } },
          orders: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              today: { type: 'integer' },
              byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
              pendingPayment: { type: 'integer' }
            }
          },
          revenue: {
            type: 'object',
            properties: {
              grossPaid: money,
              refunded: money,
              net: money,
              paidOrders: { type: 'integer' },
              today: money,
              todayOrders: { type: 'integer' },
              averageOrderValue: money
            }
          },
          supplierOrders: {
            type: 'object',
            properties: {
              byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
              needsAttention: { type: 'integer' }
            }
          },
          recentOrders: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
          recentSyncLogs: { type: 'array', items: { $ref: '#/components/schemas/SyncLog' } }
        }
      },
      PaymentConfig: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['razorpay', 'mock', 'none'] },
          provider: { type: 'string', nullable: true, example: 'razorpay' },
          keyId: { type: 'string', nullable: true },
          mock: { type: 'boolean' },
          configured: { type: 'boolean' }
        }
      },
      SyncResult: {
        type: 'object',
        properties: {
          supplierId: objectId,
          supplierName: { type: 'string' },
          isMock: { type: 'boolean' },
          stats: {
            type: 'object',
            additionalProperties: true,
            example: { total: 12, created: 12, updated: 0, skipped: 0, failed: 0 }
          },
          errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
          logId: objectId,
          mock: { type: 'boolean' }
        }
      },
      UploadResult: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          publicId: { type: 'string' },
          format: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          bytes: { type: 'integer' }
        }
      }
    },
    responses: {
      BadRequest: badRequest(),
      Unauthorized: unauthorized(),
      Forbidden: forbidden(),
      NotFound: notFound(),
      Conflict: conflict(),
      ValidationError: validation(),
      ServerError: serverError(),
      ServiceUnavailable: serviceUnavailable()
    }
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'Mounted at `/health` (outside the /api/v1 prefix).',
        security: [],
        servers: [{ url: '/' }],
        responses: {
          200: ok('Service is alive', {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
              service: { type: 'string', example: 'highflier-backend' },
              uptimeSeconds: { type: 'integer' },
              timestamp: dateTime
            }
          })
        }
      }
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Returns 503 until MongoDB is connected. Mounted at `/health/ready`.',
        security: [],
        servers: [{ url: '/' }],
        responses: {
          200: ok('Service is ready', {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ready' },
              database: { type: 'string', example: 'connected' },
              timestamp: dateTime
            }
          }),
          503: errorResponse('Database not connected', 'NOT_READY', 'Database is not ready')
        }
      }
    },

    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a customer account',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100, example: 'Aarav Sharma' },
              email: { type: 'string', format: 'email', example: 'aarav@example.com' },
              password: { type: 'string', minLength: 8, example: 'Passw0rd123' },
              phone: { type: 'string', example: '9876543210' }
            }
          })
        },
        responses: {
          201: ok(
            'Account created. Tokens are null when email verification is required.',
            {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/User' },
                tokens: { allOf: [{ $ref: '#/components/schemas/AuthTokens' }], nullable: true },
                emailVerificationRequired: { type: 'boolean' },
                message: { type: 'string' }
              }
            }
          ),
          409: conflict(),
          422: validation(),
          429: errorResponse('Rate limit exceeded', 'RATE_LIMITED', 'Too many requests')
        }
      }
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and receive access/refresh tokens',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string' }
            }
          })
        },
        responses: {
          200: ok('Authenticated', {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              tokens: { $ref: '#/components/schemas/AuthTokens' }
            }
          }),
          401: unauthorized(),
          403: errorResponse('Account disabled or email unverified', 'ACCOUNT_DISABLED', 'Your account has been disabled'),
          422: validation(),
          429: errorResponse('Rate limit exceeded', 'RATE_LIMITED', 'Too many requests')
        }
      }
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate a refresh token',
        description: 'The supplied refresh token is invalidated. Reusing an old token revokes the whole session.',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['refreshToken'],
            properties: { refreshToken: { type: 'string', minLength: 20 } }
          })
        },
        responses: {
          200: ok('New token pair', {
            allOf: [
              { $ref: '#/components/schemas/AuthTokens' },
              { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }
            ]
          }),
          401: unauthorized(),
          422: validation()
        }
      }
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Log out of one or all sessions',
        requestBody: {
          required: false,
          content: json({
            type: 'object',
            properties: {
              refreshToken: { type: 'string' },
              allDevices: { type: 'boolean', default: false }
            }
          })
        },
        responses: {
          200: ok('Logged out', {
            type: 'object',
            properties: { message: { type: 'string', example: 'Logged out successfully' } }
          }),
          401: unauthorized()
        }
      }
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get the current user from the access token',
        responses: {
          200: ok('Current user', { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
          401: unauthorized()
        }
      }
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a password reset email',
        description: 'Always returns a generic message so account existence is not disclosed.',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', format: 'email' } }
          })
        },
        responses: {
          200: ok('Generic confirmation', {
            type: 'object',
            properties: { message: { type: 'string' } }
          }),
          422: validation(),
          429: errorResponse('Rate limit exceeded', 'RATE_LIMITED', 'Too many requests')
        }
      }
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset a password using an emailed token',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['token', 'password'],
            properties: {
              token: { type: 'string' },
              password: { type: 'string', minLength: 8, example: 'NewPass123' }
            }
          })
        },
        responses: {
          200: ok('Password reset', {
            type: 'object',
            properties: { message: { type: 'string' } }
          }),
          400: badRequest(),
          422: validation()
        }
      }
    },
    '/auth/verify-email': {
      get: {
        tags: ['Auth'],
        summary: 'Verify an email address',
        security: [],
        parameters: [
          { name: 'token', in: 'query', required: true, schema: { type: 'string', minLength: 20 } }
        ],
        responses: {
          200: ok('Email verified', {
            type: 'object',
            properties: { message: { type: 'string', example: 'Email verified successfully' } }
          }),
          400: badRequest(),
          422: validation()
        }
      }
    },
    '/auth/resend-verification': {
      post: {
        tags: ['Auth'],
        summary: 'Resend the email verification link',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', format: 'email' } }
          })
        },
        responses: {
          200: ok('Generic confirmation', {
            type: 'object',
            properties: { message: { type: 'string' } }
          }),
          429: errorResponse('Rate limit exceeded', 'RATE_LIMITED', 'Too many requests')
        }
      }
    },

    '/users/me': {
      get: {
        tags: ['Users'],
        summary: 'Get the authenticated profile',
        responses: {
          200: ok('Profile', { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
          401: unauthorized()
        }
      },
      patch: {
        tags: ['Users'],
        summary: 'Update name or phone',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              phone: { type: 'string', example: '9876543210' }
            }
          })
        },
        responses: {
          200: ok('Updated profile', { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
          401: unauthorized(),
          422: validation()
        }
      }
    },
    '/users/me/password': {
      patch: {
        tags: ['Users'],
        summary: 'Change password',
        description: 'Revokes existing sessions after the password changes.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['currentPassword', 'newPassword'],
            properties: {
              currentPassword: { type: 'string' },
              newPassword: { type: 'string', minLength: 8 }
            }
          })
        },
        responses: {
          200: ok('Password changed', {
            type: 'object',
            properties: { message: { type: 'string' } }
          }),
          400: badRequest(),
          401: unauthorized(),
          422: validation()
        }
      }
    },
    '/users/me/addresses': {
      get: {
        tags: ['Users'],
        summary: 'List saved addresses',
        responses: {
          200: ok('Addresses', {
            type: 'object',
            properties: { addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' } } }
          }),
          401: unauthorized()
        }
      },
      post: {
        tags: ['Users'],
        summary: 'Add an address',
        requestBody: {
          required: true,
          content: json({
            allOf: [{ $ref: '#/components/schemas/Address' }],
            required: ['fullName', 'phone', 'line1', 'city', 'state', 'pincode']
          })
        },
        responses: {
          201: ok('Address added', {
            type: 'object',
            properties: { addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' } } }
          }),
          401: unauthorized(),
          422: validation()
        }
      }
    },
    '/users/me/addresses/{addressId}': {
      patch: {
        tags: ['Users'],
        summary: 'Update an address',
        parameters: [idPath('addressId', 'Address subdocument id')],
        requestBody: {
          required: true,
          content: json({ type: 'object', additionalProperties: true })
        },
        responses: {
          200: ok('Address updated', {
            type: 'object',
            properties: { addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' } } }
          }),
          401: unauthorized(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Users'],
        summary: 'Delete an address',
        parameters: [idPath('addressId', 'Address subdocument id')],
        responses: {
          200: ok('Address deleted', {
            type: 'object',
            properties: { addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' } } }
          }),
          401: unauthorized(),
          404: notFound()
        }
      }
    },
    '/users/me/addresses/{addressId}/default': {
      patch: {
        tags: ['Users'],
        summary: 'Mark an address as default',
        parameters: [idPath('addressId', 'Address subdocument id')],
        responses: {
          200: ok('Default address updated', {
            type: 'object',
            properties: { addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' } } }
          }),
          401: unauthorized(),
          404: notFound()
        }
      }
    },

    '/categories': {
      get: {
        tags: ['Catalogue'],
        summary: 'List categories',
        security: [],
        parameters: [
          { name: 'includeInactive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
        ],
        responses: {
          200: ok('Categories', {
            type: 'object',
            properties: { categories: { type: 'array', items: { $ref: '#/components/schemas/Category' } } }
          })
        }
      }
    },
    '/categories/{slug}': {
      get: {
        tags: ['Catalogue'],
        summary: 'Get a category by slug',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: ok('Category', { type: 'object', properties: { category: { $ref: '#/components/schemas/Category' } } }),
          404: notFound()
        }
      }
    },
    '/brands': {
      get: {
        tags: ['Catalogue'],
        summary: 'List brands',
        security: [],
        parameters: [
          { name: 'includeInactive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
        ],
        responses: {
          200: ok('Brands', {
            type: 'object',
            properties: { brands: { type: 'array', items: { $ref: '#/components/schemas/Brand' } } }
          })
        }
      }
    },
    '/brands/{slug}': {
      get: {
        tags: ['Catalogue'],
        summary: 'Get a brand by slug',
        security: [],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: ok('Brand', { type: 'object', properties: { brand: { $ref: '#/components/schemas/Brand' } } }),
          404: notFound()
        }
      }
    },
    '/products': {
      get: {
        tags: ['Catalogue'],
        summary: 'List purchasable products',
        description: 'Only active products with an available supplier status are returned.',
        security: [],
        parameters: [
          ...paginationParams,
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'category', in: 'query', description: 'Category id or slug', schema: { type: 'string' } },
          { name: 'brand', in: 'query', description: 'Brand id or slug', schema: { type: 'string' } },
          { name: 'minPrice', in: 'query', schema: { type: 'number', minimum: 0 } },
          { name: 'maxPrice', in: 'query', schema: { type: 'number', minimum: 0 } },
          { name: 'rating', in: 'query', schema: { type: 'number', minimum: 0, maximum: 5 } },
          { name: 'inStock', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          {
            name: 'sort',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['newest', 'oldest', 'price_asc', 'price_desc', 'rating', 'popular', 'name_asc'],
              default: 'newest'
            }
          }
        ],
        responses: {
          200: ok(
            'Products',
            { type: 'object', properties: { products: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } },
            { meta: true }
          ),
          400: badRequest()
        }
      }
    },
    '/products/{identifier}': {
      get: {
        tags: ['Catalogue'],
        summary: 'Get a product by id or slug',
        security: [],
        parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: ok('Product', { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' } } }),
          404: notFound()
        }
      }
    },

    '/reviews/product/{productId}': {
      get: {
        tags: ['Reviews'],
        summary: 'List approved reviews for a product',
        description: 'Authentication is optional; when present, `mine` flags the caller’s review.',
        security: [],
        parameters: [
          idPath('productId', 'Product id'),
          ...paginationParams,
          { name: 'rating', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5 } },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['newest', 'oldest', 'highest', 'lowest'], default: 'newest' }
          }
        ],
        responses: {
          200: ok(
            'Reviews with rating summary',
            {
              type: 'object',
              properties: {
                reviews: { type: 'array', items: { $ref: '#/components/schemas/Review' } },
                summary: { $ref: '#/components/schemas/ReviewSummary' }
              }
            },
            { meta: true }
          ),
          404: notFound()
        }
      },
      post: {
        tags: ['Reviews'],
        summary: 'Create a verified-purchase review',
        description: 'Requires a delivered (or returned) order containing the product. One review per customer per product.',
        parameters: [idPath('productId', 'Product id')],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['rating', 'comment'],
            properties: {
              rating: { type: 'integer', minimum: 1, maximum: 5 },
              title: { type: 'string', maxLength: 120 },
              comment: { type: 'string', minLength: 3, maxLength: 2000 },
              images: {
                type: 'array',
                maxItems: 4,
                items: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, publicId: { type: 'string' } } }
              }
            }
          })
        },
        responses: {
          201: ok('Review created', {
            type: 'object',
            properties: {
              review: { $ref: '#/components/schemas/Review' },
              product: {
                type: 'object',
                properties: { ratingAverage: { type: 'number' }, ratingCount: { type: 'integer' } }
              }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/reviews/me': {
      get: {
        tags: ['Reviews'],
        summary: 'List my reviews',
        parameters: [
          ...paginationParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } }
        ],
        responses: {
          200: ok(
            'My reviews',
            { type: 'object', properties: { reviews: { type: 'array', items: { $ref: '#/components/schemas/Review' } } } },
            { meta: true }
          ),
          401: unauthorized()
        }
      }
    },
    '/reviews/{id}': {
      patch: {
        tags: ['Reviews'],
        summary: 'Update my review',
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              rating: { type: 'integer', minimum: 1, maximum: 5 },
              title: { type: 'string', maxLength: 120 },
              comment: { type: 'string', minLength: 3, maxLength: 2000 },
              images: { type: 'array', maxItems: 4, items: { type: 'object' } }
            }
          })
        },
        responses: {
          200: ok('Review updated', { type: 'object', properties: { review: { $ref: '#/components/schemas/Review' } } }),
          401: unauthorized(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Reviews'],
        summary: 'Delete my review',
        parameters: [idPath()],
        responses: {
          200: ok('Review deleted', {
            type: 'object',
            properties: {
              message: { type: 'string' },
              product: { type: 'object', properties: { ratingAverage: { type: 'number' }, ratingCount: { type: 'integer' } } }
            }
          }),
          401: unauthorized(),
          404: notFound()
        }
      }
    },

    '/cart': {
      get: {
        tags: ['Cart'],
        summary: 'Get my cart (server-repriced)',
        responses: { 200: ok('Cart', { $ref: '#/components/schemas/Cart' }), 401: unauthorized() }
      },
      post: {
        tags: ['Cart'],
        summary: 'Add or merge an item',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['productId', 'sku'],
            properties: {
              productId: objectId,
              sku: { type: 'string', maxLength: 120 },
              quantity: { type: 'integer', minimum: 1, maximum: 20, default: 1 }
            }
          })
        },
        responses: {
          201: ok('Cart updated', { $ref: '#/components/schemas/Cart' }),
          401: unauthorized(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      },
      delete: {
        tags: ['Cart'],
        summary: 'Clear the cart',
        responses: { 200: ok('Cart cleared', { $ref: '#/components/schemas/Cart' }), 401: unauthorized() }
      }
    },
    '/cart/items/{productId}/{sku}': {
      patch: {
        tags: ['Cart'],
        summary: 'Update item quantity (0 removes it)',
        parameters: [idPath('productId', 'Product id'), { name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['quantity'],
            properties: { quantity: { type: 'integer', minimum: 0, maximum: 20 } }
          })
        },
        responses: {
          200: ok('Cart updated', { $ref: '#/components/schemas/Cart' }),
          401: unauthorized(),
          409: conflict(),
          422: validation()
        }
      },
      delete: {
        tags: ['Cart'],
        summary: 'Remove an item',
        parameters: [idPath('productId', 'Product id'), { name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: ok('Item removed', { $ref: '#/components/schemas/Cart' }), 401: unauthorized() }
      }
    },
    '/wishlist': {
      get: {
        tags: ['Wishlist'],
        summary: 'Get my wishlist',
        responses: { 200: ok('Wishlist', { $ref: '#/components/schemas/Wishlist' }), 401: unauthorized() }
      },
      post: {
        tags: ['Wishlist'],
        summary: 'Save a product',
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['productId'], properties: { productId: objectId } })
        },
        responses: {
          201: ok('Wishlist', { $ref: '#/components/schemas/Wishlist' }),
          401: unauthorized(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Wishlist'],
        summary: 'Clear my wishlist',
        responses: { 200: ok('Wishlist cleared', { $ref: '#/components/schemas/Wishlist' }), 401: unauthorized() }
      }
    },
    '/wishlist/{productId}': {
      delete: {
        tags: ['Wishlist'],
        summary: 'Remove a product from the wishlist',
        parameters: [idPath('productId', 'Product id')],
        responses: { 200: ok('Wishlist', { $ref: '#/components/schemas/Wishlist' }), 401: unauthorized() }
      }
    },

    '/orders/checkout': {
      post: {
        tags: ['Orders'],
        summary: 'Place an order from the cart or explicit items',
        description:
          'Totals are recalculated server-side. Stock is reserved atomically. COD is rejected when any supplier lacks COD capability. Online payments return a gateway checkout payload; COD confirms immediately and forwards supplier orders.',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['paymentMethod'],
            properties: {
              paymentMethod: { type: 'string', enum: ['online', 'cod'] },
              addressId: objectId,
              shippingAddress: { $ref: '#/components/schemas/OrderAddress' },
              couponCode: { type: 'string', maxLength: 40 },
              items: {
                type: 'array',
                maxItems: 50,
                description: 'Optional. When omitted the current cart is used.',
                items: {
                  type: 'object',
                  required: ['productId', 'sku', 'quantity'],
                  properties: {
                    productId: objectId,
                    sku: { type: 'string' },
                    quantity: { type: 'integer', minimum: 1, maximum: 20 }
                  }
                }
              },
              customerNote: { type: 'string', maxLength: 1000 }
            }
          })
        },
        responses: {
          201: ok('Order created', {
            type: 'object',
            properties: {
              order: { $ref: '#/components/schemas/Order' },
              replay: { type: 'boolean', description: 'True when an Idempotency-Key matched an existing order.' },
              payment: { allOf: [{ $ref: '#/components/schemas/PaymentCheckout' }], nullable: true }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          409: conflict(),
          422: validation(),
          503: errorResponse('Online payments not configured', 'PAYMENT_NOT_CONFIGURED', 'Online payments are not configured')
        }
      }
    },
    '/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List my orders',
        parameters: [
          ...paginationParams,
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'refunded']
            }
          },
          { name: 'from', in: 'query', schema: { ...dateTime } },
          { name: 'to', in: 'query', schema: { ...dateTime } }
        ],
        responses: {
          200: ok('My orders', { type: 'array', items: { $ref: '#/components/schemas/Order' } }, { meta: true }),
          401: unauthorized()
        }
      }
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get one of my orders by id or order number',
        parameters: [idPath('id', 'Order id or order number')],
        responses: {
          200: ok('Order', { $ref: '#/components/schemas/Order' }),
          401: unauthorized(),
          404: notFound()
        }
      }
    },
    '/orders/{id}/cancel': {
      post: {
        tags: ['Orders'],
        summary: 'Cancel my order',
        description: 'Allowed while pending payment, confirmed or processing. Stock is restored and online payments are refunded (mock refund in mock mode).',
        parameters: [idPath('id', 'Order id or order number')],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['reason'],
            properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } }
          })
        },
        responses: {
          200: ok('Order cancelled', {
            type: 'object',
            properties: {
              order: { $ref: '#/components/schemas/Order' },
              refund: { type: 'object', nullable: true, additionalProperties: true }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/orders/{id}/return': {
      post: {
        tags: ['Orders'],
        summary: 'Request a return for a delivered order',
        description: 'The return window is configured by RETURN_WINDOW_DAYS.',
        parameters: [idPath('id', 'Order id or order number')],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['reason'],
            properties: {
              reason: { type: 'string', minLength: 3, maxLength: 500 },
              note: { type: 'string', maxLength: 1000 }
            }
          })
        },
        responses: {
          200: ok('Return requested', { $ref: '#/components/schemas/Order' }),
          400: badRequest(),
          401: unauthorized(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },

    '/coupons/validate': {
      post: {
        tags: ['Coupons'],
        summary: 'Validate a coupon against my live cart',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['code'],
            properties: {
              code: { type: 'string' },
              items: {
                type: 'array',
                maxItems: 50,
                items: {
                  type: 'object',
                  required: ['productId', 'sku', 'quantity'],
                  properties: {
                    productId: objectId,
                    sku: { type: 'string' },
                    quantity: { type: 'integer', minimum: 1, maximum: 20 }
                  }
                }
              }
            }
          })
        },
        responses: {
          200: ok('Coupon is valid', {
            type: 'object',
            properties: {
              code: { type: 'string' },
              description: { type: 'string' },
              discountType: { type: 'string', enum: ['percent', 'fixed'] },
              discountValue: { type: 'number' },
              discount: money,
              subtotal: money,
              eligibleSubtotal: money
            }
          }),
          400: errorResponse('Coupon is invalid for this cart', 'INVALID_COUPON', 'This coupon does not apply to the items in your cart'),
          401: unauthorized(),
          404: notFound(),
          422: validation()
        }
      }
    },

    '/payments/config': {
      get: {
        tags: ['Payments'],
        summary: 'Get the public payment configuration',
        responses: { 200: ok('Payment configuration', { $ref: '#/components/schemas/PaymentConfig' }), 401: unauthorized() }
      }
    },
    '/payments/orders/{orderId}': {
      post: {
        tags: ['Payments'],
        summary: 'Create or reuse a payment intent for my order',
        parameters: [idPath('orderId', 'Order id')],
        responses: {
          200: ok('Gateway checkout payload', { $ref: '#/components/schemas/PaymentCheckout' }),
          400: badRequest(),
          401: unauthorized(),
          404: notFound(),
          409: conflict(),
          503: errorResponse('Payments not configured', 'PAYMENT_NOT_CONFIGURED', 'Payment gateway is not configured')
        }
      }
    },
    '/payments/verify': {
      post: {
        tags: ['Payments'],
        summary: 'Verify a payment signature and capture the order',
        description:
          'Accepts either camelCase or Razorpay-style snake_case fields. The signature is HMAC-SHA256 over `orderId|paymentId`. Verification is idempotent.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              providerOrderId: { type: 'string' },
              providerPaymentId: { type: 'string' },
              signature: { type: 'string' },
              razorpay_order_id: { type: 'string' },
              razorpay_payment_id: { type: 'string' },
              razorpay_signature: { type: 'string' }
            }
          })
        },
        responses: {
          200: ok('Payment verified', {
            type: 'object',
            properties: {
              payment: { $ref: '#/components/schemas/Payment' },
              order: { $ref: '#/components/schemas/Order' },
              replay: { type: 'boolean' }
            }
          }),
          400: errorResponse('Signature verification failed', 'SIGNATURE_INVALID', 'Payment signature verification failed'),
          401: unauthorized(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/payments/mock/pay': {
      post: {
        tags: ['Payments'],
        summary: 'Simulate a payment (mock mode only)',
        description: 'Clearly labelled mock endpoint. No real money moves.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['orderId'],
            properties: { orderId: objectId, outcome: { type: 'string', enum: ['success', 'failure'], default: 'success' } }
          })
        },
        responses: {
          200: ok('Mock payment result', {
            type: 'object',
            properties: {
              mock: { type: 'boolean', example: true },
              payment: { $ref: '#/components/schemas/Payment' },
              order: { allOf: [{ $ref: '#/components/schemas/Order' }], nullable: true },
              replay: { type: 'boolean' },
              failed: { type: 'boolean' }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/payments/order/{orderId}': {
      get: {
        tags: ['Payments'],
        summary: 'List payments for one of my orders',
        parameters: [idPath('orderId', 'Order id')],
        responses: {
          200: ok('Payments', { type: 'array', items: { $ref: '#/components/schemas/Payment' } }),
          401: unauthorized(),
          404: notFound()
        }
      }
    },
    '/payments/webhook': {
      post: {
        tags: ['Payments'],
        summary: 'Razorpay webhook receiver',
        description:
          'Raw-body HMAC verification using RAZORPAY_WEBHOOK_SECRET. Events are deduplicated by provider event id. Invalid signatures return 400.',
        security: [],
        parameters: [
          {
            name: 'X-Razorpay-Signature',
            in: 'header',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: json({ type: 'object', additionalProperties: true })
        },
        responses: {
          200: ok('Event acknowledged', {
            type: 'object',
            properties: {
              received: { type: 'boolean' },
              duplicate: { type: 'boolean' },
              status: { type: 'string' },
              eventType: { type: 'string' }
            }
          }),
          400: errorResponse('Invalid or missing signature', 'WEBHOOK_INVALID', 'Webhook signature verification failed')
        }
      }
    },

    '/admin/dashboard': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Dashboard metrics'),
        responses: { 200: ok('Dashboard', { $ref: '#/components/schemas/Dashboard' }), 401: unauthorized(), 403: forbidden() }
      }
    },
    '/admin/users': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List users'),
        parameters: [
          ...paginationParams,
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['customer', 'admin'] } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } }
        ],
        responses: {
          200: ok('Users', { type: 'array', items: { $ref: '#/components/schemas/User' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/users/{id}': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Get a user with lifetime value'),
        parameters: [idPath()],
        responses: {
          200: ok('User details', {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              stats: {
                type: 'object',
                properties: { orders: { type: 'integer' }, lifetimeValue: money }
              }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      },
      patch: {
        tags: ['Admin'],
        summary: roleNote('Update a user (role, activation, profile)'),
        description: 'The last active admin cannot be demoted or deactivated. Deactivation revokes sessions.',
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              phone: { type: 'string' },
              role: { type: 'string', enum: ['customer', 'admin'] },
              isActive: { type: 'boolean' }
            }
          })
        },
        responses: {
          200: ok('Updated user', { $ref: '#/components/schemas/User' }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      }
    },
    '/admin/users/{id}/revoke-sessions': {
      post: {
        tags: ['Admin'],
        summary: roleNote('Revoke all sessions for a user'),
        parameters: [idPath()],
        responses: {
          200: ok('Sessions revoked', {
            type: 'object',
            properties: { message: { type: 'string' }, deleted: { type: 'integer' } }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/reports/sales': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Daily sales report'),
        parameters: [
          { name: 'from', in: 'query', schema: { ...dateTime } },
          { name: 'to', in: 'query', schema: { ...dateTime } }
        ],
        responses: {
          200: ok('Sales report', {
            type: 'object',
            properties: {
              from: dateTime,
              to: dateTime,
              daily: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string', example: '2026-10-31' },
                    revenue: money,
                    refunded: money,
                    net: money,
                    orders: { type: 'integer' }
                  }
                }
              },
              totals: {
                type: 'object',
                properties: { revenue: money, refunded: money, net: money, orders: { type: 'integer' } }
              }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/reports/top-products': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Top products by revenue'),
        parameters: [
          { name: 'from', in: 'query', schema: { ...dateTime } },
          { name: 'to', in: 'query', schema: { ...dateTime } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }
        ],
        responses: {
          200: ok('Top products', {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: objectId,
                title: { type: 'string' },
                slug: { type: 'string' },
                quantity: { type: 'integer' },
                revenue: money
              }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/reports/low-stock': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Low-stock variants'),
        parameters: [
          { name: 'threshold', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1000, default: 5 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }
        ],
        responses: {
          200: ok('Low-stock report', {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: objectId,
                title: { type: 'string' },
                slug: { type: 'string' },
                supplier: { type: 'object', additionalProperties: true },
                lastSyncedAt: { ...dateTime, nullable: true },
                lowStockVariants: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      sku: { type: 'string' },
                      name: { type: 'string' },
                      stock: { type: 'integer' },
                      reserved: { type: 'integer' },
                      available: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/reports/suppliers': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Supplier performance summary'),
        responses: {
          200: ok('Supplier performance', {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                supplierId: objectId,
                name: { type: 'string' },
                code: { type: 'string' },
                isMock: { type: 'boolean' },
                isActive: { type: 'boolean' },
                lastSyncAt: { ...dateTime, nullable: true },
                lastConnectionTest: { type: 'object', additionalProperties: true },
                supplierOrders: {
                  type: 'object',
                  properties: { total: { type: 'integer' }, submitted: { type: 'integer' }, failed: { type: 'integer' } }
                }
              }
            }
          }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/audit-logs': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List admin audit logs'),
        parameters: [
          ...paginationParams,
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'entityType', in: 'query', schema: { type: 'string' } },
          { name: 'actor', in: 'query', schema: objectId },
          { name: 'from', in: 'query', schema: { ...dateTime } },
          { name: 'to', in: 'query', schema: { ...dateTime } }
        ],
        responses: {
          200: ok('Audit logs', { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/webhook-logs': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List received webhook events'),
        parameters: [
          ...paginationParams,
          { name: 'provider', in: 'query', schema: { type: 'string', enum: ['razorpay', 'mock'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['received', 'processed', 'ignored', 'failed'] } },
          { name: 'eventType', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: ok('Webhook events', { type: 'array', items: { $ref: '#/components/schemas/WebhookEvent' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/sync-logs': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List supplier sync logs'),
        parameters: [
          ...paginationParams,
          { name: 'supplierId', in: 'query', schema: objectId },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['catalogue', 'inventory', 'order_submit', 'order_status', 'tracking', 'connection_test'] }
          },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['started', 'success', 'partial', 'failed'] } }
        ],
        responses: {
          200: ok('Sync logs', { type: 'array', items: { $ref: '#/components/schemas/SyncLog' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },

    '/admin/categories': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List categories including inactive'),
        responses: {
          200: ok('Categories', {
            type: 'object',
            properties: { categories: { type: 'array', items: { $ref: '#/components/schemas/Category' } } }
          }),
          401: unauthorized(),
          403: forbidden()
        }
      },
      post: {
        tags: ['Admin'],
        summary: roleNote('Create a category'),
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 120 },
              description: { type: 'string', maxLength: 1000 },
              parentCategory: { ...objectId, nullable: true },
              image: {
                type: 'object',
                properties: { url: { type: 'string' }, alt: { type: 'string' } }
              },
              isActive: { type: 'boolean', default: true },
              sortOrder: { type: 'integer', minimum: 0 }
            }
          })
        },
        responses: {
          201: ok('Category created', { type: 'object', properties: { category: { $ref: '#/components/schemas/Category' } } }),
          401: unauthorized(),
          403: forbidden(),
          422: validation()
        }
      }
    },
    '/admin/categories/{id}': {
      patch: {
        tags: ['Admin'],
        summary: roleNote('Update a category'),
        parameters: [idPath()],
        requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) },
        responses: {
          200: ok('Category updated', { type: 'object', properties: { category: { $ref: '#/components/schemas/Category' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin'],
        summary: roleNote('Deactivate a category'),
        parameters: [idPath()],
        responses: {
          200: ok('Category deactivated', { type: 'object', additionalProperties: true }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/brands': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List brands including inactive'),
        responses: {
          200: ok('Brands', {
            type: 'object',
            properties: { brands: { type: 'array', items: { $ref: '#/components/schemas/Brand' } } }
          }),
          401: unauthorized(),
          403: forbidden()
        }
      },
      post: {
        tags: ['Admin'],
        summary: roleNote('Create a brand'),
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 120 },
              description: { type: 'string', maxLength: 1000 },
              logo: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  publicId: { type: 'string' },
                  alt: { type: 'string' }
                }
              },
              isActive: { type: 'boolean', default: true }
            }
          })
        },
        responses: {
          201: ok('Brand created', { type: 'object', properties: { brand: { $ref: '#/components/schemas/Brand' } } }),
          401: unauthorized(),
          403: forbidden(),
          422: validation()
        }
      }
    },
    '/admin/brands/{id}': {
      patch: {
        tags: ['Admin'],
        summary: roleNote('Update a brand'),
        parameters: [idPath()],
        requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) },
        responses: {
          200: ok('Brand updated', { type: 'object', properties: { brand: { $ref: '#/components/schemas/Brand' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin'],
        summary: roleNote('Deactivate a brand'),
        parameters: [idPath()],
        responses: {
          200: ok('Brand deactivated', { type: 'object', additionalProperties: true }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/products': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List products with admin fields'),
        parameters: [
          ...paginationParams,
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'inactive', 'discontinued'] } },
          {
            name: 'supplierStatus',
            in: 'query',
            schema: { type: 'string', enum: ['available', 'unavailable', 'stale', 'discontinued'] }
          },
          { name: 'supplier', in: 'query', schema: objectId },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'brand', in: 'query', schema: { type: 'string' } },
          { name: 'lowStock', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'oldest', 'price_asc', 'price_desc', 'name_asc'] } }
        ],
        responses: {
          200: ok('Products', { type: 'object', properties: { products: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/products/{id}': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Get a product'),
        parameters: [idPath()],
        responses: {
          200: ok('Product', { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      },
      patch: {
        tags: ['Admin'],
        summary: roleNote('Update merchandising fields, pricing and variants'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              shortDescription: { type: 'string' },
              category: { ...objectId, nullable: true },
              brand: { ...objectId, nullable: true },
              status: { type: 'string', enum: ['draft', 'active', 'inactive', 'discontinued'] },
              images: { type: 'array', items: { $ref: '#/components/schemas/ProductImage' } },
              tags: { type: 'array', items: { type: 'string' } },
              variantPrices: { type: 'object', additionalProperties: { type: 'number', minimum: 0 }, example: { 'MOCK-HK-001-STD': 1499 } },
              variantActive: { type: 'object', additionalProperties: { type: 'boolean' } }
            }
          })
        },
        responses: {
          200: ok('Product updated', { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin'],
        summary: roleNote('Discontinue a product'),
        description: 'Existing orders retain their immutable snapshots.',
        parameters: [idPath()],
        responses: {
          200: ok('Product discontinued', {
            type: 'object',
            properties: { message: { type: 'string' } }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/products/{id}/activate': {
      post: {
        tags: ['Admin'],
        summary: roleNote('Activate a product'),
        parameters: [idPath()],
        responses: {
          200: ok('Product activated', { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/products/{id}/deactivate': {
      post: {
        tags: ['Admin'],
        summary: roleNote('Deactivate a product'),
        parameters: [idPath()],
        responses: {
          200: ok('Product deactivated', { type: 'object', properties: { product: { $ref: '#/components/schemas/Product' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/reviews': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List reviews for moderation'),
        parameters: [
          ...paginationParams,
          { name: 'product', in: 'query', schema: objectId },
          { name: 'user', in: 'query', schema: objectId },
          { name: 'rating', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } }
        ],
        responses: {
          200: ok('Reviews', { type: 'object', properties: { reviews: { type: 'array', items: { $ref: '#/components/schemas/Review' } } } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/reviews/{id}': {
      patch: {
        tags: ['Admin'],
        summary: roleNote('Approve or reject a review'),
        description: 'Writes an audit record and recomputes the product rating.',
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['approved', 'rejected'] },
              note: { type: 'string', maxLength: 500 }
            }
          })
        },
        responses: {
          200: ok('Review moderated', {
            type: 'object',
            properties: {
              review: { $ref: '#/components/schemas/Review' },
              product: { type: 'object', properties: { ratingAverage: { type: 'number' }, ratingCount: { type: 'integer' } } }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin'],
        summary: roleNote('Delete a review'),
        parameters: [idPath()],
        responses: {
          200: ok('Review deleted', {
            type: 'object',
            properties: {
              message: { type: 'string' },
              product: { type: 'object', properties: { ratingAverage: { type: 'number' }, ratingCount: { type: 'integer' } } }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },

    '/admin/orders': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List all orders'),
        parameters: [
          ...paginationParams,
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'refunded']
            }
          },
          { name: 'paymentStatus', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: objectId },
          { name: 'supplierId', in: 'query', schema: objectId },
          { name: 'fulfilmentIssue', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'from', in: 'query', schema: { ...dateTime } },
          { name: 'to', in: 'query', schema: { ...dateTime } }
        ],
        responses: {
          200: ok('Orders', { type: 'array', items: { $ref: '#/components/schemas/Order' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/orders/{id}': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Get an order with supplier orders'),
        parameters: [idPath()],
        responses: {
          200: ok('Order', { $ref: '#/components/schemas/Order' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/orders/{id}/status': {
      patch: {
        tags: ['Admin'],
        summary: roleNote('Transition order status'),
        description: 'Only transitions allowed by the order state machine are accepted. Marking delivered captures COD payments.',
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['status'],
            properties: {
              status: {
                type: 'string',
                enum: ['pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'refunded']
              },
              note: { type: 'string', maxLength: 500 }
            }
          })
        },
        responses: {
          200: ok('Order updated', { $ref: '#/components/schemas/Order' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/admin/orders/{id}/tracking': {
      patch: {
        tags: ['Admin'],
        summary: roleNote('Set shipment tracking'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              courier: { type: 'string', maxLength: 120 },
              trackingNumber: { type: 'string', maxLength: 120 },
              trackingUrl: { type: 'string', format: 'uri', maxLength: 2000 },
              isMock: { type: 'boolean' },
              note: { type: 'string', maxLength: 500 }
            }
          })
        },
        responses: {
          200: ok('Tracking updated', { $ref: '#/components/schemas/Order' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      }
    },
    '/admin/orders/{id}/note': {
      patch: {
        tags: ['Admin'],
        summary: roleNote('Set the internal admin note'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({ type: 'object', properties: { adminNote: { type: 'string', maxLength: 1000 } } })
        },
        responses: {
          200: ok('Note updated', { $ref: '#/components/schemas/Order' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      }
    },
    '/admin/orders/{id}/refund': {
      post: {
        tags: ['Admin'],
        summary: roleNote('Refund a captured payment'),
        description: 'Partial refunds are supported. Online refunds use the gateway (mock refund in mock mode); COD refunds are manual. Optionally restocks committed items.',
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['reason'],
            properties: {
              amount: { type: 'number', minimum: 0, description: 'Defaults to the full remaining amount.' },
              reason: { type: 'string', minLength: 3, maxLength: 500 },
              restock: { type: 'boolean', default: false }
            }
          })
        },
        responses: {
          200: ok('Refund processed', {
            type: 'object',
            properties: {
              order: { $ref: '#/components/schemas/Order' },
              refund: { type: 'object', additionalProperties: true },
              fullyRefunded: { type: 'boolean' }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/admin/orders/{id}/return-decision': {
      post: {
        tags: ['Admin'],
        summary: roleNote('Approve or reject a return request'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['decision'],
            properties: {
              decision: { type: 'string', enum: ['approve', 'reject'] },
              note: { type: 'string', maxLength: 1000 }
            }
          })
        },
        responses: {
          200: ok('Return resolved', { $ref: '#/components/schemas/Order' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },

    '/admin/coupons': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List coupons'),
        parameters: [
          ...paginationParams,
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
        ],
        responses: {
          200: ok('Coupons', { type: 'array', items: { $ref: '#/components/schemas/Coupon' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      },
      post: {
        tags: ['Admin'],
        summary: roleNote('Create a coupon'),
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['code', 'discountType', 'discountValue'],
            properties: {
              code: { type: 'string', example: 'WELCOME10' },
              description: { type: 'string', maxLength: 300 },
              discountType: { type: 'string', enum: ['percent', 'fixed'] },
              discountValue: { type: 'number', exclusiveMinimum: 0 },
              maxDiscount: { type: 'number', minimum: 0 },
              minOrderValue: { type: 'number', minimum: 0 },
              scope: { type: 'string', enum: ['all', 'category', 'product'] },
              categories: { type: 'array', items: objectId },
              products: { type: 'array', items: objectId },
              usageLimit: { type: 'integer', minimum: 0 },
              perUserLimit: { type: 'integer', minimum: 0 },
              startsAt: { ...dateTime, nullable: true },
              expiresAt: { ...dateTime, nullable: true },
              isActive: { type: 'boolean' }
            }
          })
        },
        responses: {
          201: ok('Coupon created', { $ref: '#/components/schemas/Coupon' }),
          401: unauthorized(),
          403: forbidden(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/admin/coupons/{id}': {
      get: {
        tags: ['Admin'],
        summary: roleNote('Get a coupon'),
        parameters: [idPath()],
        responses: { 200: ok('Coupon', { $ref: '#/components/schemas/Coupon' }), 401: unauthorized(), 403: forbidden(), 404: notFound() }
      },
      patch: {
        tags: ['Admin'],
        summary: roleNote('Update a coupon'),
        parameters: [idPath()],
        requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) },
        responses: {
          200: ok('Coupon updated', { $ref: '#/components/schemas/Coupon' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin'],
        summary: roleNote('Deactivate a coupon'),
        parameters: [idPath()],
        responses: { 200: ok('Coupon deactivated', { $ref: '#/components/schemas/Coupon' }), 401: unauthorized(), 403: forbidden(), 404: notFound() }
      }
    },
    '/admin/payments': {
      get: {
        tags: ['Admin'],
        summary: roleNote('List payments'),
        parameters: [
          ...paginationParams,
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'provider', in: 'query', schema: { type: 'string', enum: ['razorpay', 'mock', 'cod'] } },
          { name: 'orderId', in: 'query', schema: objectId }
        ],
        responses: {
          200: ok('Payments', { type: 'array', items: { $ref: '#/components/schemas/Payment' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },

    '/admin/suppliers': {
      get: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('List suppliers'),
        parameters: [
          ...paginationParams,
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'adapterType', in: 'query', schema: { type: 'string', enum: ['mock', 'generic_rest'] } },
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } }
        ],
        responses: {
          200: ok('Suppliers', { type: 'object', properties: { suppliers: { type: 'array', items: { $ref: '#/components/schemas/Supplier' } } } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      },
      post: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Create a supplier connection'),
        description:
          'Credentials are encrypted with AES-256-GCM and never returned. The generic_rest adapter requires a documented base URL and allowlisted hosts; no endpoints are invented.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name', 'code'],
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 120 },
              code: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', example: 'mock-supplier' },
              description: { type: 'string', maxLength: 1000 },
              adapterType: { type: 'string', enum: ['mock', 'generic_rest'], default: 'mock' },
              baseUrl: { type: 'string', format: 'uri' },
              allowedHosts: { type: 'array', items: { type: 'string' }, maxItems: 20 },
              credentials: { type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
              config: { type: 'object', additionalProperties: true },
              capabilities: { $ref: '#/components/schemas/SupplierCapabilities' },
              markupRule: { $ref: '#/components/schemas/SupplierMarkupRule' },
              isActive: { type: 'boolean', default: true }
            }
          })
        },
        responses: {
          201: ok('Supplier created', { type: 'object', properties: { supplier: { $ref: '#/components/schemas/Supplier' } } }),
          401: unauthorized(),
          403: forbidden(),
          409: conflict(),
          422: validation()
        }
      }
    },
    '/admin/suppliers/{id}': {
      get: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Get a supplier'),
        parameters: [idPath()],
        responses: {
          200: ok('Supplier', { type: 'object', properties: { supplier: { $ref: '#/components/schemas/Supplier' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      },
      patch: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Update supplier configuration'),
        parameters: [idPath()],
        requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) },
        responses: {
          200: ok('Supplier updated', { type: 'object', properties: { supplier: { $ref: '#/components/schemas/Supplier' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Deactivate a supplier'),
        parameters: [idPath()],
        responses: {
          200: ok('Supplier deactivated', {
            type: 'object',
            properties: { message: { type: 'string' }, supplier: { $ref: '#/components/schemas/Supplier' } }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/suppliers/{id}/credentials': {
      put: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Store supplier credentials (encrypted)'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['credentials'],
            properties: {
              credentials: {
                type: 'object',
                additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
                example: { apiKey: 'supplier-api-key', apiSecret: 'supplier-api-secret' }
              }
            }
          })
        },
        responses: {
          200: ok('Credentials stored', {
            type: 'object',
            properties: {
              credentialsMeta: {
                type: 'object',
                properties: {
                  configured: { type: 'boolean' },
                  keys: { type: 'array', items: { type: 'string' } },
                  updatedAt: dateTime
                }
              },
              message: { type: 'string' }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      },
      delete: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Remove stored supplier credentials'),
        parameters: [idPath()],
        responses: {
          200: ok('Credentials removed', { type: 'object', properties: { message: { type: 'string' } } }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/suppliers/{id}/test-connection': {
      post: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Test the supplier connection'),
        parameters: [idPath()],
        responses: {
          200: ok('Connection test result', {
            type: 'object',
            properties: { connection: { type: 'object', additionalProperties: true } }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          502: errorResponse('Supplier connection failed', 'SUPPLIER_ERROR', 'Supplier connection test failed')
        }
      }
    },
    '/admin/suppliers/{id}/capabilities': {
      get: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Get supplier capabilities'),
        parameters: [idPath()],
        responses: {
          200: ok('Capabilities', {
            type: 'object',
            properties: {
              supplierId: objectId,
              adapterType: { type: 'string' },
              isMock: { type: 'boolean' },
              capabilities: { $ref: '#/components/schemas/SupplierCapabilities' }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/suppliers/{id}/logs': {
      get: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('List sync logs for a supplier'),
        parameters: [
          idPath(),
          ...paginationParams,
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['catalogue', 'inventory', 'order_submit', 'order_status', 'tracking', 'connection_test'] }
          },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['started', 'success', 'partial', 'failed'] } }
        ],
        responses: {
          200: ok('Sync logs', { type: 'object', properties: { logs: { type: 'array', items: { $ref: '#/components/schemas/SyncLog' } } } }, { meta: true }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/suppliers/{id}/markup': {
      put: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Update markup and reprice products'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({ $ref: '#/components/schemas/SupplierMarkupRule' })
        },
        responses: {
          200: ok('Markup updated', {
            type: 'object',
            properties: {
              supplier: { $ref: '#/components/schemas/Supplier' },
              repricing: { type: 'object', additionalProperties: true }
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      }
    },
    '/admin/suppliers/{id}/sync/catalogue': {
      post: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Import or update the supplier catalogue'),
        parameters: [idPath()],
        requestBody: {
          required: false,
          content: json({ type: 'object', properties: { maxPages: { type: 'integer', minimum: 1, maximum: 200 } } })
        },
        responses: {
          200: ok('Catalogue sync completed', { $ref: '#/components/schemas/SyncResult' }),
          400: errorResponse('Adapter does not support catalogue import', 'SUPPLIER_UNSUPPORTED', 'Supplier does not support catalogue import'),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          502: errorResponse('Supplier sync failed', 'SUPPLIER_ERROR', 'Catalogue sync failed')
        }
      }
    },
    '/admin/suppliers/{id}/sync/inventory': {
      post: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Sync supplier inventory'),
        parameters: [idPath()],
        requestBody: {
          required: false,
          content: json({ type: 'object', properties: { markMissingUnavailable: { type: 'boolean', default: false } } })
        },
        responses: {
          200: ok('Inventory sync completed', { $ref: '#/components/schemas/SyncResult' }),
          400: errorResponse('Adapter does not support inventory', 'SUPPLIER_UNSUPPORTED', 'Supplier does not support inventory sync'),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          502: errorResponse('Supplier sync failed', 'SUPPLIER_ERROR', 'Inventory sync failed')
        }
      }
    },
    '/admin/suppliers/{id}/sync/stale-scan': {
      post: {
        tags: ['Admin - Suppliers'],
        summary: roleNote('Mark stale products unavailable'),
        parameters: [idPath()],
        requestBody: {
          required: false,
          content: json({ type: 'object', properties: { hours: { type: 'integer', minimum: 1, maximum: 720 } } })
        },
        responses: {
          200: ok('Stale scan completed', {
            type: 'object',
            properties: {
              supplierId: objectId,
              staleProducts: { type: 'integer' },
              cutoff: dateTime,
              logId: objectId
            }
          }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },

    '/admin/supplier-orders': {
      get: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('List supplier orders'),
        parameters: [
          ...paginationParams,
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['pending_submission', 'submitting', 'submitted', 'accepted', 'processing', 'shipped', 'delivered', 'cancelled', 'cancelled_by_supplier', 'returned', 'failed', 'action_required']
            }
          },
          { name: 'supplierId', in: 'query', schema: objectId },
          { name: 'orderId', in: 'query', schema: objectId },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'needsAttention', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
        ],
        responses: {
          200: ok('Supplier orders', { type: 'array', items: { $ref: '#/components/schemas/SupplierOrder' } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/supplier-orders/stats': {
      get: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('Supplier order counts by status'),
        responses: {
          200: ok('Status counts', { type: 'object', additionalProperties: { type: 'integer' } }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/supplier-orders/retry-due': {
      post: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('Retry all supplier orders that are due'),
        responses: {
          200: ok('Retry results', {
            type: 'object',
            properties: { attempted: { type: 'integer' }, results: { type: 'array', items: { type: 'object', additionalProperties: true } } }
          }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/supplier-orders/{id}': {
      get: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('Get a supplier order'),
        parameters: [idPath()],
        responses: {
          200: ok('Supplier order', { $ref: '#/components/schemas/SupplierOrder' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/supplier-orders/{id}/retry': {
      post: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('Retry forwarding a supplier order'),
        description: 'Idempotent: the same supplier order is never duplicated at the supplier.',
        parameters: [idPath()],
        responses: {
          200: ok('Supplier order after retry', { $ref: '#/components/schemas/SupplierOrder' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          409: conflict(),
          502: errorResponse('Supplier submission failed', 'SUPPLIER_ERROR', 'Supplier order submission failed')
        }
      }
    },
    '/admin/supplier-orders/{id}/sync': {
      post: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('Sync supplier status and tracking'),
        parameters: [idPath()],
        responses: {
          200: ok('Supplier order after sync', { $ref: '#/components/schemas/SupplierOrder' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound()
        }
      }
    },
    '/admin/supplier-orders/{id}/cancel': {
      post: {
        tags: ['Admin - Supplier orders'],
        summary: roleNote('Cancel a supplier order'),
        parameters: [idPath()],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['reason'],
            properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } }
          })
        },
        responses: {
          200: ok('Supplier order cancelled', { $ref: '#/components/schemas/SupplierOrder' }),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          409: conflict(),
          422: validation()
        }
      }
    },

    '/admin/inventory': {
      get: {
        tags: ['Admin - Inventory'],
        summary: roleNote('List inventory'),
        parameters: [
          ...paginationParams,
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'supplierId', in: 'query', schema: objectId },
          { name: 'lowStock', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'threshold', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1000, default: 5 } }
        ],
        responses: {
          200: ok('Inventory', { type: 'object', properties: { products: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/inventory/transactions': {
      get: {
        tags: ['Admin - Inventory'],
        summary: roleNote('List the stock ledger'),
        parameters: [
          ...paginationParams,
          { name: 'productId', in: 'query', schema: objectId },
          { name: 'sku', in: 'query', schema: { type: 'string' } },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['import', 'sync', 'reservation', 'release', 'commit', 'admin_adjustment', 'return', 'restock'] }
          }
        ],
        responses: {
          200: ok('Transactions', { type: 'object', properties: { transactions: { type: 'array', items: { $ref: '#/components/schemas/InventoryTransaction' } } } }, { meta: true }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/inventory/{productId}/variants/{sku}': {
      patch: {
        tags: ['Admin - Inventory'],
        summary: roleNote('Adjust variant stock'),
        description: 'Provide exactly one of `stock` (set) or `adjustment` (delta). Reserved stock is never reduced.',
        parameters: [idPath('productId', 'Product id'), { name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              stock: { type: 'integer', minimum: 0 },
              adjustment: { type: 'integer' },
              note: { type: 'string', maxLength: 500 }
            }
          })
        },
        responses: {
          200: ok('Stock adjusted', {
            type: 'object',
            properties: {
              productId: objectId,
              sku: { type: 'string' },
              previousStock: { type: 'integer' },
              newStock: { type: 'integer' },
              reserved: { type: 'integer' },
              note: { type: 'string' }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden(),
          404: notFound(),
          422: validation()
        }
      }
    },

    '/admin/uploads/config': {
      get: {
        tags: ['Admin - Uploads'],
        summary: roleNote('Get upload configuration'),
        responses: {
          200: ok('Upload configuration', {
            type: 'object',
            properties: {
              configured: { type: 'boolean' },
              provider: { type: 'string', example: 'cloudinary' },
              maxImageBytes: { type: 'integer', example: 5242880 },
              maxImagesPerRequest: { type: 'integer', example: 5 },
              allowedTypes: { type: 'array', items: { type: 'string' } },
              folder: { type: 'string' }
            }
          }),
          401: unauthorized(),
          403: forbidden()
        }
      }
    },
    '/admin/uploads/image': {
      post: {
        tags: ['Admin - Uploads'],
        summary: roleNote('Upload one image to Cloudinary'),
        requestBody: multipartBody({
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', format: 'binary' },
            folder: { type: 'string', example: 'products' }
          }
        }),
        responses: {
          201: ok('Image uploaded', { type: 'object', properties: { image: { $ref: '#/components/schemas/UploadResult' } } }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden(),
          422: validation(),
          503: errorResponse('Image hosting not configured', 'IMAGE_SERVICE_NOT_CONFIGURED', 'Image hosting is not configured')
        }
      },
      delete: {
        tags: ['Admin - Uploads'],
        summary: roleNote('Delete an uploaded image'),
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['publicId'],
            properties: { publicId: { type: 'string', maxLength: 300 } }
          })
        },
        responses: {
          200: ok('Image deleted', {
            type: 'object',
            properties: {
              publicId: { type: 'string' },
              deleted: { type: 'boolean' },
              providerResult: { type: 'string' }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden(),
          422: validation(),
          503: errorResponse('Image hosting not configured', 'IMAGE_SERVICE_NOT_CONFIGURED', 'Image hosting is not configured')
        }
      }
    },
    '/admin/uploads/images': {
      post: {
        tags: ['Admin - Uploads'],
        summary: roleNote('Upload up to 5 images to Cloudinary'),
        requestBody: multipartBody({
          type: 'object',
          required: ['files'],
          properties: {
            files: { type: 'array', maxItems: 5, items: { type: 'string', format: 'binary' } },
            folder: { type: 'string', example: 'products' }
          }
        }),
        responses: {
          201: ok('Images uploaded', {
            type: 'object',
            properties: {
              images: { type: 'array', items: { $ref: '#/components/schemas/UploadResult' } },
              count: { type: 'integer' }
            }
          }),
          400: badRequest(),
          401: unauthorized(),
          403: forbidden(),
          422: validation(),
          503: errorResponse('Image hosting not configured', 'IMAGE_SERVICE_NOT_CONFIGURED', 'Image hosting is not configured')
        }
      }
    }
  }
};
