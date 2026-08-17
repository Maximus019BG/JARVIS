import type { BlueprintDoc } from "@blueprint/schema.ts";
import axios from "axios";

export type VersionRow = {
  id: string;
  version: number;
  commitSha: string | null;
  parentSha: string | null;
  message: string | null;
  createdAt: string;
  device: { id: string; name: string; platform: string | null } | null;
  author: { id: string; name: string; image: string | null } | null;
};

export type DiffChange = {
  kind: "added" | "removed" | "modified";
  id: string;
  type: string;
  layer?: string;
};

export type DiffResponse = {
  summary: string;
  counts: { added: number; removed: number; modified: number; unchanged: number };
  a: { version: number; commitSha: string | null; doc: BlueprintDoc };
  b: { version: number; commitSha: string | null; doc: BlueprintDoc };
  changes: DiffChange[];
  viewBox: { before: BlueprintDoc["viewBox"]; after: BlueprintDoc["viewBox"] } | null;
};

/** `ref` is a commit sha or `v<number>`; the endpoints accept either. */
export const blueprintVersionsApi = {
  async list(blueprintId: string) {
    const { data } = await axios.get<{
      blueprint: { id: string; name: string; version: number };
      versions: VersionRow[];
    }>(`/api/blueprint/${blueprintId}/versions`);
    return data;
  },

  async at(blueprintId: string, ref: string) {
    const { data } = await axios.get<{
      version: number;
      commitSha: string | null;
      message: string | null;
      createdAt: string;
      doc: BlueprintDoc;
    }>(`/api/blueprint/${blueprintId}/at/${encodeURIComponent(ref)}`);
    return data;
  },

  async diff(blueprintId: string, a: string, b: string) {
    const { data } = await axios.get<DiffResponse>(`/api/blueprint/${blueprintId}/diff`, { params: { a, b } });
    return data;
  },

  async restore(blueprintId: string, ref: string) {
    const { data } = await axios.post<{ version: number; restoredFrom: number }>(
      `/api/blueprint/${blueprintId}/restore`,
      { ref },
    );
    return data;
  },
};

export type DeviceRow = {
  id: string;
  name: string;
  platform: string | null;
  fingerprint: string | null;
  tokenPrefix: string | null;
  status: string;
  paired: boolean;
  lastSeenAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  /** MCP scopes, `<area>:<read|write>`. Empty means this token cannot use the MCP server. */
  scopes: string[];
  access:
    | { scope: "all"; mode: string }
    | { scope: "some"; mode: string; blueprintIds: string[] };
};

export const devicesApi = {
  async list(workstationId: string) {
    const { data } = await axios.get<{ devices: DeviceRow[] }>("/api/device/list", { params: { workstationId } });
    return data.devices;
  },

  async lookup(code: string) {
    const { data } = await axios.get<{
      request: { name: string; fingerprint: string; platform: string | null; expiresAt: string };
    }>("/api/device/approve", { params: { code } });
    return data.request;
  },

  async approve(input: {
    userCode: string;
    workstationId: string;
    name?: string;
    blueprintIds?: string[];
    allBlueprints?: boolean;
    mode?: "read" | "write";
  }) {
    const { data } = await axios.post<{ device: { id: string; name: string; grants: number } }>(
      "/api/device/approve",
      input,
    );
    return data.device;
  },

  async setGrants(
    deviceId: string,
    input: { blueprintIds?: string[]; allBlueprints?: boolean; mode?: "read" | "write" },
  ) {
    const { data } = await axios.patch<{ grants: number }>(`/api/device/${deviceId}/grants`, input);
    return data;
  },

  async setScopes(deviceId: string, scopes: string[]) {
    const { data } = await axios.patch<{ scopes: string[] }>(`/api/device/${deviceId}/scopes`, { scopes });
    return data;
  },

  /**
   * Mints an MCP token. The `token` in the reply is the only readable copy that will ever
   * exist — the server stores a hash — so the caller has to show it before navigating away.
   */
  async createMcpToken(input: {
    workstationId: string;
    name: string;
    scopes: string[];
    blueprintIds?: string[];
    allBlueprints?: boolean;
    mode?: "read" | "write";
  }) {
    const { data } = await axios.post<{
      token: string;
      device: { id: string; name: string; scopes: string[] };
    }>("/api/device/mcp-token", input);
    return data;
  },

  async revoke(deviceId: string) {
    await axios.post(`/api/device/${deviceId}/revoke`);
  },
};
