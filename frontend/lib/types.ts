import type { AgentStage } from "@/lib/constants";

export type MemoryKind =
  | "working"
  | "episodic"
  | "semantic"
  | "experience"
  | "style"
  | "failure";

export type RunStatus =
  | "running"
  | "ok"
  | "timeout_synthesis"
  | "error"
  | "rejected"
  | string;

export interface ConfigFlags {
  memory: boolean;
  planner: boolean;
  tools: boolean;
  reflection: boolean;
  llm_judge: boolean;
  http_fetch: boolean;
  tavily: boolean;
  mcp_plugins: boolean;
  otel: boolean;
  embeddings: boolean;
  reranker: boolean;
  embedding_cache: boolean;
  retrieval_cache: boolean;
}

export interface ConfigResponse {
  profile: string;
  llm_backend: string;
  prompt_version: string;
  force_local_only: boolean;
  debug_verbose: boolean;
  context_char_budget: number;
  max_steps: number;
  eval_pass_threshold: number;
  vram_profile: string;
  refusal_patterns: string[];
  flags: ConfigFlags;
}

export interface ConfigPatch {
  enable_memory?: boolean;
  enable_planner?: boolean;
  enable_tools?: boolean;
  enable_reflection?: boolean;
  enable_llm_judge?: boolean;
  enable_otel?: boolean;
  force_local_only?: boolean;
  debug_verbose?: boolean;
  context_char_budget?: number;
  max_steps?: number;
}

export interface ConfigPatchResponse {
  updated: Record<string, { old: unknown; new: unknown }>;
  current: ConfigResponse;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  dependencies: {
    memory: string;
    traces: string;
    llm?: string;
    ollama?: string;
    otel: string;
  };
  config: ConfigResponse;
}

export interface Tool {
  name: string;
  description: string;
  args: Record<string, unknown>;
}

export interface MemoryHit {
  id: number;
  kind: MemoryKind | string;
  text: string;
  salience: number;
  utility_score?: number;
  source_run_id?: string | null;
  verifier_score?: number | null;
  meta?: Record<string, unknown>;
}

export interface MemorySearchRequest {
  query: string;
  k?: number;
  kinds?: MemoryKind[];
  min_salience?: number;
}

export interface MemoryStats {
  count: number;
  by_kind: Record<MemoryKind, number>;
  expiring_within_1h: number;
}

export interface FeedbackRequest {
  rating?: number;
  notes?: string;
}

export interface VerificationDetails {
  score?: number;
  mode?: string;
  judge_correct?: number;
  judge_grounded?: number;
  judge_reason?: string;
  verifier_miscalibration?: boolean;
  grounding_overlap?: number;
  trustworthy?: boolean;
  refusal_detected?: boolean;
  verifier_disagreement?: boolean;
  reflection_delta?: number | null;
}

export interface TraceEvent {
  id?: number;
  run_id: string;
  step: number;
  kind: string;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  latency_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  error?: string | null;
  attributes?: Record<string, unknown>;
  ts?: string;
}

export interface RunTransition {
  id?: number;
  run_id: string;
  step: number;
  stage: AgentStage | string;
  state?: unknown;
  action?: unknown;
  observation?: unknown;
  score?: number | null;
  done?: boolean;
  status?: string | null;
  attributes?: Record<string, unknown>;
  ts?: string;
}

export interface RunSummary {
  run_id: string;
  user_input: string;
  final_output?: string | null;
  score: number;
  profile?: string | null;
  flags?: Record<string, boolean> | string;
  prompt_version: string;
  started_at: string;
  finished_at?: string | null;
  total_latency_ms: number;
  total_tokens: number;
  status: RunStatus;
  user_feedback?: FeedbackRequest;
  reflection_count: number;
  reflection_roi: number;
  initial_score: number;
  tool_call_count: number;
  tool_call_success_count: number;
}

export interface RunDetail extends RunSummary {
  events: TraceEvent[];
  transitions: RunTransition[];
}

export interface RunResult {
  run_id: string;
  answer: string;
  score: number;
  steps: number;
  status: RunStatus;
  tool_calls: Array<Record<string, unknown>>;
  latency_ms: number;
  error?: string | null;
  memory_hits: MemoryHit[];
  context_ids: string[];
  retrieval_candidates: string[];
  reflection_count: number;
  reflection_roi: number;
  run_transition_count: number;
  prompt_version: string;
  verification: VerificationDetails;
  initial_score: number;
}

export interface AsyncRunResponse {
  run_id: string;
  status: "running";
}

export interface EvalChartPoint {
  started_at: string;
  label: string;
  score: number;
}

export interface EvalImprovement {
  label: string;
  value: string;
  type: "positive" | "negative" | "neutral";
}

export interface EvalResults {
  runCount: number;
  overall_score: number;
  success_rate: number;
  mean_latency_ms: number;
  tool_call_success_rate: number;
  reflection_roi: number;
  chartData: EvalChartPoint[];
  improvements: EvalImprovement[];
  runs: RunSummary[];
}
