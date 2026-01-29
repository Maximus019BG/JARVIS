import { NextResponse } from 'next/server';

// Route handlers under test
import { POST as pushPOST } from '~/app/api/workstation/blueprint/push/route';
import { POST as pullPOST } from '~/app/api/workstation/blueprint/pull/route';
import { GET as syncGET } from '~/app/api/workstation/blueprint/sync/route';
import { POST as resolvePOST } from '~/app/api/workstation/blueprint/resolve/route';

// Mocking
jest.mock('~/server/db', () => ({
  db: {
    query: {
      idempotencyKey: { findFirst: jest.fn() },
      nonce: { findFirst: jest.fn() },
      blueprint: { findFirst: jest.fn(), findMany: jest.fn() }
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
  const h = new Headers({
    Authorization: 'Bearer token',
    'X-Device-Id': 'device-1',
    'X-Timestamp': new Date().toISOString(),
    'X-Nonce': 'nonce-1',
    'X-Signature': 'sig',
    ...overrides
  });
  return h;
}

function makeRequest(opts: {
  method: string;
  url: string;
  headers?: Headers;
  jsonBody?: any;
}) {
  const { method, url, headers = makeHeaders(), jsonBody } = opts;

  // minimal NextRequest-compatible shape used by our handlers
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
  (db.delete as jest.Mock).mockReturnValue({ where: jest.fn() });
  (db.insert as jest.Mock).mockReturnValue({ values: jest.fn() });
});

describe('blueprint sync endpoints', () => {
  test('push: idempotency does not early-return when no replay exists', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue(null);

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/push',
      headers: makeHeaders({ 'X-Idempotency-Key': 'idem-1' }),
      jsonBody: {
        blueprintId: 'bp-1',
        name: 'Test',
        data: { a: 1 },
        version: 1,
        hash: 'hash-1'
      }
    });

    const resp = await pushPOST(req);
    expect(resp.status).toBe(200);
    expect((db.insert as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('push: idempotency replays stored response and skips writes', async () => {
    (db.query.idempotencyKey.findFirst as jest.Mock).mockResolvedValue({
      response: JSON.stringify({ success: true, replayed: true }),
      expiresAt: new Date(Date.now() + 60_000)
    });

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/push',
      headers: makeHeaders({ 'X-Idempotency-Key': 'idem-2' }),
      jsonBody: {
        blueprintId: 'bp-1',
        name: 'Test',
        data: { a: 1 },
        version: 1,
        hash: 'hash-1'
      }
    });

    const resp = await pushPOST(req);
    const body = await jsonOf(resp);

    expect(resp.headers.get('X-Idempotency-Replayed')).toBe('true');
    expect(body).toEqual({ success: true, replayed: true });

    // no insert blueprint/synclog should happen
    expect((db.insert as jest.Mock).mock.calls.length).toBe(0);
  });

  test('push: rejects when existing blueprint belongs to another workstation (IDOR)', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-OTHER',
      version: 1
    });

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/push',
      jsonBody: {
        blueprintId: 'bp-1',
        name: 'Test',
        data: { a: 1 },
        version: 2,
        hash: 'hash-2'
      }
    });

    const resp = await pushPOST(req);
    expect(resp.status).toBe(403);
  });

  test('pull: rejects nonce replay', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      name: 'Test',
      metadata: '{"a":1}',
      version: 1,
      hash: 'hash-1',
      workstationId: 'ws-1',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    (db.query.nonce.findFirst as jest.Mock).mockResolvedValue({
      value: 'nonce-1',
      deviceId: 'device-1',
      expiresAt: new Date(Date.now() + 60_000)
    });

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/pull',
      jsonBody: { blueprintId: 'bp-1', localVersion: 0 }
    });

    const resp = await pullPOST(req);
    expect(resp.status).toBe(403);
  });

  test('sync (GET): requires signature and rejects stale timestamp', async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const req = makeRequest({
      method: 'GET',
      url: 'http://localhost/api/workstation/blueprint/sync?since=2020-01-01T00:00:00.000Z',
      headers: makeHeaders({ 'X-Timestamp': stale })
    });

    const resp = await syncGET(req);
    expect(resp.status).toBe(400);
  });

  test('resolve: rejects when blueprint belongs to another workstation (IDOR)', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-OTHER',
      version: 1,
      metadata: '{"a":1}'
    });

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/resolve',
      jsonBody: {
        blueprintId: 'bp-1',
        resolution: 'local',
        localData: { a: 2 },
        serverData: { a: 1 }
      }
    });

    const resp = await resolvePOST(req);
    expect(resp.status).toBe(403);
  });
});
