import type {
  AsyncRunResponse,
  ConfigPatch,
  ConfigPatchResponse,
  ConfigResponse,
  EvalImprovement,
  EvalResults,
  FeedbackRequest,
  HealthResponse,
  MemoryEntry,
  MemoryEntryInput,
  MemoryHit,
  MemorySearchRequest,
  MemoryStats,
  RunComparison,
  RunDetail,
  RunFilters,
  RunResult,
  RunSummary,
  Schedule,
  ScheduleInput,
  Tool,
  ToolLatencyStat,
  UploadedFile,
} from "@/lib/types";

const ENV_BASE = process.env.NEXT_PUBLIC_AGENTOS_API_BASE;
if (!ENV_BASE && typeof window !== "undefined") {
  console.error(
    "[agentos] NEXT_PUBLIC_AGENTOS_API_BASE is not set. " +
      "Copy frontend/.env.local.example to frontend/.env.local and set the URL."
  );
}

const BASE = (ENV_BASE ?? "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");

async function parseError(response: Response): Promise<Error> {
  const detail = await response
    .json()
    .then((body) => body?.detail || body?.error || response.statusText)
    .catch(() => response.statusText);
  return new Error(detail || `${response.status} ${response.statusText}`);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(!isFormData && init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<T>;
}

async function apiText(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.text();
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deltaType(delta: number, invert = false): EvalImprovement["type"] {
  if (Math.abs(delta) < 0.0001) {
    return "neutral";
  }
  const positive = invert ? delta < 0 : delta > 0;
  return positive ? "positive" : "negative";
}

export const api = {
  createRun(input: string, options?: { tag?: string; session_id?: string; workspace_files?: string[] }): Promise<RunResult> {
    return apiFetch<RunResult>("/runs", {
      method: "POST",
      body: JSON.stringify({ input, ...options }),
    });
  },

  createRunAsync(
    input: string,
    options?: { tag?: string; session_id?: string; workspace_files?: string[] },
  ): Promise<AsyncRunResponse> {
    return apiFetch<AsyncRunResponse>("/runs/async", {
      method: "POST",
      body: JSON.stringify({ input, ...options }),
    });
  },

  getRun(run_id: string): Promise<RunDetail> {
    return apiFetch<RunDetail>(`/runs/${run_id}`);
  },

  listRuns(filters: RunFilters | number = 50): Promise<RunSummary[]> {
    const options = typeof filters === "number" ? { limit: filters } : filters;
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 50));
    if (options.search) params.set("search", options.search);
    if (typeof options.minScore === "number") params.set("min_score", String(options.minScore));
    if (typeof options.maxScore === "number") params.set("max_score", String(options.maxScore));
    if (options.dateFrom) params.set("date_from", options.dateFrom);
    if (options.dateTo) params.set("date_to", options.dateTo);
    if (typeof options.starred === "boolean") params.set("starred", String(options.starred));
    if (options.tag) params.set("tag", options.tag);
    if (options.sessionId) params.set("session_id", options.sessionId);
    return apiFetch<RunSummary[]>(`/runs?${params.toString()}`);
  },

  compareRuns(leftRunId: string, rightRunId: string): Promise<RunComparison> {
    const params = new URLSearchParams({
      left_run_id: leftRunId,
      right_run_id: rightRunId,
    });
    return apiFetch<RunComparison>(`/runs/compare?${params.toString()}`);
  },

  async exportRunReport(runId: string): Promise<string> {
    return apiText(`/runs/${runId}/report`);
  },

  patchRun(runId: string, patch: { starred?: boolean; tag?: string | null; session_id?: string | null }): Promise<RunDetail> {
    return apiFetch<RunDetail>(`/runs/${runId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  getMemoryStats(): Promise<MemoryStats> {
    return apiFetch<MemoryStats>("/memory/stats");
  },

  listMemory(params?: {
    limit?: number;
    offset?: number;
    query?: string;
    kind?: string;
    min_salience?: number;
    max_salience?: number;
  }): Promise<MemoryEntry[]> {
    const search = new URLSearchParams();
    if (typeof params?.limit === "number") search.set("limit", String(params.limit));
    if (typeof params?.offset === "number") search.set("offset", String(params.offset));
    if (params?.query) search.set("query", params.query);
    if (params?.kind) search.set("kind", params.kind);
    if (typeof params?.min_salience === "number") search.set("min_salience", String(params.min_salience));
    if (typeof params?.max_salience === "number") search.set("max_salience", String(params.max_salience));
    return apiFetch<MemoryEntry[]>(`/memory${search.toString() ? `?${search.toString()}` : ""}`);
  },

  createMemory(entry: MemoryEntryInput): Promise<MemoryEntry> {
    return apiFetch<MemoryEntry>("/memory", {
      method: "POST",
      body: JSON.stringify(entry),
    });
  },

  patchMemory(entryId: number, patch: Partial<MemoryEntryInput>): Promise<MemoryEntry> {
    return apiFetch<MemoryEntry>(`/memory/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async deleteMemory(entryId: number): Promise<void> {
    await apiFetch<{ status: string }>(`/memory/${entryId}`, { method: "DELETE" });
  },

  searchMemory(req: MemorySearchRequest): Promise<{ results: MemoryHit[] }> {
    return apiFetch<{ results: MemoryHit[] }>("/memory/search", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  getTools(): Promise<Tool[]> {
    return apiFetch<Tool[]>("/tools");
  },

  getHealth(): Promise<HealthResponse> {
    return apiFetch<HealthResponse>("/health");
  },

  getConfig(): Promise<ConfigResponse> {
    return apiFetch<ConfigResponse>("/config");
  },

  patchConfig(patch: ConfigPatch): Promise<ConfigPatchResponse> {
    return apiFetch<ConfigPatchResponse>("/config", {
      method: "POST",
      body: JSON.stringify(patch),
    });
  },

  purgeSystem(kind: string): Promise<{ status: string; purged?: string }> {
    return apiFetch<{ status: string; purged?: string }>("/system/purge", {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
  },

  dumpContext(runId?: string): Promise<{ status: string; target: string }> {
    const suffix = runId ? `?run_id=${encodeURIComponent(runId)}` : "";
    return apiFetch<{ status: string; target: string }>(`/debug/dump-context${suffix}`, {
      method: "POST",
    });
  },

  async leaveFeedback(run_id: string, feedback: FeedbackRequest): Promise<void> {
    await apiFetch<{ run_id: string; feedback: FeedbackRequest }>(`/runs/${run_id}/feedback`, {
      method: "POST",
      body: JSON.stringify(feedback),
    });
  },

  getToolLatencyStats(limitRuns = 100): Promise<ToolLatencyStat[]> {
    return apiFetch<ToolLatencyStat[]>(`/runs/tool-stats?limit_runs=${limitRuns}`);
  },

  listSchedules(): Promise<Schedule[]> {
    return apiFetch<Schedule[]>("/schedules");
  },

  createSchedule(schedule: ScheduleInput): Promise<Schedule> {
    return apiFetch<Schedule>("/schedules", {
      method: "POST",
      body: JSON.stringify(schedule),
    });
  },

  patchSchedule(scheduleId: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<Schedule> {
    return apiFetch<Schedule>(`/schedules/${scheduleId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async deleteSchedule(scheduleId: string): Promise<void> {
    await apiFetch<{ status: string }>(`/schedules/${scheduleId}`, {
      method: "DELETE",
    });
  },

  uploadFile(file: File, sessionId?: string): Promise<UploadedFile> {
    const body = new FormData();
    body.append("file", file);
    if (sessionId) {
      body.append("session_id", sessionId);
    }
    return apiFetch<UploadedFile>("/files/upload", {
      method: "POST",
      body,
    });
  },

  listFiles(): Promise<UploadedFile[]> {
    return apiFetch<UploadedFile[]>("/files");
  },

  exportRLHF(format = "jsonl"): Promise<string> {
    return apiText(`/runs/export?format=${encodeURIComponent(format)}`);
  },

  async getEvalResults(): Promise<EvalResults> {
    const runs = await apiFetch<RunSummary[]>("/runs?limit=200");
    const latestRuns = runs.slice(0, 20).reverse();
    const lastFive = runs.slice(0, 5);
    const previousFive = runs.slice(5, 10);

    const overall_score = mean(runs.map((run) => run.score || 0));
    const success_rate = runs.length
      ? runs.filter((run) => run.status === "ok").length / runs.length
      : 0;
    const mean_latency_ms = mean(runs.map((run) => run.total_latency_ms || 0));

    const toolCalls = runs.reduce((sum, run) => sum + (run.tool_call_count || 0), 0);
    const toolCallSuccesses = runs.reduce(
      (sum, run) => sum + (run.tool_call_success_count || 0),
      0,
    );
    const tool_call_success_rate = toolCalls ? toolCallSuccesses / toolCalls : 0;

    const reflectionRuns = runs.filter((run) => (run.reflection_count || 0) > 0);
    const reflection_roi = reflectionRuns.length
      ? mean(reflectionRuns.map((run) => run.reflection_roi || 0))
      : 0;

    const recentScore = mean(lastFive.map((run) => run.score || 0));
    const previousScore = mean(previousFive.map((run) => run.score || 0));
    const recentSuccess = lastFive.length
      ? lastFive.filter((run) => run.status === "ok").length / lastFive.length
      : 0;
    const previousSuccess = previousFive.length
      ? previousFive.filter((run) => run.status === "ok").length / previousFive.length
      : 0;
    const recentLatency = mean(lastFive.map((run) => run.total_latency_ms || 0));
    const previousLatency = mean(previousFive.map((run) => run.total_latency_ms || 0));

    return {
      runCount: runs.length,
      overall_score,
      success_rate,
      mean_latency_ms,
      tool_call_success_rate,
      reflection_roi,
      chartData: latestRuns.map((run) => ({
        started_at: run.started_at,
        label: new Date(run.started_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        score: run.score || 0,
      })),
      improvements: [
        {
          label: "Score Delta",
          value: `${(recentScore - previousScore >= 0 ? "+" : "")}${(recentScore - previousScore).toFixed(2)}`,
          type: deltaType(recentScore - previousScore),
        },
        {
          label: "Success Delta",
          value: `${(recentSuccess - previousSuccess >= 0 ? "+" : "")}${((recentSuccess - previousSuccess) * 100).toFixed(1)}%`,
          type: deltaType(recentSuccess - previousSuccess),
        },
        {
          label: "Latency Delta",
          value: `${Math.round(recentLatency - previousLatency)} ms`,
          type: deltaType(recentLatency - previousLatency, true),
        },
      ],
      runs,
    };
  },
};

export { BASE };
