import { NextResponse } from 'next/server';

import { GET as versionsGET } from '~/app/api/workstation/blueprint/versions/route';
import { POST as restorePOST } from '~/app/api/workstation/blueprint/restore/route';

// ── mocks ──────────────────────────────────────────────────────────────────

jest.mock('~/server/db', () => ({
  db: {
    query: {
      nonce: { findFirst: jest.fn() },
      blueprint: { findFirst: jest.fn() },
      blueprintVersion: { findFirst: jest.fn(), findMany: jest.fn() }
    },
    insert: jest.fn(() => ({ values: jest.fn() })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
    delete: jest.fn(() => ({ where: jest.fn() }))
  }
}));

jest.mock('~/lib/device-auth', () => ({
  verifyDeviceById: jest.fn()
}));

jest.mock('~/lib/hmac-verify', () => ({
  verifyHMACSignature: jest.fn()
}));

jest.mock('~/lib/syncLogger', () => ({
  syncLogger: { info: jest.fn(), error: jest.fn() }
}));

import { db } from '~/server/db';
import { verifyDeviceById } from '~/lib/device-auth';
import { verifyHMACSignature } from '~/lib/hmac-verify';

// ── helpers ────────────────────────────────────────────────────────────────

function makeHeaders(overrides: Record<string, string> = {}) {
  return new Headers({
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
  jsonBody?: unknown;
}) {
  const { method, url, headers = makeHeaders(), jsonBody } = opts;
  return { method, url, headers, json: async () => jsonBody } as any;
}

async function jsonOf(resp: NextResponse) {
  return await (resp as any).json();
}

// ── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.BLUEPRINT_SYNC_HMAC_SECRET = 'hmac';
  process.env.BLUEPRINT_SYNC_JWT_SECRET = 'jwt';

  (verifyDeviceById as jest.Mock).mockResolvedValue({
    deviceId: 'device-1',
    workstationId: 'ws-1',
    userId: 'user-1'
  });
  (verifyHMACSignature as jest.Mock).mockReturnValue(true);

  (db.query.nonce.findFirst as jest.Mock).mockResolvedValue(null);
  (db.delete as jest.Mock).mockReturnValue({ where: jest.fn() });
  (db.insert as jest.Mock).mockReturnValue({ values: jest.fn() });
  (db.update as jest.Mock).mockReturnValue({
    set: jest.fn(() => ({ where: jest.fn() }))
  });
});

// ── versions endpoint ──────────────────────────────────────────────────────

describe('GET /api/workstation/blueprint/versions', () => {
  test('returns 400 when blueprintId is missing', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-1',
      version: 3
    });

    const req = makeRequest({
      method: 'GET',
      url: 'http://localhost/api/workstation/blueprint/versions'
    });

    const resp = await versionsGET(req);
    expect(resp.status).toBe(400);
  });

  test('returns 404 when blueprint does not exist', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue(null);
    (db.query.blueprintVersion.findMany as jest.Mock).mockResolvedValue([]);

    const req = makeRequest({
      method: 'GET',
      url: 'http://localhost/api/workstation/blueprint/versions?blueprintId=bp-missing'
    });

    const resp = await versionsGET(req);
    expect(resp.status).toBe(404);
  });

  test('returns 403 when blueprint belongs to another workstation', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-OTHER',
      version: 2
    });

    const req = makeRequest({
      method: 'GET',
      url: 'http://localhost/api/workstation/blueprint/versions?blueprintId=bp-1'
    });

    const resp = await versionsGET(req);
    expect(resp.status).toBe(403);
  });

  test('returns version list for owned blueprint', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-1',
      version: 3
    });
    (db.query.blueprintVersion.findMany as jest.Mock).mockResolvedValue([
      { id: 'v1', version: 1, hash: 'h1', deviceId: 'device-1', createdAt: new Date() },
      { id: 'v2', version: 2, hash: 'h2', deviceId: 'device-1', createdAt: new Date() }
    ]);

    const req = makeRequest({
      method: 'GET',
      url: 'http://localhost/api/workstation/blueprint/versions?blueprintId=bp-1'
    });

    const resp = await versionsGET(req);
    expect(resp.status).toBe(200);

    const body = await jsonOf(resp);
    expect(body.success).toBe(true);
    expect(body.currentVersion).toBe(3);
    expect(body.versions).toHaveLength(2);
  });
});

// ── restore endpoint ───────────────────────────────────────────────────────

describe('POST /api/workstation/blueprint/restore', () => {
  test('returns 400 when required fields are missing', async () => {
    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/restore',
      jsonBody: { blueprintId: 'bp-1' } // missing targetVersion
    });

    const resp = await restorePOST(req);
    expect(resp.status).toBe(400);
  });

  test('returns 404 when blueprint does not exist', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue(null);

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/restore',
      jsonBody: { blueprintId: 'bp-missing', targetVersion: 1 }
    });

    const resp = await restorePOST(req);
    expect(resp.status).toBe(404);
  });

  test('returns 403 when blueprint belongs to another workstation', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-OTHER',
      version: 3,
      metadata: '{}',
      hash: null,
      deviceId: null
    });

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/restore',
      jsonBody: { blueprintId: 'bp-1', targetVersion: 1 }
    });

    const resp = await restorePOST(req);
    expect(resp.status).toBe(403);
  });

  test('returns 404 when target snapshot version does not exist', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-1',
      version: 3,
      metadata: '{"a":1}',
      hash: 'h3',
      deviceId: 'device-1'
    });
    (db.query.blueprintVersion.findFirst as jest.Mock).mockResolvedValue(null);

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/restore',
      jsonBody: { blueprintId: 'bp-1', targetVersion: 99 }
    });

    const resp = await restorePOST(req);
    expect(resp.status).toBe(404);
    const body = await jsonOf(resp);
    expect(body.error).toBe('Version not found');
  });

  test('restores blueprint to a historical version and returns new version', async () => {
    (db.query.blueprint.findFirst as jest.Mock).mockResolvedValue({
      id: 'bp-1',
      workstationId: 'ws-1',
      version: 3,
      metadata: '{"a":3}',
      hash: 'h3',
      deviceId: 'device-1'
    });
    (db.query.blueprintVersion.findFirst as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      blueprintId: 'bp-1',
      version: 1,
      metadata: '{"a":1}',
      hash: 'h1',
      deviceId: 'device-1',
      createdAt: new Date()
    });

    const req = makeRequest({
      method: 'POST',
      url: 'http://localhost/api/workstation/blueprint/restore',
      jsonBody: { blueprintId: 'bp-1', targetVersion: 1 }
    });

    const resp = await restorePOST(req);
    expect(resp.status).toBe(200);

    const body = await jsonOf(resp);
    expect(body.success).toBe(true);
    expect(body.restoredFromVersion).toBe(1);
    // new version = old version (3) + 1 = 4
    expect(body.version).toBe(4);
    expect(body.data).toEqual({ a: 1 });

    // One insert for the pre-restore snapshot + one for the sync_log
    expect((db.insert as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
