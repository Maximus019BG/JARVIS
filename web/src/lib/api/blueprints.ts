import axios from 'axios';

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
  sortBy?: 'name' | 'createdAt' | 'lastModified';
  sortOrder?: 'asc' | 'desc';
}

export interface BlueprintsResponse {
  blueprints: Blueprint[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

// Add request interceptor for auth
api.interceptors.request.use((config) => {
  // Add auth token if available
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const blueprintsApi = {
  // Get all blueprints with pagination and filters
  getBlueprints: async (
    page = 1,
    limit = 12,
    filters: BlueprintFilters = {}
  ): Promise<BlueprintsResponse> => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach(v => params.append(key, v));
        } else {
          params.append(key, value.toString());
        }
      }
    });

    const response = await api.get(`/blueprints?${params}`);
    return response.data;
  },

  // Get a single blueprint by ID
  getBlueprintById: async (id: string): Promise<Blueprint> => {
    const response = await api.get(`/blueprints/${id}`);
    return response.data;
  },

  // Create a new blueprint
  createBlueprint: async (blueprint: Partial<Blueprint>): Promise<Blueprint> => {
    const response = await api.post('/blueprints', blueprint);
    return response.data;
  },

  // Update an existing blueprint
  updateBlueprint: async (id: string, blueprint: Partial<Blueprint>): Promise<Blueprint> => {
    const response = await api.put(`/blueprints/${id}`, blueprint);
    return response.data;
  },

  // Delete a blueprint
  deleteBlueprint: async (id: string): Promise<void> => {
    await api.delete(`/blueprints/${id}`);
  },

  // Clone a blueprint
  cloneBlueprint: async (id: string, name?: string): Promise<Blueprint> => {
    const response = await api.post(`/blueprints/${id}/clone`, { name });
    return response.data;
  },

  // Get blueprint statistics
  getBlueprintStats: async (): Promise<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  }> => {
    const response = await api.get('/blueprints/stats');
    return response.data;
  },
};
