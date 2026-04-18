"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Clock3, Heart, Settings2 } from "lucide-react";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { ConfigPatch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

const RUNTIME_TOGGLES: Array<{
  key: keyof ConfigPatch;
  label: string;
  description: string;
}> = [
  { key: "enable_memory", label: "Memory", description: "Enable retrieval and writeback into local memory." },
  { key: "enable_planner", label: "Planner", description: "Keep the planning phase active before answering." },
  { key: "enable_tools", label: "Tools", description: "Allow tool dispatch during runs." },
  { key: "enable_reflection", label: "Reflection", description: "Retry low-scoring answers with critique." },
  { key: "enable_llm_judge", label: "LLM Judge", description: "Use the judge path when available." },
  { key: "enable_otel", label: "OTel", description: "Emit OpenTelemetry spans for runs." },
  { key: "force_local_only", label: "Force Local Only", description: "Block internet-facing tools and keep runs local." },
  { key: "allow_internet_mcp", label: "Allow Internet MCP", description: "Permit internet-facing MCP servers when their individual toggles are on." },
  { key: "debug_verbose", label: "Debug Verbose", description: "Keep verbose trace logging enabled." },
];

const LOCAL_MCP_TOGGLES: Array<{
  key: keyof ConfigPatch;
  label: string;
  description: string;
}> = [
  {
    key: "enable_sequential_thinking_mcp",
    label: "Sequential Thinking",
    description: "Enable the local step-by-step MCP reasoning server.",
  },
  {
    key: "enable_excel_mcp",
    label: "Excel MCP",
    description: "Run excel-mcp-server on loopback and keep workbook paths inside data/workspace.",
  },
  {
    key: "enable_markdownify_mcp",
    label: "Markdownify MCP",
    description: "Expose only local file conversions for workspace uploads, with web tools disabled.",
  },
];

const INTERNET_MCP_TOGGLES: Array<{
  key: keyof ConfigPatch;
  label: string;
  description: string;
}> = [
  {
    key: "enable_playwright_mcp",
    label: "Playwright MCP",
    description: "Enable browser automation through the Playwright MCP server when internet MCP access is allowed.",
  },
];

const INTERNET_TOOL_TOGGLES: Array<{
  key: keyof ConfigPatch;
  label: string;
  description: string;
}> = [
  {
    key: "enable_trading_tools",
    label: "Trading Tools",
    description: "Enable the native TradingView screener tool. Treat it as public market data, not a guaranteed feed.",
  },
];

