"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Brain,
  ChevronRight,
  Cpu,
  Database,
  Heart,
  History,
  Play,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const [isDispatchOpen, setDispatchOpen] = useState(false);

  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.listRuns(20),
    refetchInterval: 10000,
  });

  const { data: memory } = useQuery({
    queryKey: ["memory-stats"],
    queryFn: () => api.getMemoryStats(),
    refetchInterval: 5000,
  });

  const { data: tools = [] } = useQuery({
    queryKey: ["tools"],
    queryFn: () => api.getTools(),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 15000,
  });

  const avgScore = runs.length
    ? runs.slice(0, 10).reduce((sum, run) => sum + (run.score || 0), 0) / Math.min(runs.length, 10)
    : 0;

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="space-y-8 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
            <p className="mt-1 text-muted">Real-time operational overview of AgentOS.</p>
          </div>
          <button
            onClick={() => setDispatchOpen((value) => !value)}
            className="group relative overflow-hidden rounded-xl bg-accent px-6 py-3 font-bold text-accent-foreground shadow-[0_0_20px_rgba(125,211,252,0.3)] transition-all active:scale-95"
          >
            <div className="relative z-10 flex items-center gap-2">
              <Play className="h-4 w-4 fill-current" />
              <span>Dispatch Agent</span>
            </div>
            <div className="absolute inset-0 translate-y-full bg-white/20 transition-transform group-hover:translate-y-0" />
          </button>
        </div>

        <AnimatePresence>{isDispatchOpen && <DispatchComposer onClose={() => setDispatchOpen(false)} />}</AnimatePresence>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Runs" value={runs.length} icon={History} color="text-accent" href="/runs" />
          <StatCard
            label="Avg Score"
            value={avgScore.toFixed(2)}
            icon={BarChart3}
            color={avgScore >= 0.7 ? "text-success" : avgScore >= 0.4 ? "text-gold" : "text-danger"}
            suffix="/1.0"
            href="/runs"
          />
          <StatCard label="Memory Entries" value={memory?.count || 0} icon={Database} color="text-purple-400" href="/memory" />
          <StatCard label="Active Tools" value={tools.length} icon={Cpu} color="text-emerald-400" href="/settings" />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center justify-between px-2">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <History className="h-5 w-5 text-accent" />
                Recent Activity
              </h2>
              <Link
                href="/runs"
                className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted transition-colors hover:text-accent"
              >
                View All <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-hidden rounded-2xl bg-glass">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-white/5">
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted">ID</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted">Prompt</th>
                    <th className="px-6 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted">Score</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted">Status</th>
                    <th className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-muted">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.map((run) => (
                    <tr
                      key={run.run_id}
                      className="group cursor-pointer transition-colors hover:bg-white/5"
                      onClick={() => {
                        router.push(`/runs/${run.run_id}`);
                      }}
                    >
                      <td className="px-6 py-4 text-xs font-mono text-accent">#{run.run_id.slice(0, 8)}</td>
                      <td className="px-6 py-4">
                        <p className="max-w-[240px] truncate text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                          {run.user_input}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-mono font-bold">{run.score.toFixed(2)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-6 py-4 text-right text-xs font-mono text-muted">
                        {Math.round(run.total_latency_ms || 0)} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 px-2 text-lg font-bold">
                <Brain className="h-5 w-5 text-purple-400" />
                Memory Tiering
              </h2>
              <div className="rounded-2xl bg-glass p-6">
                <div className="h-48">
                  <MemoryDistributionChart data={memory?.by_kind || {}} />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="flex items-center gap-2 px-2 text-lg font-bold">
                <Heart className="h-5 w-5 text-danger" />
                System Integrity
              </h2>
              <div className="space-y-4 rounded-2xl bg-glass p-6">
                <HealthStatusItem label="LLM Backend" status={health?.dependencies.ollama || health?.dependencies.llm || "unknown"} />
                <HealthStatusItem label="Memory Store" status={health?.dependencies.memory || "unknown"} />
                <HealthStatusItem label="Trace Store" status={health?.dependencies.traces || "unknown"} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  suffix = "",
  href,
}: {
  label: string;
  value: string | number;
  icon: typeof History;
  color: string;
  suffix?: string;
  href?: string;
}) {
  const content = (
    <div className="group relative overflow-hidden rounded-2xl bg-glass p-6 h-full transition-all hover:ring-1 hover:ring-white/20 active:scale-[0.98]">
      <div className={cn("absolute right-0 top-0 p-4 opacity-10 transition-transform group-hover:scale-110", color)}>
        <Icon className="h-12 w-12" />
      </div>
      <div className="relative z-10 flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-widest text-muted">{label}</span>
        <div className="flex items-baseline gap-1">
          <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-bold">
            {value}
          </motion.span>
          <span className="text-xs font-mono text-muted">{suffix}</span>
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

function DispatchComposer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [input, setInput] = useState("");

  const createRun = useMutation({
    mutationFn: (value: string) => api.createRunAsync(value),
    onSuccess: (result) => {
      router.push(`/runs/${result.run_id}`);
      onClose();
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || createRun.isPending) {
      return;
    }
    createRun.mutate(input);
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="mb-8 rounded-2xl border-accent/20 bg-glass p-6 ring-1 ring-accent/20">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-accent">Agent Dispatch</label>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold uppercase text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <textarea
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
            className="min-h-[100px] w-full rounded-xl border border-border bg-background/50 p-4 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Cmd/Ctrl + Enter to dispatch</span>
            <button
              disabled={createRun.isPending}
              className="rounded-lg bg-accent px-6 py-2 font-bold text-accent-foreground disabled:opacity-50"
            >
              {createRun.isPending ? "Dispatching..." : "Launch"}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const themes: Record<string, string> = {
    running: "text-accent border-accent/20 bg-accent/5 animate-pulse-subtle",
    ok: "text-success border-success/20 bg-success/5",
    timeout_synthesis: "text-gold border-gold/20 bg-gold/5",
    error: "text-danger border-danger/20 bg-danger/5",
  };
  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold uppercase", themes[status] || themes.running)}>
      {status}
    </div>
  );
}

function HealthStatusItem({ label, status }: { label: string; status: string }) {
  const isOk = status === "ok" || status === "enabled";
  const isError = status === "error" || status === "unreachable";

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono uppercase text-muted">{status}</span>
        <div className={cn("h-2 w-2 rounded-full", isOk ? "bg-success" : isError ? "bg-danger" : "bg-muted")} />
      </div>
    </div>
  );
}

function MemoryDistributionChart({ data }: { data: Record<string, number> }) {
  const [mounted, setMounted] = useState(false);
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));
  const colors = ["#7dd3fc", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb7185"];

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-full w-full rounded-xl bg-white/5" />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
      <BarChart data={chartData} layout="vertical">
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" hide />
        <Tooltip
          contentStyle={{ backgroundColor: "#091423", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: "12px" }}
          cursor={{ fill: "transparent" }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={`${entry.name}-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
