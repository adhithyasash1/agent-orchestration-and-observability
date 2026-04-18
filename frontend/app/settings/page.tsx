"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { 
  Cpu, 
  ShieldCheck, 
  Zap, 
  Database, 
  Wrench, 
  Terminal,
  Activity,
  Heart,
  Info,
  Monitor,
  HardDrive
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useStore();

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get_health(),
    refetchInterval: 15000,
  });

  const updateConfig = useMutation({
    mutationFn: (payload: any) => api.patchConfig(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data.current);
      showToast("Settings updated successfully", "success");
    },
    onError: (err: any) => {
      showToast("Update failed: " + err.message, "error");
    }
  });

  if (isLoading || !config) return <div className="p-12 animate-pulse bg-glass rounded-2xl h-96" />;

  const handleToggle = (flag: string, value: boolean) => {
    updateConfig.mutate({ [flag]: value });
  };

  const handleProfileChange = (profile: string) => {
    updateConfig.mutate({ profile });
  };

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted mt-1">Hardened project settings and architectural toggles.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-8">
          
          {/* Hardware Profile */}
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-muted uppercase tracking-widest flex items-center gap-2 px-2">
              <Cpu className="w-4 h-4 text-accent" />
              Hardware Profile
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ProfileCard 
                active={config.profile === "minimal"}
                onClick={() => handleProfileChange("minimal")}
                icon={Monitor}
                label="Low VRAM"
                description="32k context window. Safe for 8–12GB VRAM. Recommended for local research tasks."
                budget="32,000"
              />
              <ProfileCard 
                active={config.profile === "high"}
                onClick={() => handleProfileChange("high")}
                icon={HardDrive}
                label="High VRAM"
                description="128k context window. Requires 24GB+ VRAM. Designed for deep multi-document synthesis."
                budget="128,000"
              />
            </div>
          </section>

          {/* Quality Controls */}
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-muted uppercase tracking-widest flex items-center gap-2 px-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Quality Controls
            </h2>
            <div className="bg-glass rounded-2xl divide-y divide-border border border-border">
              <ToggleRow 
                icon={ShieldCheck}
                label="LLM Judge"
                description="Uses the LLM to verify answers before registration. Prevents hallucinations from entering memory."
                enabled={config.flags.enable_llm_judge}
                onChange={(v: boolean) => handleToggle("enable_llm_judge", v)}
              />
              <ToggleRow 
                icon={Zap}
                label="Reflection"
                description="Enables autonomous critique and retry when verification results fall below threshold."
                enabled={config.flags.enable_reflection}
                onChange={(v: boolean) => handleToggle("enable_reflection", v)}
              />
              <ToggleRow 
                icon={Database}
                label="Episodic Memory"
                description="Allows the agent to retrieve past observations. Essential for cross-step continuity."
                enabled={config.flags.enable_memory}
                onChange={(v: boolean) => handleToggle("enable_memory", v)}
              />
              <ToggleRow 
                icon={Wrench}
                label="Tool Interaction"
                description="Enables external tool capabilities (Search, Calc, etc). Disable for pure reasoning tasks."
                enabled={config.flags.enable_tools}
                onChange={(v: boolean) => handleToggle("enable_tools", v)}
              />
            </div>
          </section>

          {/* Context Budget */}
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-muted uppercase tracking-widest flex items-center gap-2 px-2">
              <Activity className="w-4 h-4 text-accent" />
              Context Budget
            </h2>
            <div className="bg-glass rounded-2xl p-6 space-y-6">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">Maximum Context Capacity</span>
                <span className="text-xl font-mono font-bold text-accent">{config.context_char_budget.toLocaleString()} Chars</span>
              </div>
              <input 
                type="range"
                min="8000" max="128000" step="1000"
                value={config.context_char_budget}
                onChange={(e) => updateConfig.mutate({ context_char_budget: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                <BudgetSplit label="Planner Context (60%)" value={`${(config.context_char_budget * 0.6 / 1000).toFixed(0)}k`} />
                <BudgetSplit label="Verifier Window (Max)" value={`${Math.min(config.context_char_budget * 0.5, 30000) / 1000}k`} />
              </div>
            </div>
          </section>

          {/* Advanced Toggles */}
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-muted uppercase tracking-widest flex items-center gap-2 px-2">
              <Terminal className="w-4 h-4" />
              Advanced
            </h2>
            <div className="bg-glass rounded-2xl divide-y divide-border border border-border">
              <ToggleRow 
                label="Force Local Only"
                description="Air-gap mode: blocks all external internet tool calls and Tavily search."
                enabled={config.force_local_only}
                onChange={(v: boolean) => updateConfig.mutate({ force_local_only: v })}
              />
              <ToggleRow 
                label="Debug Verbosity"
                description="Injects trace attributes into logs and displays raw JSON in the Trace Inspector."
                enabled={config.debug_verbose}
                onChange={(v: boolean) => updateConfig.mutate({ debug_verbose: v })}
              />
            </div>
          </section>
        </div>

        {/* Right Sidebar: Health */}
        <div className="lg:col-span-4 space-y-8">
          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 px-2">
              <Heart className="w-5 h-5 text-danger" />
              Environment Health
            </h2>
            <div className="bg-glass rounded-2xl p-6 space-y-6">
              <HealthStatus label="Ollama Service" status={health?.dependencies.ollama} />
              <HealthStatus label="Memory Engine (SQLite)" status={health?.dependencies.memory} />
              <HealthStatus label="Telemetry Service (OTel)" status={health?.dependencies.otel === "enabled" ? "ok" : "disabled"} />
              
              <div className="pt-6 border-t border-border mt-6">
                <div className="flex items-center gap-2 text-xs text-muted mb-2">
                  <Info className="w-3 h-3" />
                  System Overview
                </div>
                <div className="text-[10px] text-muted-foreground leading-relaxed space-y-2">
                  <p>Model: <span className="text-app-foreground">{config.llm_backend}</span></p>
                  <p>Prompt Version: <span className="text-app-foreground">{config.prompt_version}</span></p>
                  <p>Database: <span className="text-app-foreground">data/agentos.db</span></p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ active, onClick, icon: Icon, label, description, budget }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "text-left p-6 rounded-2xl transition-all border relative overflow-hidden group active:scale-[0.98]",
        active ? "bg-accent/10 border-accent/40 ring-1 ring-accent/20" : "bg-glass border-border hover:border-white/20"
      )}
    >
      <div className={cn("p-2 rounded-lg mb-4 w-fit", active ? "bg-accent text-accent-foreground" : "bg-white/5 text-muted")}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold">{label}</span>
        {active && <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded uppercase tracking-tighter">Current</span>}
      </div>
      <p className="text-xs text-muted leading-relaxed line-clamp-2 mb-4 group-hover:text-muted-foreground transition-colors">{description}</p>
      <div className="text-xs font-mono text-accent">Budget: {budget} chars</div>
    </button>
  );
}

