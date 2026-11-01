import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, API, authHeader, createAdmin, createUser, createMockSupplier, unique } from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { Supplier } from '../src/models/Supplier.js';
import { Product } from '../src/models/Product.js';

const supplierPayload = (overrides = {}) => ({
  name: 'Demo Supplier',
  code: unique('demo').toLowerCase(),
  adapterType: 'mock',
  credentials: { apiKey: 'super-secret-key-123' },
  ...overrides
});

describe('supplier framework, catalogue and inventory sync', () => {
  let admin;

  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);
  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
  });

  it('creates a supplier, encrypts credentials and never returns them', async () => {
    const payload = supplierPayload();
    const response = await request(app)
      .post(`${API}/admin/suppliers`)
      .set(authHeader(admin))
      .send(payload)
      .expect(201);

    const { supplier } = response.body.data;
    expect(supplier.code).toBe(payload.code);
    expect(supplier.isMock).toBe(true);
    expect(supplier.credentials).toBeUndefined();
    expect(supplier.credentialsMeta.configured).toBe(true);
    expect(supplier.credentialsMeta.keys).toEqual(['apiKey']);
    expect(JSON.stringify(response.body)).not.toContain('super-secret-key-123');

    const stored = await Supplier.findById(supplier._id).select('+credentials');
    expect(stored.credentials.ciphertext).toBeTruthy();
    expect(stored.credentials.ciphertext).not.toContain('super-secret-key-123');

    const detail = await request(app)
      .get(`${API}/admin/suppliers/${supplier._id}`)
      .set(authHeader(admin))
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain('super-secret-key-123');
  });

  it('requires authentication and admin role for supplier management', async () => {
    const customer = await createUser();
    await request(app).post(`${API}/admin/suppliers`).send(supplierPayload()).expect(401);
    await request(app)
      .post(`${API}/admin/suppliers`)
      .set(authHeader(customer))
      .send(supplierPayload())
      .expect(403);
  });

  it('tests the mock connection without pretending a live supplier was contacted', async () => {
    const created = await request(app)
      .post(`${API}/admin/suppliers`)
      .set(authHeader(admin))
      .send(supplierPayload())
      .expect(201);
    const supplierId = created.body.data.supplier._id;

    const response = await request(app)
      .post(`${API}/admin/suppliers/${supplierId}/test-connection`)
      .set(authHeader(admin))
      .expect(200);

    expect(response.body.data.connection.ok).toBe(true);
    expect(response.body.data.connection.mode).toBe('mock');
    expect(response.body.data.connection.isMock).toBe(true);
    expect(response.body.data.connection.message).toMatch(/no external supplier api/i);
  });

  it('imports a mock catalogue idempotently with marked-up prices', async () => {
    const created = await request(app)
      .post(`${API}/admin/suppliers`)
      .set(authHeader(admin))
      .send(supplierPayload())
      .expect(201);
    const supplierId = created.body.data.supplier._id;

    const first = await request(app)
      .post(`${API}/admin/suppliers/${supplierId}/sync/catalogue`)
      .set(authHeader(admin))
      .send({ maxPages: 2 })
      .expect(200);

    expect(first.body.data.mock).toBe(true);
    expect(first.body.data.stats.created).toBe(12);
    expect(first.body.data.stats.failed).toBe(0);
    expect(await Product.countDocuments({ supplier: supplierId })).toBe(12);

    const product = await Product.findOne({ supplier: supplierId, supplierProductId: 'MOCK-1001' });
    expect(product.sellingPrice).toBeGreaterThan(product.supplierCost);
    expect(product.status).toBe('draft');

    const second = await request(app)
      .post(`${API}/admin/suppliers/${supplierId}/sync/catalogue`)
      .set(authHeader(admin))
      .send({ maxPages: 1 })
      .expect(200);

    expect(second.body.data.stats.created).toBe(0);
    expect(second.body.data.stats.updated).toBeGreaterThan(0);
    expect(await Product.countDocuments({ supplier: supplierId })).toBe(12);

    const logs = await request(app)
      .get(`${API}/admin/suppliers/${supplierId}/logs?type=catalogue`)
      .set(authHeader(admin))
      .expect(200);
    expect(logs.body.data.logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.body.data.logs[0].status).toBe('success');
  });

  it('syncs inventory and records a stock ledger entry', async () => {
    const supplier = await createMockSupplier();
    const { syncCatalogue } = await import('../src/modules/suppliers/catalogueSync.service.js');
    await syncCatalogue(supplier._id, { triggeredBy: 'manual' });

    const product = await Product.findOne({ supplier: supplier._id, supplierProductId: 'MOCK-1002' });
    product.variants[0].stock = 1;
    product.stock = 1;
    await product.save();

    const response = await request(app)
      .post(`${API}/admin/suppliers/${supplier._id}/sync/inventory`)
      .set(authHeader(admin))
      .send({})
      .expect(200);

    expect(response.body.data.mock).toBe(true);
    expect(response.body.data.stats.updated).toBeGreaterThan(0);

    const refreshed = await Product.findById(product._id);
    expect(refreshed.variants[0].stock).toBe(30);
    expect(refreshed.lastSyncedAt).toBeTruthy();

    const { InventoryTransaction } = await import('../src/models/InventoryTransaction.js');
    expect(await InventoryTransaction.countDocuments({ product: product._id, type: 'sync' })).toBeGreaterThan(0);
  });

  it('marks products stale when inventory has not been refreshed', async () => {
    const supplier = await createMockSupplier();
    const { syncCatalogue } = await import('../src/modules/suppliers/catalogueSync.service.js');
    await syncCatalogue(supplier._id, { triggeredBy: 'manual' });
    await Product.updateMany(
      { supplier: supplier._id },
      { $set: { lastSyncedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } }
    );

    const response = await request(app)
      .post(`${API}/admin/suppliers/${supplier._id}/sync/stale-scan`)
      .set(authHeader(admin))
      .send({ hours: 24 })
      .expect(200);

    expect(response.body.data.staleProducts).toBe(12);
  });

  it('rejects unsafe supplier URLs and unsupported adapter types', async () => {
    const unsafe = await request(app)
      .post(`${API}/admin/suppliers`)
      .set(authHeader(admin))
      .send({
        name: 'Unsafe Supplier',
        code: unique('unsafe'),
        adapterType: 'generic_rest',
        baseUrl: 'http://localhost:9000/api'
      })
      .expect(400);
    expect(unsafe.body.error.code).toBe('SUPPLIER_ERROR');

    const unknownHost = await request(app)
      .post(`${API}/admin/suppliers`)
      .set(authHeader(admin))
      .send({
        name: 'Unknown Host Supplier',
        code: unique('unknown'),
        adapterType: 'generic_rest',
        baseUrl: 'https://evil.example.com/v1'
      })
      .expect(400);
    expect(unknownHost.body.error.message).toMatch(/not allowed|allowlist|host/i);
  });
});
