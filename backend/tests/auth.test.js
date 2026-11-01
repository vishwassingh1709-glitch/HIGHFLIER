import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, API, authHeader, createAdmin, createUser, TEST_PASSWORD, unique } from './helpers/fixtures.js';
import { setupTestDatabase, resetDatabase, teardownTestDatabase } from './helpers/db.js';
import { getMailOutbox } from '../src/modules/auth/mailer.service.js';
import { User } from '../src/models/User.js';

const registerPayload = (overrides = {}) => ({
  name: 'Asha Verma',
  email: `${unique('asha')}@example.com`,
  password: TEST_PASSWORD,
  ...overrides
});

describe('authentication and authorization', () => {
  beforeAll(setupTestDatabase);
  afterAll(teardownTestDatabase);
  beforeEach(resetDatabase);

  it('registers a customer with hashed password and never self-assigns admin', async () => {
    const payload = registerPayload({ role: 'admin' });
    const response = await request(app).post(`${API}/auth/register`).send(payload).expect(201);

    expect(response.body.data.user.email).toBe(payload.email);
    expect(response.body.data.user.role).toBe('customer');
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(response.body.data.tokens.accessToken).toBeTruthy();
    expect(response.body.data.tokens.refreshToken).toBeTruthy();

    const stored = await User.findOne({ email: payload.email }).select('+passwordHash');
    expect(stored.passwordHash).toBeTruthy();
    expect(stored.passwordHash).not.toBe(TEST_PASSWORD);
  });

  it('rejects duplicate registration and invalid logins', async () => {
    const payload = registerPayload();
    await request(app).post(`${API}/auth/register`).send(payload).expect(201);
    const duplicate = await request(app).post(`${API}/auth/register`).send(payload).expect(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_RESOURCE');

    const wrongPassword = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: payload.email, password: 'WrongPassword1' })
      .expect(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknownEmail = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD })
      .expect(401);
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the current profile and enforces active accounts', async () => {
    const user = await createUser();
    const me = await request(app).get(`${API}/auth/me`).set(authHeader(user)).expect(200);
    expect(me.body.data.user.email).toBe(user.email);
    expect(me.body.data.user.passwordHash).toBeUndefined();

    user.isActive = false;
    await user.save();
    const blocked = await request(app).get(`${API}/auth/me`).set(authHeader(user)).expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const payload = registerPayload();
    const registration = await request(app).post(`${API}/auth/register`).send(payload).expect(201);
    const firstRefresh = registration.body.data.tokens.refreshToken;

    const rotated = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: firstRefresh })
      .expect(200);
    expect(rotated.body.data.refreshToken).toBeTruthy();
    expect(rotated.body.data.refreshToken).not.toBe(firstRefresh);

    const reuse = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: firstRefresh })
      .expect(401);
    expect(reuse.body.error.message).toMatch(/reuse/i);

    const afterReuse = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: rotated.body.data.refreshToken })
      .expect(401);
    expect(afterReuse.body.error.code).toBe('UNAUTHORIZED');
  });

  it('supports password reset through the email outbox and revokes sessions', async () => {
    const user = await createUser({ email: `${unique('reset')}@example.com` });
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    const forgot = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: user.email })
      .expect(200);
    expect(forgot.body.data.message).toMatch(/if an account exists/i);

    const resetMail = getMailOutbox().find((mail) => mail.context?.type === 'password_reset');
    expect(resetMail?.context?.token).toBeTruthy();

    const newPassword = 'NewPassword456';
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: resetMail.context.token, password: newPassword })
      .expect(200);

    await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`)
      .expect(401);

    await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: newPassword })
      .expect(200);

    const unknown = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'missing@example.com' })
      .expect(200);
    expect(unknown.body.data.message).toMatch(/if an account exists/i);
  });

  it('changes passwords and logs out all sessions', async () => {
    const user = await createUser();
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.data.tokens.accessToken}` };

    await request(app)
      .patch(`${API}/users/me/password`)
      .set(auth)
      .send({ currentPassword: 'WrongPassword1', newPassword: 'AnotherPass123' })
      .expect(400);

    await request(app)
      .patch(`${API}/users/me/password`)
      .set(auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'AnotherPass123' })
      .expect(200);

    await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: login.body.data.tokens.refreshToken })
      .expect(401);
  });

  it('enforces admin-only routes', async () => {
    const customer = await createUser();
    await request(app).get(`${API}/admin/dashboard`).set(authHeader(customer)).expect(403);

    const admin = await createAdmin();
    const dashboard = await request(app).get(`${API}/admin/dashboard`).set(authHeader(admin)).expect(200);
    expect(dashboard.body.data.users.total).toBeGreaterThanOrEqual(2);
  });
});
