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

/** A run as the runs list returns it. Statuses come from `automation_run.status`. */
export interface AutomationRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  triggerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  stepCount: number;
  createdAt: string;
}

/** One executed node. `input`/`output` are whatever the runner recorded, so `unknown`. */
export interface AutomationRunStep {
  id: string;
  index: number;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  type: string;
  name: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A cron trigger's stored schedule. Null on a webhook trigger, which has no config. */
export interface CronConfig {
  expression: string;
  /** IANA zone, e.g. `Europe/Sofia`. */
  tz: string;
}

export interface AutomationTrigger {
  id: string;
  type: "webhook" | "cron";
  /** The path component of the webhook URL. Present but unused on a cron trigger. */
  key: string;
  config: CronConfig | null;
  /** The minute a cron trigger last fired; null on a webhook, or before the first run. */
  lastFiredAt: string | null;
  createdAt: string;
}

export interface AutomationVersions {
  automation: {
    id: string;
    name: string;
    status: string;
    /** Null until the automation has been published at least once. */
    publishedVersion: number | null;
  };
  versions: Array<{ id: string; version: number; createdAt: string; createdBy: string }>;
}

export const automationsApi = {
  list: async (workstationId: string): Promise<Automation[]> => {
    const res = await api.get<Automation[]>(`/workstation/automation/list/${workstationId}`);
    return res.data;
  },
  get: async (workstationId: string, id: string): Promise<Automation> => {
    const res = await api.get<Automation>(
      `/workstation/automation/load/${workstationId}/${id}`,
    );
    return res.data;
  },
  save: async (
    workstationId: string,
    id: string,
    body: { name: string; data?: unknown },
  ) => {
    const res = await api.post<{ success: boolean }>(
      `/workstation/automation/save/${workstationId}/${id}`,
      body,
    );
    return res.data;
  },
  publish: async (
    workstationId: string,
    id: string,
  ): Promise<{ success: boolean; publishedVersion: number }> => {
    const res = await api.post<{ success: boolean; publishedVersion: number }>(
      `/workstation/automation/publish/${workstationId}/${id}`,
      {},
    );
    return res.data;
  },
  /** Starts a run against the published version. `input` becomes the definition's `$json`. */
  run: async (
    workstationId: string,
    id: string,
    input?: unknown,
  ): Promise<{ success: boolean; runId: string; status: string; suspended: boolean }> => {
    const res = await api.post<{
      success: boolean;
      runId: string;
      status: string;
      suspended: boolean;
    }>(`/workstation/automation/run/${workstationId}/${id}`, input ?? {});
    return res.data;
  },
  runs: async (
    workstationId: string,
    id: string,
  ): Promise<{ runs: AutomationRun[] }> => {
    const res = await api.get<{ runs: AutomationRun[] }>(
      `/workstation/automation/runs/${workstationId}/${id}`,
    );
    return res.data;
  },
  getRun: async (
    workstationId: string,
    id: string,
    runId: string,
  ): Promise<{ run: AutomationRun; steps: AutomationRunStep[] }> => {
    const res = await api.get<{ run: AutomationRun; steps: AutomationRunStep[] }>(
      `/workstation/automation/run/${workstationId}/${id}/${runId}`,
    );
    return res.data;
  },
  versions: async (workstationId: string, id: string): Promise<AutomationVersions> => {
    const res = await api.get<AutomationVersions>(
      `/workstation/automation/versions/${workstationId}/${id}`,
    );
    return res.data;
  },
  triggers: async (
    workstationId: string,
    id: string,
  ): Promise<{ triggers: AutomationTrigger[] }> => {
    const res = await api.get<{ triggers: AutomationTrigger[] }>(
      `/workstation/automation/triggers/${workstationId}/${id}`,
    );
    return res.data;
  },
  /** `cron` needs a config; `webhook` takes none — the server generates its key. */
  createTrigger: async (
    workstationId: string,
    id: string,
    body: { type: "webhook" } | { type: "cron"; config: CronConfig },
  ): Promise<{ success: boolean; trigger: AutomationTrigger }> => {
    const res = await api.post<{ success: boolean; trigger: AutomationTrigger }>(
      `/workstation/automation/triggers/${workstationId}/${id}`,
      body,
    );
    return res.data;
  },
  deleteTrigger: async (workstationId: string, id: string, triggerId: string) => {
    const res = await api.delete<{ success: boolean }>(
      `/workstation/automation/triggers/${workstationId}/${id}/${triggerId}`,
    );
    return res.data;
  },
};
