import axios from "axios";

export interface Automation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string | null;
  createdBy: string;
  workstationId: string;
  metadata?: string;
}

const api = axios.create({ baseURL: "/api", timeout: 10000 });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("authToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const automationsApi = {
  list: async (workstationId: string): Promise<Automation[]> => {
    const res = await api.get(`/workstation/automation/list/${workstationId}`);
    return res.data;
  },
  get: async (workstationId: string, id: string): Promise<Automation> => {
    const res = await api.get(
      `/workstation/automation/load/${workstationId}/${id}`,
    );
    return res.data;
  },
  save: async (
    workstationId: string,
    id: string,
    body: { name: string; data?: unknown },
  ) => {
    const res = await api.post(
      `/workstation/automation/save/${workstationId}/${id}`,
      body,
    );
    return res.data;
  },
};
