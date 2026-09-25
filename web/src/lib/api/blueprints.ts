import axios from "axios";

export interface Blueprint {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  metadata?: string;
  workstationId: string;
  // Additional fields for UI
  author?: {
    name: string;
    email: string;
  };
  description?: string;
  tags?: string[];
  isActive?: boolean;
  lastModified?: string;
  version?: string;
  syncStatus?: string | null;
}

export interface BlueprintFilters {
  search?: string;
  syncStatus?: "synced" | "pending";
  modifiedWithinDays?: 7 | 30;
  sortBy?: "name" | "createdAt" | "lastModified";
  sortOrder?: "asc" | "desc";
}

export const hasActiveBlueprintFilters = (f: BlueprintFilters) =>
  Boolean(f.search || f.syncStatus || f.modifiedWithinDays);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Search, filter and sort a workstation's blueprints in memory. The list route returns every
 * row in one query; doing this client-side avoids a ~230ms round trip per keystroke.
 */
export function applyBlueprintFilters(
  blueprints: Blueprint[],
  filters: BlueprintFilters,
  now = Date.now(),
): Blueprint[] {
  const q = filters.search?.trim().toLowerCase();
  const cutoff = filters.modifiedWithinDays
    ? now - filters.modifiedWithinDays * DAY_MS
    : undefined;
  const modified = (b: Blueprint) => Date.parse(b.lastModified ?? b.createdAt);

  const rows = blueprints.filter(
    (b) =>
      (!q ||
        b.name.toLowerCase().includes(q) ||
        Boolean(b.description?.toLowerCase().includes(q))) &&
      (!filters.syncStatus || (b.syncStatus ?? "synced") === filters.syncStatus) &&
      (cutoff === undefined || modified(b) >= cutoff),
  );

  const sortBy = filters.sortBy ?? "createdAt";
  const dir = filters.sortOrder === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const diff =
      sortBy === "name"
        ? a.name.localeCompare(b.name)
        : sortBy === "lastModified"
          ? modified(a) - modified(b)
          : Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return diff * dir;
  });
}

const api = axios.create({
  baseURL: "/api",
  timeout: 10000,
});

// Add request interceptor for auth
api.interceptors.request.use((config) => {
  // Add auth token if available
  const token = localStorage.getItem("authToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const blueprintsApi = {
  // Every blueprint in a workstation; the page searches/sorts/pages them with applyBlueprintFilters.
  listBlueprints: async (workstationId: string): Promise<Blueprint[]> => {
    const response = await api.get<Blueprint[]>(
      `/workstation/blueprint/list/${workstationId}`,
    );
    return response.data;
  },

  // Create a new blueprint. Returns the id to route the user straight into the editor.
  createBlueprint: async (input: {
    workstationId: string;
    name: string;
    units: "mm" | "cm" | "in" | "px";
    viewBox: [number, number, number, number];
  }): Promise<{ id: string; name: string; createdBy: string }> => {
    const response = await api.post("/blueprint/create", input);
    return response.data;
  },

  // Delete a blueprint. Versions and sync logs go with it by cascade.
  deleteBlueprint: async (id: string): Promise<void> => {
    await api.delete(`/blueprint/${id}`);
  },

  // Clone a blueprint. The copy starts its own history at v1.
  cloneBlueprint: async (id: string, name?: string): Promise<{ id: string; name: string }> => {
    const response = await api.post(`/blueprint/${id}/clone`, name ? { name } : {});
    return response.data;
  },

  // Get blueprint statistics
  getBlueprintStats: async (): Promise<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  }> => {
    const response = await api.get("/workstation/blueprint/stats");
    return response.data;
  },

  // Get recent blueprints across all workstations
  getRecentBlueprints: async (
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      name: string;
      workstationId: string;
      workstationName: string;
      createdBy: string;
      createdAt: string;
      updatedAt: string | null;
    }>
  > => {
    const response = await api.get(
      `/workstation/blueprint/recent?limit=${limit}`,
    );
    return response.data;
  },
};