function ToggleRow({ icon: Icon, label, description, enabled, onChange }: any) {
  return (
    <div className="p-6 flex items-start justify-between gap-6 hover:bg-white/5 transition-colors group">
      <div className="flex items-start gap-4">
        {Icon && <Icon className="w-5 h-5 mt-0.5 text-muted group-hover:text-accent transition-colors" />}
        <div className="space-y-1">
          <div className="text-sm font-bold">{label}</div>
          <p className="text-xs text-muted leading-relaxed max-w-lg">{description}</p>
        </div>
      </div>
      <button 
        onClick={() => onChange(!enabled)}
        className={cn(
          "w-12 h-6 rounded-full relative transition-all duration-300",
          enabled ? "bg-accent shadow-[0_0_15px_rgba(125,211,252,0.4)]" : "bg-white/10"
        )}
      >
        <div className={cn(
          "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-all duration-300",
          enabled ? "translate-x-6" : ""
        )} />
      </button>
    </div>
  );
}

function BudgetSplit({ label, value }: any) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted uppercase font-bold tracking-widest">{label}</span>
      <span className="text-lg font-mono font-bold text-accent">{value}</span>
    </div>
  );
}

function HealthStatus({ label, status }: { label: string, status?: string }) {
  const isOk = status === "ok" || status === "enabled";
  const isError = status === "error" || status === "unreachable";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted uppercase">{status || "Checking..."}</span>
        <div className={cn("w-2 h-2 rounded-full", isOk ? "bg-success" : isError ? "bg-danger" : "bg-muted")} />
      </div>
    </div>
  );
}
