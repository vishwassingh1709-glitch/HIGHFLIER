import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { configureDns, parseDnsServers, preflightMongoSrv } from '../scripts/dns-config.js';
import { getMongoConnectionDiagnostic } from '../src/config/db.js';

const backendDirectory = fileURLToPath(new URL('../', import.meta.url));

describe('development DNS configuration', () => {
  it('parses optional comma-separated resolver IP addresses', () => {
    expect(parseDnsServers(' 8.8.8.8, 8.8.4.4 ')).toEqual(['8.8.8.8', '8.8.4.4']);
    expect(parseDnsServers('')).toEqual([]);
    expect(() => parseDnsServers('8.8.8.8,not-an-ip')).toThrow(
      'DNS_SERVERS must be a comma-separated list of valid IP addresses.'
    );
  });

  it('configures resolvers only in development when explicitly provided', () => {
    const setServers = vi.fn();

    expect(
      configureDns({ nodeEnv: 'development', dnsServers: '8.8.8.8,8.8.4.4', setServers })
    ).toBe(true);
    expect(setServers).toHaveBeenCalledWith(['8.8.8.8', '8.8.4.4']);

    setServers.mockClear();
    expect(configureDns({ nodeEnv: 'development', dnsServers: '', setServers })).toBe(false);
    expect(configureDns({ nodeEnv: 'production', dnsServers: 'not-an-ip', setServers })).toBe(false);
    expect(setServers).not.toHaveBeenCalled();
  });

  it('preflights the MongoDB SRV record without exposing the connection string', async () => {
    const resolveSrv = vi.fn().mockResolvedValue([{ name: 'shard.example.mongodb.net', port: 27017 }]);
    const uri = 'mongodb+srv://username:secret@cluster.example.mongodb.net/highflier';

    await expect(preflightMongoSrv(uri, resolveSrv)).resolves.toEqual({ skipped: false, recordCount: 1 });
    expect(resolveSrv).toHaveBeenCalledWith('_mongodb._tcp.cluster.example.mongodb.net');

    const failure = Object.assign(new Error('resolver detail'), { code: 'ECONNREFUSED' });
    await expect(preflightMongoSrv(uri, vi.fn().mockRejectedValue(failure))).rejects.toMatchObject({
      message: 'MongoDB SRV DNS preflight failed.',
      code: 'ECONNREFUSED'
    });
    await expect(preflightMongoSrv('mongodb://localhost/test')).resolves.toEqual({ skipped: true });
  });

  it('distinguishes Atlas TLS failures with a sanitized startup diagnostic', () => {
    const error = {
      name: 'MongooseServerSelectionError',
      reason: {
        servers: new Map([
          ['atlas-host:27017', { error: { message: 'tlsv1 alert internal error' } }]
        ])
      }
    };

    expect(getMongoConnectionDiagnostic(error)).toContain('TLS handshake failed');
    expect(getMongoConnectionDiagnostic(error)).toContain('public egress IP');
    expect(getMongoConnectionDiagnostic(error)).not.toContain('mongodb+srv://');
  });

  it('preloads DNS before Mongoose is imported by the application', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    for (const scriptName of ['start', 'dev', 'seed:admin', 'seed:demo']) {
      expect(packageJson.scripts[scriptName]).toMatch(/^node --import \.\/scripts\/dns-bootstrap\.js /);
    }

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        './scripts/dns-bootstrap.js',
        '--input-type=module',
        '-e',
        "import dns from 'node:dns'; import mongoose from 'mongoose'; if (dns.getServers()[0] !== '203.0.113.53' || !mongoose.version) process.exit(1);"
      ],
      {
        cwd: backendDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DNS_SERVERS: '203.0.113.53',
          MONGODB_URI: 'mongodb://127.0.0.1:27017/preload-order-test'
        }
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Development DNS override active (1 resolver(s)).');
    expect(result.stdout).toContain('MongoDB SRV DNS preflight skipped (connection is not mongodb+srv).');
  });
});
