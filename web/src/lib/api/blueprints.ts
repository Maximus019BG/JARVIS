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
}

export interface BlueprintFilters {
  search?: string;
  workstationId?: string;
  tags?: string[];
  author?: string;
  sortBy?: "name" | "createdAt" | "lastModified";
  sortOrder?: "asc" | "desc";
}

export interface BlueprintsResponse {
  blueprints: Blueprint[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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
  // Get all blueprints with pagination and filters
  getBlueprints: async (
    workstationId: string,
    page = 1,
    limit = 12,
    filters: BlueprintFilters = {},
    recentOnly = false,
  ): Promise<BlueprintsResponse> => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    if (recentOnly) params.append("recentOnly", "true");

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v));
        } else {
          params.append(key, value.toString());
        }
      }
    });

    const response = await api.get(
      `/workstation/blueprint/list/${workstationId}?${params}`,
    );
    const data = response.data;
    if (Array.isArray(data)) {
      const blueprints = data as Blueprint[];
      return {
        blueprints,
        total: blueprints.length,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(blueprints.length / limit)),
      };
    }
    return data as BlueprintsResponse;
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
