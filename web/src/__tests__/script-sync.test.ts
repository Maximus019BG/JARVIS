import { NextResponse } from 'next/server';

import { POST as scriptPushPOST } from '~/app/api/workstation/script/push/route';

jest.mock('~/server/db', () => ({
  db: {
    query: {
      idempotencyKey: { findFirst: jest.fn() },
      nonce: { findFirst: jest.fn() },
      scriptFile: { findFirst: jest.fn() }
    },
    insert: jest.fn(() => ({ values: jest.fn() })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
    delete: jest.fn(() => ({ where: jest.fn() }))
  }
}));

jest.mock('~/lib/device-auth', () => ({
  verifyDeviceToken: jest.fn()
}));

jest.mock('~/lib/hmac-verify', () => ({
  verifyHMACSignature: jest.fn()
}));

import { db } from '~/server/db';
import { verifyDeviceToken } from '~/lib/device-auth';
import { verifyHMACSignature } from '~/lib/hmac-verify';

function makeHeaders(overrides: Record<string, string> = {}) {
  return new Headers({
    Authorization: 'Bearer token',
    'X-Device-Id': 'device-1',
    'X-Timestamp': new Date().toISOString(),
    'X-Nonce': 'nonce-1',
    'X-Signature': 'sig',
    ...overrides
  });
}

function makeRequest(opts: {
  method: string;
  url: string;
  headers?: Headers;
  jsonBody?: any;
}) {
  const { method, url, headers = makeHeaders(), jsonBody } = opts;
  return {
    method,
    url,
    headers,
    json: async () => jsonBody
  } as any;
}

async function jsonOf(resp: NextResponse) {
  return await (resp as any).json();
}

beforeEach(() => {
  process.env.BLUEPRINT_SYNC_HMAC_SECRET = 'hmac';
  process.env.BLUEPRINT_SYNC_JWT_SECRET = 'jwt';

  (verifyDeviceToken as jest.Mock).mockResolvedValue({
    deviceId: 'device-1',
    workstationId: 'ws-1',
    userId: 'user-1'
  });
  (verifyHMACSignature as jest.Mock).mockReturnValue(true);
  (db.query.idempotencyKey.findFirst as jest.Mock).mockResolvedValue(null);
  (db.query.nonce.findFirst as jest.Mock).mockResolvedValue(null);
  (db.query.scriptFile.findFirst as jest.Mock).mockResolvedValue(null);
  (db.delete as jest.Mock).mockReturnValue({ where: jest.fn() });
  (db.insert as jest.Mock).mockReturnValue({ values: jest.fn() });
});

describe('script sync endpoint', () => {
  test('push: stores script securely', async () => {
    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/script/push',
      headers: makeHeaders({ 'X-Idempotency-Key': 'script_hello_hash1' }),
      jsonBody: {
        scriptId: 'script_hello',
        name: 'hello',
        language: 'python',
        source: "print('hi')",
        hash: 'hash1'
      }
    });

    const resp = await scriptPushPOST(req);
    const body = await jsonOf(resp);

    expect(resp.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.scriptId).toBe('script_hello');
  });

  test('push: rejects invalid signature', async () => {
    (verifyHMACSignature as jest.Mock).mockReturnValue(false);

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/script/push',
      jsonBody: {
        scriptId: 'script_hello',
        name: 'hello',
        source: "print('hi')",
        hash: 'hash1'
      }
    });

    const resp = await scriptPushPOST(req);
    expect(resp.status).toBe(401);
  });
});
