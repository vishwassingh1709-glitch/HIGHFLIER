import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { isIP } from 'node:net';

export const parseDnsServers = (value) => {
  if (value === undefined || value.trim() === '') return [];

  const servers = value.split(',').map((server) => server.trim());
  if (servers.some((server) => !server || isIP(server) === 0)) {
    throw new Error('DNS_SERVERS must be a comma-separated list of valid IP addresses.');
  }

  return servers;
};

export const configureDns = ({
  nodeEnv = process.env.NODE_ENV || 'development',
  dnsServers = process.env.DNS_SERVERS,
  setServers = dns.setServers
} = {}) => {
  if (nodeEnv !== 'development') return false;

  const servers = parseDnsServers(dnsServers);
  if (servers.length === 0) return false;

  setServers(servers);
  return true;
};

export const preflightMongoSrv = async (uri, resolveSrv = dnsPromises.resolveSrv) => {
  let connection;
  try {
    connection = new URL(uri);
  } catch {
    return { skipped: true };
  }

  if (connection.protocol !== 'mongodb+srv:') return { skipped: true };

  try {
    const records = await resolveSrv(`_mongodb._tcp.${connection.hostname}`);
    if (records.length === 0) {
      const error = new Error('MongoDB SRV lookup returned no records.');
      error.code = 'ENODATA';
      throw error;
    }
    return { skipped: false, recordCount: records.length };
  } catch (error) {
    const diagnostic = new Error('MongoDB SRV DNS preflight failed.');
    diagnostic.code = error?.code || 'UNKNOWN';
    throw diagnostic;
  }
};
