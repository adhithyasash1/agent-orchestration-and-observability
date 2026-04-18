"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { 
  Terminal, 
  Database, 
  Cpu, 
  BarChart3,
  Play,
  Heart,
  Brain,
  Zap,
  ChevronRight,
  History
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip
} from "recharts";

export default function DashboardPage() {
  const [isDispatchOpen, setDispatchOpen] = useState(false);

  const { data: runs } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.listRuns(20),
    refetchInterval: 10000,
  });

  const { data: memory } = useQuery({
    queryKey: ["memory-stats"],
    queryFn: () => api.getMemoryStats(),
    refetchInterval: 5000,
  });

  const { data: tools } = useQuery({
    queryKey: ["tools"],
    queryFn: () => api.getTools(),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 15000,
  });

  const avgScore = runs?.length 
    ? runs.slice(0, 10).reduce((acc: number, r: any) => acc + (r.score || 0), 0) / Math.min(runs.length, 10)
    : 0;
  
  const activeTools = tools?.length || 0;
  const totalRuns = runs?.length || 0;
  const memoryCount = memory?.count || 0;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
          <p className="text-muted mt-1">Real-time operational overview of AgentOS.</p>
        </div>
        <button 
          onClick={() => setDispatchOpen(!isDispatchOpen)}
          className="group relative px-6 py-3 bg-accent text-accent-foreground font-bold rounded-xl overflow-hidden active:scale-95 transition-all shadow-[0_0_20px_rgba(125,211,252,0.3)]"
        >
          <div className="flex items-center gap-2 relative z-10">
            <Play className="w-4 h-4 fill-current" />
            <span>Dispatch Agent</span>
          </div>
          <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform" />
        </button>
      </div>

      <AnimatePresence>
        {isDispatchOpen && (
          <DispatchComposer onClose={() => setDispatchOpen(false)} />
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Runs" value={totalRuns} icon={Terminal} color="text-accent" />
        <StatCard 
          label="Avg Score" 
          value={avgScore.toFixed(2)} 
          icon={BarChart3} 
          color={avgScore >= 0.7 ? "text-success" : avgScore >= 0.4 ? "text-gold" : "text-danger"} 
          suffix="/1.0"
        />
        <StatCard label="Memory Entries" value={memoryCount} icon={Database} color="text-purple-400" />
        <StatCard label="Active Tools" value={activeTools} icon={Cpu} color="text-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <History className="w-5 h-5 text-accent" />
              Recent Activity
            </h2>
            <Link href="/runs" className="text-xs text-muted hover:text-accent transition-colors flex items-center gap-1 font-bold uppercase tracking-wider">
              View All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="bg-glass rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-white/5">
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted">ID</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted">Prompt</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted text-center">Score</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted">Status</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs?.map((run: any) => (
                  <tr 
                    key={run.run_id} 
                    className="group hover:bg-white/5 transition-colors cursor-pointer"
                    onClick={() => window.location.href = `/runs/${run.run_id}`}
                  >
                    <td className="px-6 py-4 text-xs font-mono text-accent">#{run.run_id.slice(0, 8)}</td>
                    <td className="px-6 py-4">
                      <p className="text-sm truncate max-w-[240px] text-muted-foreground group-hover:text-foreground transition-colors">
                        {run.user_input}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center">
                        <ScorePill score={run.score || 0} />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-xs font-mono text-muted">{(run.total_latency_ms / 1000).toFixed(1)}s</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 px-2">
              <Brain className="w-5 h-5 text-purple-400" />
              Memory Tiering
            </h2>
            <div className="bg-glass rounded-2xl p-6">
              <div className="h-48">
                <MemoryDistributionChart data={memory?.by_kind || {}} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 px-2">
              <Heart className="w-5 h-5 text-danger" />
              System Integrity
            </h2>
            <div className="bg-glass rounded-2xl p-6 space-y-4">
              <HealthStatusItem label="Ollama Backend" status={health?.dependencies.ollama || "unknown"} />
              <HealthStatusItem label="Memory Store" status={health?.dependencies.memory || "unknown"} />
              <HealthStatusItem label="Trace Store" status={health?.dependencies.traces || "unknown"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, suffix = "" }: any) {
  return (
    <div className="bg-glass rounded-2xl p-6 relative overflow-hidden group">
      <div className={cn("absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform", color)}>
        <Icon className="w-12 h-12" />
      </div>
      <div className="relative z-10 flex flex-col gap-1">
        <span className="text-xs font-bold text-muted uppercase tracking-widest">{label}</span>
        <div className="flex items-baseline gap-1">
          <motion.span 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("text-3xl font-mono font-bold")}
          >
            {value}
          </motion.span>
          <span className="text-xs text-muted font-mono">{suffix}</span>
        </div>
      </div>
    </div>
  );
}

function DispatchComposer({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;
    setSubmitting(true);
    try {
      const res = await api.createRun(input);
      window.location.href = `/runs/${res.run_id}`;
    } catch (err) {
      alert("Failed to dispatch: " + err);
      setSubmitting(false);
    }
  };

  return (
    <motion.div 
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="bg-glass border-accent/20 rounded-2xl p-6 mb-8 ring-1 ring-accent/20">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold flex items-center gap-2 text-accent">
              <Zap className="w-4 h-4" />
              Agent Dispatch
            </label>
            <button type="button" onClick={onClose} className="text-muted hover:text-foreground text-xs font-bold uppercase">Cancel</button>
          </div>
          <textarea 
            autoFocus 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-background/50 border border-border rounded-xl p-4 text-sm min-h-[100px] focus:ring-1 focus:ring-accent focus:border-accent outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider">⌘ + ENTER TO Dispatch</span>
            <button 
              disabled={isSubmitting}
              className="px-6 py-2 bg-accent text-accent-foreground font-bold rounded-lg disabled:opacity-50"
            >
              {isSubmitting ? "Dispatching..." : "Launch"}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 0.7 ? "bg-success" : score >= 0.4 ? "bg-gold" : "bg-danger";
  return (
    <div className={cn("px-2 py-0.5 rounded-full text-[10px] font-mono font-bold text-background uppercase", color)}>
      {score.toFixed(2)}
    </div>
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
    <div className={cn("px-2 py-0.5 rounded border text-[10px] font-bold uppercase inline-flex items-center gap-1.5", themes[status] || themes.running)}>
      {status}
    </div>
  );
}

function HealthStatusItem({ label, status }: { label: string, status: string }) {
  const isOk = status === "ok" || status === "enabled";
  const isError = status === "error" || status === "unreachable";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted uppercase">{status}</span>
        <div className={cn("w-2 h-2 rounded-full", isOk ? "bg-success" : isError ? "bg-danger" : "bg-muted")} />
      </div>
    </div>
  );
}

function MemoryDistributionChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));
  const COLORS = ["#7dd3fc", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb7185"];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical">
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" hide />
        <Tooltip 
          contentStyle={{ backgroundColor: "#091423", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: "12px" }} 
          cursor={{ fill: "transparent" }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

