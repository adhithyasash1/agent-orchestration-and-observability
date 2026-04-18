"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useParams } from "next/navigation";
import { 
  Brain, 
  Database, 
  Sparkles, 
  Wrench, 
  Shield, 
  RotateCcw, 
  Flag, 
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";

export default function TraceInspectorPage() {
  const { id } = useParams() as { id: string };
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"answer" | "context" | "transitions">("answer");

  const { data: run, isLoading } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get_run(id),
    refetchInterval: (query) => {
      // @ts-ignore
      return query.state.data?.status === "running" ? 500 : false;
    },
  });

  if (isLoading) return <RunSkeleton />;
  if (!run) return <div className="p-12 text-center text-muted">Run not found.</div>;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      {/* Header */}
      <div className="bg-glass rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-accent bg-accent/10 px-2 py-1 rounded">#{run.run_id}</span>
            <StatusBadge status={run.status} />
          </div>
          <h1 className="text-xl font-bold line-clamp-2 max-w-2xl">{run.user_input}</h1>
        </div>
        <div className="flex items-center gap-8 border-l border-border pl-8">
          <StatBox label="Score" value={run.score.toFixed(2)} color={run.score >= 0.7 ? "text-success" : "text-gold"} />
          <StatBox label="Latency" value={`${(run.total_latency_ms / 1000).toFixed(1)}s`} />
          <StatBox label="Reflections" value={run.reflection_count} />
        </div>
      </div>

      {run.status === "timeout_synthesis" && (
        <div className="bg-gold/10 border border-gold/20 rounded-xl p-4 flex items-center gap-3 text-gold">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">Step limit reached — this is a partial synthesis of retrieved context.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-8 items-start">
        {/* Left: Timeline (40%) */}
        <div className="lg:col-span-4 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted flex items-center gap-2 px-2">
            <Clock className="w-4 h-4" />
            Trace Timeline
          </h2>
          <div className="relative pl-6 space-y-4">
            <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-border -translate-x-1/2" />
            {run.events.map((event, idx) => (
              <TimelineEvent key={idx} event={event} />
            ))}
          </div>
        </div>

        {/* Right: Panels (60%) */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-glass rounded-2xl p-1 flex items-center gap-1">
            <TabButton active={activeTab === "answer"} onClick={() => setActiveTab("answer")}>Answer</TabButton>
            <TabButton active={activeTab === "context"} onClick={() => setActiveTab("context")}>Context</TabButton>
            <TabButton active={activeTab === "transitions"} onClick={() => setActiveTab("transitions")}>Transitions</TabButton>
          </div>

          <div className="bg-glass rounded-2xl min-h-[500px] overflow-hidden">
            {activeTab === "answer" && (
              <div className="p-8 space-y-8">
                <div className="prose prose-invert max-w-none">
                  <ReactMarkdown>{run.final_output || "No output generated yet."}</ReactMarkdown>
                </div>
                
                <div className="pt-8 border-t border-border grid grid-cols-2 gap-8">
                  <VerificationSummary verification={run.events.find(e => e.kind === "verify")?.attributes} />
                  <PromotionMode mode={run.flags} />
                </div>

                <div className="mt-8 pt-8 border-t border-border">
                  <FeedbackWidget runId={id} initialFeedback={run.user_feedback} />
                </div>
              </div>
            )}

            {activeTab === "context" && (
              <div className="p-6 space-y-8">
                <ContextSection title="Memory Hits" items={run.events.find(e => e.kind === "retrieve")?.output} />
                <ContextSection title="Tool Interactions" items={run.events.filter(e => e.kind === "tool_call")} />
              </div>
            )}

            {activeTab === "transitions" && (
              <div className="p-6 space-y-8">
                <div className="h-48">
                  <TransitionChart data={run.transitions} />
                </div>
                <TransitionTable transitions={run.transitions} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: any) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
      <span className="text-[10px] uppercase tracking-widest text-muted font-bold">{label}</span>
      <span className={cn("text-lg font-mono font-bold font-mono tracking-tight", color || "text-foreground")}>{value}</span>
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
    <div className={cn("px-2 py-0.5 rounded border text-[10px] font-bold uppercase", themes[status] || themes.running)}>
      {status}
    </div>
  );
}

function TabButton({ active, children, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex-1 py-1.5 px-4 text-xs font-bold rounded-xl transition-all",
        active ? "bg-accent text-accent-foreground shadow-lg" : "text-muted hover:text-foreground hover:bg-white/5"
      )}
    >
      {children}
    </button>
  );
}

