import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const safeCompare = (a, b) => {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
};

export const encryptJson = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', env.encryptionKey, iv);
  const plaintext = JSON.stringify(value ?? {});
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 1
  };
};

export const decryptJson = (payload) => {
  if (!payload?.ciphertext || !payload?.iv || !payload?.authTag) {
    throw new Error('Encrypted payload is malformed');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    env.encryptionKey,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString('utf8'));
};

export const maskSecret = (value) => {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
};

export const hmacSha256Hex = (data, secret) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');

export const hmacSha256Base64 = (data, secret) =>
  crypto.createHmac('sha256', secret).update(data).digest('base64');
