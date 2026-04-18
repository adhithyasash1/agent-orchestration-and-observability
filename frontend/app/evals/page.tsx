"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Lightbulb, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useState } from "react";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { api } from "@/lib/api";
import type { EvalChartPoint } from "@/lib/types";

export default function EvaluationsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["eval-results"],
    queryFn: () => api.getEvalResults(),
  });

  const { data: toolStats } = useQuery({
    queryKey: ["tool-latency-stats"],
    queryFn: () => api.getToolLatencyStats(120),
  });

  const metrics = [
    { label: "Overall Score", value: data ? data.overall_score.toFixed(2) : "0.00" },
    { label: "Success Rate", value: data ? `${Math.round(data.success_rate * 100)}%` : "0%" },
    { label: "Mean Latency", value: data ? `${Math.round(data.mean_latency_ms)} ms` : "0 ms" },
    {
      label: "Tool Success",
      value: data ? `${Math.round(data.tool_call_success_rate * 100)}%` : "0%",
    },
    {
      label: "Reflection ROI",
      value: data ? `${(data.reflection_roi ?? 0).toFixed(2)}` : "0.00",
    },
  ];

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="flex h-full flex-col animate-fade-in bg-background font-sans">
        <header className="space-y-4 border-b border-border bg-background/90 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-[14px] font-bold text-foreground">Evaluation Console</h1>
              <p className="text-[12px] text-muted">Computed from local run history</p>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col space-y-8 overflow-auto p-6">
          {isLoading && <div className="h-64 animate-pulse rounded-2xl bg-glass" />}

          {data && (
            <>
              {data.runCount < 10 && (
                <div className="rounded-xl border border-gold/20 bg-gold/10 px-4 py-3 text-sm text-gold">
                  Evaluation data is computed from your local run history. For ablation benchmarks, run
                  {" "}
                  <code>python -m bench.runner --all-ablations</code>.
                </div>
              )}

              <section className="rounded-xl bg-glass p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-accent" />
                  <h2 className="text-[13px] font-bold uppercase tracking-widest text-foreground">
                    Local Run Metrics
                  </h2>
                </div>
                <div className="grid gap-4 md:grid-cols-5">
                  {metrics.map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-border bg-white/5 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">
                        {metric.label}
                      </div>
                      <div className="mt-2 text-[24px] font-bold tracking-tight text-foreground">
                        {metric.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {data.improvements.map((impact) => (
                  <div key={impact.label} className="rounded-xl border border-border bg-glass p-4">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                      {impact.label}
                    </div>
                    <div className="flex items-center gap-2">
                      {impact.type === "positive" && <TrendingUp className="h-5 w-5 text-success" />}
                      {impact.type === "negative" && <TrendingDown className="h-5 w-5 text-danger" />}
                      {impact.type === "neutral" && <Minus className="h-5 w-5 text-gold" />}
                      <span
                        className={
                          impact.type === "positive"
                            ? "text-[24px] font-bold tracking-tight text-success"
                            : impact.type === "negative"
                              ? "text-[24px] font-bold tracking-tight text-danger"
                              : "text-[24px] font-bold tracking-tight text-gold"
                        }
                      >
                        {impact.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <section className="flex h-[350px] flex-col rounded-xl border border-border bg-glass p-5 shadow-sm">
                  <h2 className="mb-6 text-[12px] font-bold uppercase tracking-wide text-muted">
                    Score Trend
                  </h2>
                  <div className="min-h-0 flex-1">
                    <EvalScoreChart data={data.chartData} />
                  </div>
                </section>

                <section className="flex h-[350px] flex-col rounded-xl border border-border bg-glass p-5 shadow-sm">
                  <h2 className="mb-6 text-[12px] font-bold uppercase tracking-wide text-muted">
                    Per-Tool Latency Breakdown
                  </h2>
                  <div className="min-h-0 flex-1">
                    <ToolLatencyChart
                      data={(toolStats ?? []).map((row) => ({
                        tool: row.tool,
                        avg_latency_ms: row.avg_latency_ms,
                      }))}
                    />
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

function EvalScoreChart({ data }: { data: EvalChartPoint[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-full w-full rounded-xl bg-white/5" />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="hsl(var(--muted))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          dy={10}
        />
        <YAxis
          stroke="hsl(var(--muted))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          domain={[0, 1]}
          tickFormatter={(value) => value.toFixed(2)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "12px",
            fontSize: "12px",
            color: "#fff",
          }}
          itemStyle={{ color: "hsl(var(--accent))" }}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="hsl(var(--accent))"
          strokeWidth={3}
          dot={{ fill: "hsl(var(--accent))", strokeWidth: 0, r: 4 }}
          activeDot={{ r: 6, fill: "hsl(var(--accent))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ToolLatencyChart({ data }: { data: Array<{ tool: string; avg_latency_ms: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
      <BarChart data={data}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="tool" stroke="hsl(var(--muted))" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="hsl(var(--muted))" fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "12px",
            fontSize: "12px",
          }}
        />
        <Bar dataKey="avg_latency_ms" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
