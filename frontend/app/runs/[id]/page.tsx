"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Database,
  Sparkles,
  Star,
  Wrench,
  XCircle,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { BASE, api } from "@/lib/api";
import { getStageLabel } from "@/lib/constants";
import type { RunDetail, TraceEvent } from "@/lib/types";
import { cn, formatScore, formatWhen } from "@/lib/utils";

export default function TraceInspectorPage() {
  const { id } = useParams() as { id: string };
  const queryClient = useQueryClient();
  const [run, setRun] = useState<RunDetail | null>(null);

  const { data: initialRun, isLoading } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.getRun(id),
  });

  useEffect(() => {
    if (initialRun) {
      setRun(initialRun);
    }
  }, [initialRun]);

  useEffect(() => {
    if (!run || run.status !== "running") {
      return;
    }

    const es = new EventSource(`${BASE}/runs/${run.run_id}/stream`);
    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as TraceEvent | { done?: boolean; run?: RunDetail; error?: string };
      if ("done" in data && data.done) {
        if (data.run) {
          setRun(data.run);
          queryClient.setQueryData(["run", id], data.run);
        }
        es.close();
        return;
      }
      if ("error" in data && data.error) {
        es.close();
        return;
      }
      const traceEvent = data as TraceEvent;
      setRun((prev) =>
        prev
          ? {
              ...prev,
              events: [...prev.events.filter((item) => item.id !== traceEvent.id), traceEvent],
            }
          : prev,
      );
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [id, queryClient, run?.run_id, run?.status]);

  if (isLoading || !run) {
    return <div className="h-96 animate-pulse rounded-2xl bg-glass" />;
  }

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="space-y-6 animate-fade-in pb-20">
        <Link 
          href="/runs"
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted transition-colors hover:text-accent"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Console
        </Link>
        <div className="flex flex-col justify-between gap-6 rounded-2xl bg-glass p-6 md:flex-row md:items-center">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="rounded bg-accent/10 px-2 py-1 text-xs font-mono text-accent">#{run.run_id}</span>
              <StatusBadge status={run.status} />
            </div>
            <h1 className="max-w-2xl text-xl font-bold">{run.user_input}</h1>
            <p className="text-sm text-muted">{formatWhen(run.started_at)}</p>
          </div>
          <div className="grid grid-cols-3 gap-6 border-l border-border pl-8">
            <StatBox label="Score" value={formatScore(run.score)} />
            <StatBox label="Latency" value={`${Math.round(run.total_latency_ms || 0)} ms`} />
            <StatBox label="Reflections" value={String(run.reflection_count || 0)} />
          </div>
        </div>

        {run.status === "timeout_synthesis" && (
          <div className="flex items-center gap-3 rounded-xl border border-gold/20 bg-gold/10 p-4 text-gold">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm font-medium">Step limit reached. This answer is the best synthesis available at timeout.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-10">
          <div className="space-y-4 lg:col-span-4">
            <h2 className="flex items-center gap-2 px-2 text-sm font-bold uppercase tracking-widest text-muted">
              <Clock className="h-4 w-4" />
              Live Events
            </h2>
            <div className="space-y-3">
              {run.events.map((event) => (
                <EventCard key={`${event.id ?? event.step}-${event.kind}`} event={event} />
              ))}
            </div>
          </div>

          <div className="space-y-6 lg:col-span-6">
            <section className="rounded-2xl bg-glass p-8">
              <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
                <Bot className="h-4 w-4 text-accent" />
                Final Answer
              </div>
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown>{run.final_output || "No final answer recorded yet."}</ReactMarkdown>
              </div>
            </section>

            <section className="grid gap-6 md:grid-cols-2">
              <VerificationCard run={run} />
              <FeedbackCard run={run} />
            </section>

            <section className="rounded-2xl bg-glass p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
                <Sparkles className="h-4 w-4 text-accent" />
                Transitions
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border bg-white/5">
                      <th className="px-4 py-2 text-[10px] font-bold uppercase text-muted">Step</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase text-muted">Stage</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase text-muted">Status</th>
                      <th className="px-4 py-2 text-right text-[10px] font-bold uppercase text-muted">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {run.transitions.map((transition) => (
                      <tr key={`${transition.id ?? transition.step}-${transition.stage}`} className="text-xs">
                        <td className="px-4 py-3 font-mono">{transition.step}</td>
                        <td className="px-4 py-3 font-semibold text-accent">{getStageLabel(transition.stage)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={transition.status || "ok"} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{formatScore(transition.score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[80px] flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</span>
      <span className="text-lg font-bold tracking-tight">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const themes: Record<string, string> = {
    running: "text-accent border-accent/20 bg-accent/5",
    ok: "text-success border-success/20 bg-success/5",
    timeout_synthesis: "text-gold border-gold/20 bg-gold/5",
    error: "text-danger border-danger/20 bg-danger/5",
    retry: "text-gold border-gold/20 bg-gold/5",
    pass: "text-success border-success/20 bg-success/5",
    planned: "text-accent border-accent/20 bg-accent/5",
  };
  return (
    <div className={cn("inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase", themes[status] || themes.running)}>
      {status}
    </div>
  );
}

function EventCard({ event }: { event: TraceEvent }) {
  const icon =
    event.kind === "understand"
      ? Brain
      : event.kind === "retrieve"
        ? Database
        : event.kind === "tool_call"
          ? Wrench
          : event.kind === "verify"
            ? CheckCircle2
            : event.kind === "error"
              ? XCircle
              : Sparkles;
  const Icon = icon;

  return (
    <div className="rounded-xl border border-border bg-glass p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-accent/10 p-2 text-accent">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-muted">{event.kind}</div>
            <div className="text-sm font-semibold">{event.name || "event"}</div>
          </div>
        </div>
        <div className="text-xs font-mono text-muted">{event.latency_ms ?? 0} ms</div>
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[11px] text-muted-foreground">
        {JSON.stringify({ input: event.input, output: event.output, error: event.error }, null, 2)}
      </pre>
    </div>
  );
}

function VerificationCard({ run }: { run: RunDetail }) {
  const verifyEvent = run.events.find((event) => event.kind === "verify");
  const attributes = (verifyEvent?.attributes ?? {}) as Record<string, number | string | boolean | null | undefined>;

  return (
    <div className="rounded-2xl bg-glass p-6">
      <div className="mb-3 text-sm font-bold text-foreground">Verification</div>
      <div className="space-y-2 text-sm text-muted">
        <div>Mode: {String(attributes.mode || "unknown")}</div>
        <div>Correctness: {Math.round(Number(attributes.judge_correct || 0) * 100)}%</div>
        <div>Grounding: {Math.round(Number(attributes.grounding_overlap || 0) * 100)}%</div>
        <div>Reflection ROI: {(run.reflection_roi || 0).toFixed(2)}</div>
      </div>
    </div>
  );
}

function FeedbackCard({ run }: { run: RunDetail }) {
  const [rating, setRating] = useState(run.user_feedback?.rating || 0);
  const [notes, setNotes] = useState(run.user_feedback?.notes || "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.leaveFeedback(run.run_id, { rating, notes }),
    onSuccess: async () => {
      const freshRun = await api.getRun(run.run_id);
      queryClient.setQueryData(["run", run.run_id], freshRun);
    },
  });

  return (
    <div className="rounded-2xl bg-glass p-6">
      <div className="mb-3 text-sm font-bold text-foreground">Run Feedback</div>
      <div className="mb-4 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button key={star} type="button" onClick={() => setRating(star)} className="p-1">
            <Star className={cn("h-5 w-5", rating >= star ? "fill-gold text-gold" : "text-muted opacity-30")} />
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Add notes about grounding, correctness, or style."
        className="min-h-[100px] w-full rounded-xl border border-border bg-background/50 p-4 text-sm outline-none focus:ring-1 focus:ring-accent"
      />
      <button
        type="button"
        onClick={() => mutation.mutate()}
        className="mt-4 rounded-lg border border-border bg-white/5 px-4 py-2 text-xs font-bold uppercase transition-colors hover:bg-white/10"
      >
        {mutation.isPending ? "Saving..." : "Save Feedback"}
      </button>
    </div>
  );
}
