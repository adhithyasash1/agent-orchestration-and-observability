"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Heart, Settings2 } from "lucide-react";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { api } from "@/lib/api";
import type { ConfigPatch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

const TOGGLES: Array<{
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
  { key: "debug_verbose", label: "Debug Verbose", description: "Keep verbose trace logging enabled." },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useStore();

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 15000,
  });

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

  const flagValue = (key: keyof ConfigPatch): boolean => {
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
      case "debug_verbose":
        return config.debug_verbose;
      default:
        return false;
    }
  };

  const patch = (change: ConfigPatch) => updateConfig.mutate(change);

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="space-y-10 animate-fade-in pb-20">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
          <p className="mt-1 text-muted">Live patch the runtime flags exposed by the backend config endpoint.</p>
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
                  {TOGGLES.map((toggle) => (
                    <ToggleRow
                      key={toggle.key}
                      label={toggle.label}
                      description={toggle.description}
                      enabled={flagValue(toggle.key)}
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
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-glass p-6 text-sm text-muted">
                <div className="font-bold text-foreground">Current profile</div>
                <div className="mt-2">{config.profile}</div>
                <div className="mt-4 font-bold text-foreground">Prompt version</div>
                <div className="mt-2">{config.prompt_version}</div>
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