const PROMPT_PREVIEW_SAMPLE = {
  tool_list: "- read_file(path: string) - Read a workspace file\n- describe_image(path: string) - Describe an uploaded image",
  context: "Retrieved context packet with session history, memory hits, and uploaded files.",
  tool_results: "- read_file [ok]: The CSV has 12 columns and 480 rows.",
  critique: "The previous answer skipped the uploaded file.",
  user_input: "Summarize the uploaded spreadsheet and answer the user's question.",
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useStore();
  const [promptVersion, setPromptVersion] = useState("");
  const [plannerPromptTemplate, setPlannerPromptTemplate] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleCron, setScheduleCron] = useState("0 9 * * 1-5");
  const [scheduleInput, setScheduleInput] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 15000,
  });

  const schedulesQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.listSchedules(),
  });

  useEffect(() => {
    if (config) {
      setPromptVersion(config.prompt_version);
      setPlannerPromptTemplate(config.planner_prompt_template);
    }
  }, [config]);

  const updateConfig = useMutation({
    mutationFn: (patch: ConfigPatch) => api.patchConfig(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data.current);
      queryClient.invalidateQueries({ queryKey: ["health"] });
      const diff = Object.entries(data.updated)
        .map(([key, change]) => `${key}: ${String(change.old)} -> ${String(change.new)}`)
        .join(" | ");
      showToast(diff || "No settings changed.", "success");
    },
    onError: (error: Error) => {
      showToast(`Update failed: ${error.message}`, "error");
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: () =>
      api.createSchedule({
        name: scheduleName,
        cron: scheduleCron,
        input: scheduleInput,
        timezone: config?.scheduler_timezone,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      setScheduleName("");
      setScheduleInput("");
      showToast("Scheduled run created", "success");
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const patchScheduleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patchSchedule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const toggleValue = (key: keyof ConfigPatch): boolean => {
    if (!config) {
      return false;
    }
    switch (key) {
      case "enable_memory":
        return config.flags.memory;
      case "enable_planner":
        return config.flags.planner;
      case "enable_tools":
        return config.flags.tools;
      case "enable_reflection":
        return config.flags.reflection;
      case "enable_llm_judge":
        return config.flags.llm_judge;
      case "enable_otel":
        return config.flags.otel;
      case "force_local_only":
        return config.force_local_only;
      case "allow_internet_mcp":
        return config.allow_internet_mcp;
      case "enable_sequential_thinking_mcp":
        return config.mcp.local_mcp.sequential_thinking;
      case "enable_excel_mcp":
        return config.mcp.local_mcp.excel;
      case "enable_markdownify_mcp":
        return config.mcp.local_mcp.markdownify;
      case "enable_playwright_mcp":
        return config.mcp.internet_mcp.playwright;
      case "enable_trading_tools":
        return config.flags.trading_tools;
      case "debug_verbose":
        return config.debug_verbose;
      default:
        return false;
    }
  };

  const plannerPreview = useMemo(() => {
    const template = plannerPromptTemplate || config?.planner_prompt_template || "";
    return template
      .replace("{tool_list}", PROMPT_PREVIEW_SAMPLE.tool_list)
      .replace("{context}", PROMPT_PREVIEW_SAMPLE.context)
      .replace("{tool_results}", PROMPT_PREVIEW_SAMPLE.tool_results)
      .replace("{critique}", PROMPT_PREVIEW_SAMPLE.critique)
      .replace("{user_input}", PROMPT_PREVIEW_SAMPLE.user_input);
  }, [config?.planner_prompt_template, plannerPromptTemplate]);

  const patch = (change: ConfigPatch) => updateConfig.mutate(change);

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="space-y-10 animate-fade-in pb-20">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
          <p className="mt-1 text-muted">Live patch runtime flags, edit the planner prompt, and manage scheduled runs.</p>
        </div>

        {isLoading || !config ? (
          <div className="h-96 animate-pulse rounded-2xl bg-glass" />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="space-y-8 lg:col-span-8">
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Settings2 className="h-4 w-4 text-accent" />
                  Runtime Flags
                </h2>
                <div className="divide-y divide-border rounded-2xl border border-border bg-glass">
                  {RUNTIME_TOGGLES.map((toggle) => (
                    <ToggleRow
                      key={toggle.key}
                      label={toggle.label}
                      description={toggle.description}
                      enabled={toggleValue(toggle.key)}
                      onChange={(value) => patch({ [toggle.key]: value } as ConfigPatch)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Settings2 className="h-4 w-4 text-accent" />
                  Local MCP Servers
                </h2>
                <div className="divide-y divide-border rounded-2xl border border-border bg-glass">
                  {LOCAL_MCP_TOGGLES.map((toggle) => (
                    <ToggleRow
                      key={toggle.key}
                      label={toggle.label}
                      description={toggle.description}
                      enabled={toggleValue(toggle.key)}
                      onChange={(value) => patch({ [toggle.key]: value } as ConfigPatch)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Settings2 className="h-4 w-4 text-accent" />
                  Internet MCP Servers
                </h2>
                <div className="divide-y divide-border rounded-2xl border border-border bg-glass">
                  {INTERNET_MCP_TOGGLES.map((toggle) => (
                    <ToggleRow
                      key={toggle.key}
                      label={toggle.label}
                      description={toggle.description}
                      enabled={toggleValue(toggle.key)}
                      onChange={(value) => patch({ [toggle.key]: value } as ConfigPatch)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Settings2 className="h-4 w-4 text-accent" />
                  Internet Tools
                </h2>
                <div className="divide-y divide-border rounded-2xl border border-border bg-glass">
                  {INTERNET_TOOL_TOGGLES.map((toggle) => (
                    <ToggleRow
                      key={toggle.key}
                      label={toggle.label}
                      description={toggle.description}
                      enabled={toggleValue(toggle.key)}
                      onChange={(value) => patch({ [toggle.key]: value } as ConfigPatch)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Activity className="h-4 w-4 text-accent" />
                  Numeric Limits
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <NumberCard
                    label="Context Budget"
                    description="Allowed range: 1,000 to 500,000 characters."
                    value={config.context_char_budget}
                    min={1000}
                    max={500000}
                    onSave={(value) => patch({ context_char_budget: value })}
                  />
                  <NumberCard
                    label="Max Steps"
                    description="Allowed range: 1 to 100 reasoning steps."
                    value={config.max_steps}
                    min={1}
                    max={100}
                    onSave={(value) => patch({ max_steps: value })}
                  />
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Activity className="h-4 w-4 text-accent" />
                  Prompt Template Editor
                </h2>
                <div className="rounded-2xl border border-border bg-glass p-6 space-y-4">
                  <Input
                    value={promptVersion}
                    onChange={(event) => setPromptVersion(event.target.value)}
                    placeholder="Prompt version"
                  />
                  <Textarea
                    value={plannerPromptTemplate}
                    onChange={(event) => setPlannerPromptTemplate(event.target.value)}
                    className="min-h-72 font-mono text-xs"
                  />
                  <Button
                    onClick={() =>
                      patch({
                        prompt_version: promptVersion,
                        planner_prompt_template: plannerPromptTemplate,
                      })
                    }
                  >
                    Save Prompt Settings
                  </Button>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted">Live Preview</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                      {plannerPreview}
                    </pre>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
                  <Clock3 className="h-4 w-4 text-accent" />
                  Scheduled Runs
                </h2>
                <div className="rounded-2xl border border-border bg-glass p-6 space-y-4">
                  <Input value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} placeholder="Schedule name" />
                  <Input value={scheduleCron} onChange={(event) => setScheduleCron(event.target.value)} placeholder="Cron expression" />
                  <Textarea
                    value={scheduleInput}
                    onChange={(event) => setScheduleInput(event.target.value)}
                    placeholder="Prompt to run on the schedule"
                    className="min-h-28"
                  />
                  <Button onClick={() => scheduleMutation.mutate()} disabled={scheduleMutation.isPending}>
                    {scheduleMutation.isPending ? "Saving..." : "Create Schedule"}
                  </Button>
                  <div className="space-y-3">
                    {(schedulesQuery.data ?? []).map((schedule) => (
                      <div key={schedule.schedule_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-bold text-white">{schedule.name}</div>
                            <div className="mt-1 text-xs text-muted">
                              {schedule.cron} • next {schedule.next_run_at ?? "n/a"} • ran {schedule.run_count} times
                            </div>
                            <p className="mt-3 text-sm text-muted">{schedule.user_input}</p>
                            {schedule.last_error ? (
                              <div className="mt-2 text-xs text-danger">{schedule.last_error}</div>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              onClick={() => patchScheduleMutation.mutate({ id: schedule.schedule_id, enabled: !schedule.enabled })}
                            >
                              {schedule.enabled ? "Pause" : "Resume"}
                            </Button>
                            <Button variant="ghost" onClick={() => deleteScheduleMutation.mutate(schedule.schedule_id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <div className="space-y-8 lg:col-span-4">
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 px-2 text-lg font-bold">
                  <Heart className="h-5 w-5 text-danger" />
                  Environment Health
                </h2>
                <div className="space-y-4 rounded-2xl border border-border bg-glass p-6">
                  <HealthStatus label="Memory Store" status={health?.dependencies.memory} />
                  <HealthStatus label="Trace Store" status={health?.dependencies.traces} />
                  <HealthStatus
                    label="LLM Backend"
                    status={health?.dependencies.ollama || health?.dependencies.llm}
                  />
                  <HealthStatus
                    label="OpenTelemetry"
                    status={health?.dependencies.otel === "enabled" ? "ok" : "disabled"}
                  />
                  <HealthStatus label="Scheduler" status={health?.dependencies.scheduler} />
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-glass p-6 text-sm text-muted">
                <div className="font-bold text-foreground">Current profile</div>
                <div className="mt-2">{config.profile}</div>
                <div className="mt-4 font-bold text-foreground">Prompt version</div>
                <div className="mt-2">{config.prompt_version}</div>
                <div className="mt-4 font-bold text-foreground">Vision model</div>
                <div className="mt-2">{config.vision_model}</div>
              </section>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  onChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 p-6 transition-colors hover:bg-white/5">
      <div className="space-y-1">
        <div className="text-sm font-bold">{label}</div>
        <p className="max-w-lg text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative h-6 w-12 rounded-full transition-all duration-300",
          enabled ? "bg-accent shadow-[0_0_15px_rgba(125,211,252,0.4)]" : "bg-white/10",
        )}
      >
        <div
          className={cn(
            "absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-all duration-300",
            enabled && "translate-x-6",
          )}
        />
      </button>
    </div>
  );
}

function NumberCard({
  label,
  description,
  value,
  min,
  max,
  onSave,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onSave: (value: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-glass p-6">
      <div className="text-sm font-bold">{label}</div>
      <p className="text-xs leading-relaxed text-muted">{description}</p>
      <input
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isNaN(next)) {
            return;
          }
          onSave(Math.min(max, Math.max(min, next)));
        }}
        className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

function HealthStatus({ label, status }: { label: string; status?: string }) {
  const isOk = status === "ok" || status === "enabled";
  const isError = status === "error" || status === "unreachable";

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono uppercase text-muted">{status || "checking..."}</span>
        <div className={cn("h-2 w-2 rounded-full", isOk ? "bg-success" : isError ? "bg-danger" : "bg-muted")} />
      </div>
    </div>
  );
}