function TimelineEvent({ event }: { event: any }) {
  const [isOpen, setOpen] = useState(false);
  
  const kinds = {
    understand: { icon: Brain, color: "text-blue-400", bg: "bg-blue-400/10" },
    retrieve: { icon: Database, color: "text-indigo-400", bg: "bg-indigo-400/10" },
    plan: { icon: Sparkles, color: "text-purple-400", bg: "bg-purple-400/10" },
    tool_call: { icon: Wrench, color: "text-amber-400", bg: "bg-amber-400/10" },
    verify: { icon: Shield, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    reflect: { icon: RotateCcw, color: "text-orange-400", bg: "bg-orange-400/10" },
    final: { icon: Flag, color: "text-teal-400", bg: "bg-teal-400/10" },
    error: { icon: AlertCircle, color: "text-danger", bg: "bg-danger/10" },
  };

  const config = kinds[event.kind as keyof typeof kinds] || kinds.understand;

  return (
    <div className="relative group">
      <div className={cn("absolute -left-6 top-1.5 w-5 h-5 rounded-full z-10 flex items-center justify-center border-2 border-background", config.bg, config.color)}>
        <config.icon className="w-3 h-3" />
      </div>
      
      <div className={cn(
        "bg-glass rounded-xl overflow-hidden transition-all duration-300",
        isOpen ? "ring-1 ring-white/10" : "hover:bg-white/5"
      )}>
        <button 
          onClick={() => setOpen(!isOpen)}
          className="w-full text-left p-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className={cn("text-[10px] font-bold uppercase tracking-wider", config.color)}>{event.kind}</span>
            <span className="text-xs text-muted font-mono">STEP {event.step}</span>
            {event.latency_ms && (
              <span className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-muted">{(event.latency_ms / 1000).toFixed(2)}s</span>
            )}
          </div>
          {isOpen ? <ChevronUp className="w-3 h-3 text-muted" /> : <ChevronDown className="w-3 h-3 text-muted" />}
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div 
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              className="px-3 pb-3 overflow-hidden"
            >
              {event.kind === "verify" && <VerifyEventDetail attributes={event.attributes} />}
              {event.kind === "plan" && <PlanEventDetail attributes={event.attributes} />}
              {event.kind === "reflect" && (
                <div className="p-3 bg-orange-400/5 border border-orange-400/10 rounded-lg text-xs leading-relaxed text-orange-200 italic">
                  "{event.attributes?.critique}"
                </div>
              )}
              
              <div className="mt-2 text-[10px] font-mono bg-black/40 p-3 rounded-lg overflow-x-auto border border-border">
                <pre className="text-muted-foreground">
                  {JSON.stringify({ input: event.input, output: event.output }, null, 2)}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function VerifyEventDetail({ attributes }: any) {
  const miscalibrated = attributes?.verifier_miscalibration;
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-success capitalize">Logic Score</span>
        <span className="text-lg font-mono font-bold text-success">{(attributes?.score * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-background border border-border rounded-full overflow-hidden">
        <div className="h-full bg-success transition-all duration-1000" style={{ width: `${attributes?.score * 100}%` }} />
      </div>
      {miscalibrated && (
        <div className="flex items-center gap-2 text-[10px] text-orange-400 bg-orange-400/5 px-2 py-1 rounded border border-orange-400/10">
          <AlertTriangle className="w-3 h-3" />
          Judge Blindness Detected (Miscalibrated)
        </div>
      )}
      {attributes?.judge_reason && (
        <p className="text-[11px] text-muted-foreground leading-relaxed italic border-l-2 border-border pl-3 mt-2">
          {attributes.judge_reason}
        </p>
      )}
    </div>
  );
}

function PlanEventDetail({ attributes }: any) {
  return (
    <div className="mb-3 p-3 bg-purple-400/5 border border-purple-400/10 rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-purple-400 uppercase">Action</span>
        <span className="text-xs font-semibold">{attributes?.action || "unknown"}</span>
      </div>
      {attributes?.goal && (
        <p className="text-[11px] text-muted leading-relaxed">
          <span className="font-bold text-white/50 pr-1">GOAL:</span>
          {attributes.goal}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-purple-400 uppercase">Confidence</span>
        <div className="flex-1 h-1 bg-background rounded-full overflow-hidden">
          <div className="h-full bg-purple-400" style={{ width: `${(attributes?.confidence || 0.5) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function ContextSection({ title, items }: { title: string, items: any }) {
  if (!items || (Array.isArray(items) && items.length === 0)) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-accent uppercase tracking-widest">{title}</h3>
      <div className="space-y-3">
        {Array.isArray(items) && items.map((item, idx) => (
          <div key={idx} className="bg-glass p-4 rounded-xl space-y-2 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted uppercase">
                {item.kind || (item.kind === 'tool_call' ? 'Tool Call' : 'Entry')}
              </span>
              {(item.salience || item.utility_score) && (
                <span className="text-[10px] font-mono text-accent">SAL: {(item.salience || 0.8).toFixed(2)}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors leading-relaxed">
              {item.text || item.output || JSON.stringify(item.input)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransitionChart({ data }: { data: any[] }) {
  const chartData = data.map((d, i) => ({
    step: i + 1,
    score: d.score || 0
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#7dd3fc" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#7dd3fc" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(153,172,196,0.1)" />
        <XAxis dataKey="step" hide />
        <YAxis domain={[0, 1]} hide />
        <Tooltip 
          contentStyle={{ backgroundColor: "#091423", border: "1px solid rgba(153,172,196,0.1)", borderRadius: "12px", fontSize: "12px" }} 
        />
        <Area type="monotone" dataKey="score" stroke="#7dd3fc" fillOpacity={1} fill="url(#colorScore)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function TransitionTable({ transitions }: { transitions: any[] }) {
  return (
    <div className="bg-glass rounded-xl overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-white/5 border-b border-border">
            <th className="px-4 py-2 text-[10px] font-bold text-muted uppercase">STEP</th>
            <th className="px-4 py-2 text-[10px] font-bold text-muted uppercase">Stage</th>
            <th className="px-4 py-2 text-[10px] font-bold text-muted uppercase text-center">Score</th>
            <th className="px-4 py-2 text-[10px] font-bold text-muted uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {transitions.map((t, i) => (
            <tr key={i} className="text-xs hover:bg-white/5 transition-colors">
              <td className="px-4 py-3 font-mono">{t.step}</td>
              <td className="px-4 py-3 font-semibold text-accent">{t.stage || 'synthesis'}</td>
              <td className="px-4 py-3 text-center">
                <span className={cn("font-mono font-bold", (t.score || 0) >= 0.7 ? "text-success" : "text-muted")}>
                  {(t.score || 0).toFixed(2)}
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={t.status || 'ok'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeedbackWidget({ runId, initialFeedback }: { runId: string, initialFeedback: any }) {
  const [rating, setRating] = useState(initialFeedback?.rating || 0);
  const [notes, setNotes] = useState(initialFeedback?.notes || "");
  const [hoverRating, setHoverRating] = useState(0);
  
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: any) => api.leaveFeedback(runId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", runId] });
      alert("Feedback saved!");
    }
  });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-widest text-muted">Run Feedback</h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button 
            key={star} 
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => setRating(star)}
            className="p-1 transition-all"
          >
            <Star className={cn("w-6 h-6", (hoverRating || rating) >= star ? "fill-gold text-gold" : "text-muted opacity-30")} />
          </button>
        ))}
      </div>
      <textarea 
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add observations about this run (grounding errors, style issues, etc.)..."
        className="w-full bg-background/50 border border-border rounded-xl p-4 text-sm min-h-[100px] outline-none focus:ring-1 focus:ring-accent"
      />
      <button 
        onClick={() => mutation.mutate({ rating, notes })}
        className="px-6 py-2 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase rounded-lg border border-border transition-colors"
      >
        {mutation.isPending ? "Saving..." : "Save Feedback"}
      </button>
    </div>
  );
}

function VerificationSummary({ verification }: any) {
  if (!verification) return null;
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold text-muted uppercase tracking-widest">Verifier Logic</h3>
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase">Correctness</span>
          <span className="text-xl font-bold font-mono text-success">{(verification.judge_correct || 0.8) * 100}%</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground uppercase">Grounding</span>
          <span className="text-xl font-bold font-mono text-accent">{(verification.grounding_overlap || 0.6) * 100}%</span>
        </div>
      </div>
    </div>
  );
}

function PromotionMode({ mode }: any) {
  return (
    <div className="text-right flex flex-col items-end gap-1">
      <span className="text-[10px] text-muted uppercase font-bold tracking-widest">Promotion Channel</span>
      <div className="flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-[10px] font-bold text-accent uppercase">
        <Sparkles className="w-3 h-3" />
        LLM Judge + Confidence Fallback
      </div>
    </div>
  );
}

function RunSkeleton() {
  return (
    <div className="space-y-8 animate-pulse p-12">
      <div className="h-32 bg-glass rounded-2xl w-full" />
      <div className="grid grid-cols-10 gap-8">
        <div className="col-span-4 space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-glass rounded-xl" />)}
        </div>
        <div className="col-span-6 h-[500px] bg-glass rounded-2xl" />
      </div>
    </div>
  );
}
