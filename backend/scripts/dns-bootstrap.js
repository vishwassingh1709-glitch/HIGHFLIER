import dns from 'node:dns';
import 'dotenv/config';
import { configureDns, preflightMongoSrv } from './dns-config.js';

const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';
const hasDnsOverride = configureDns();

if (isDevelopment) {
  if (hasDnsOverride) {
    console.info(`[HIGHFLIER] Development DNS override active (${dns.getServers().length} resolver(s)).`);
  } else {
    console.warn(
      '[HIGHFLIER] DNS_SERVERS is empty; using system DNS. For Atlas SRV failures, set DNS_SERVERS=8.8.8.8,8.8.4.4 in backend/.env.'
    );
  }

  try {
    const result = await preflightMongoSrv(process.env.MONGODB_URI);
    if (result.skipped) {
      console.info('[HIGHFLIER] MongoDB SRV DNS preflight skipped (connection is not mongodb+srv).');
    } else {
      console.info(`[HIGHFLIER] MongoDB SRV DNS preflight passed (${result.recordCount} record(s)).`);
    }
  } catch (error) {
    console.error(
      `[HIGHFLIER] ${error.message} DNS error code: ${error.code}. Check DNS_SERVERS and network access.`
    );
    throw new Error('Backend startup stopped because MongoDB SRV DNS preflight failed.');
  }
}
