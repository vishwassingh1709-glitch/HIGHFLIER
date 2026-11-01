import net from 'node:net';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';

const PRIVATE_IPV4_PARTS = [
  [10, 8],
  [127, 8],
  [169, 254, 16],
  [172, 16, 12],
  [192, 168, 16],
  [0, 8],
  [100, 64, 10],
  [198, 18, 15],
  [198, 19, 15],
  [224, 4]
];

/** Conservative IPv4 / IPv6 private, loopback and link-local detection. */
export const isPrivateIp = (address) => {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    if (octets.some((part) => Number.isNaN(part))) return true;
    if (octets[0] === 127 || octets[0] === 10) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
    if (octets[0] === 0) return true;
    if (octets[0] >= 224) return true;
    if (PRIVATE_IPV4_PARTS.some(([first, second, size]) => size && octets[0] === first && octets[1] === second)) {
      return true;
    }
    return false;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.replace('::ffff:', ''));
    return false;
  }
  return true;
};

const hostMatchesAllowlist = (hostname, allowedHosts) =>
  allowedHosts.some((allowed) => {
    const normalized = String(allowed).toLowerCase().trim();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });

/**
 * Validates a supplier base URL to mitigate SSRF. HTTPS is mandatory, embedded
 * credentials are rejected and the host must be explicitly allowlisted either
 * via SUPPLIER_ALLOWED_HOSTS or the supplier record's approved hosts.
 */
export const assertSafeSupplierUrl = (rawUrl, allowedHosts = []) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_ERROR, 'Supplier base URL is invalid');
  }

  if (parsed.protocol !== 'https:') {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_ERROR, 'Supplier base URL must use HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_ERROR, 'Supplier base URL must not contain credentials');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_ERROR, 'Supplier base URL resolves to a private address');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_ERROR, 'Supplier base URL host is not allowed');
  }

  const effectiveAllowlist = [...env.supplierAllowedHosts, ...allowedHosts.map((host) => String(host).toLowerCase().trim())].filter(
    Boolean
  );

  if (effectiveAllowlist.length === 0) {
    throw new ApiError(
      400,
      ERROR_CODES.SUPPLIER_ERROR,
      'No approved supplier hosts configured. Set SUPPLIER_ALLOWED_HOSTS or supplier allowedHosts.'
    );
  }
  if (!hostMatchesAllowlist(hostname, effectiveAllowlist)) {
    throw new ApiError(400, ERROR_CODES.SUPPLIER_ERROR, `Supplier host "${hostname}" is not in the approved allowlist`);
  }

  return parsed;
};

export const normalizeAllowedHosts = (hosts = []) =>
  hosts
    .map((host) => String(host).trim().toLowerCase())
    .filter((host) => host && !/[^a-z0-9.-]/.test(host));
