"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Download, MessageSquareWarning, SplitSquareVertical, Star, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getStageLabel } from "@/lib/constants";
import type { RunComparison, RunDetail as RunDetailType } from "@/lib/types";
import { cn, formatScore, formatWhen, scoreTone } from "@/lib/utils";

type RunDetailProps = {
  run: RunDetailType | undefined;
  compare: RunComparison | null;
  compareTargetId: string;
  isPending: boolean;
  feedbackPending: boolean;
  onSubmitFeedback: (payload: { rating?: number; notes?: string }) => void;
  onToggleStar: (starred: boolean) => void;
  onTagSave: (tag: string) => void;
  onCompareTargetChange: (value: string) => void;
  onCompare: () => void;
  onExport: () => void;
};

export function RunDetail({
  run,
  compare,
  compareTargetId,
  isPending,
  feedbackPending,
  onSubmitFeedback,
  onToggleStar,
  onTagSave,
  onCompareTargetChange,
  onCompare,
  onExport
}: RunDetailProps) {
  const [notes, setNotes] = useState("");
  const [tag, setTag] = useState("");

  useEffect(() => {
    setTag(run?.tag ?? "");
  }, [run?.run_id, run?.tag]);

  const toolLatency = useMemo(() => {
    if (!run) return [];
    return run.events
      .filter((event) => event.kind === "tool_call")
      .map((event) => ({
        name: event.name ?? "tool",
        latency: event.latency_ms ?? 0,
      }));
  }, [run]);

  if (isPending && !run) {
    return (
      <Card className="p-6">
        <div className="rounded-[28px] border border-dashed border-line px-4 py-24 text-center text-sm text-muted">
          Loading run details...
        </div>
      </Card>
    );
  }

  if (!run) {
    return (
      <Card className="p-6">
        <div className="rounded-[28px] border border-dashed border-line px-4 py-24 text-center text-sm text-muted">
          Select a run to inspect events, transitions, exports, and comparison.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <CardHeader>
        <div>
          <CardTitle>Trace Breakdown</CardTitle>
          <CardDescription>
            Run {run.run_id} • {formatWhen(run.started_at)} • {run.prompt_version}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{run.status}</Badge>
          <Badge className={scoreTone(run.score)}>score {formatScore(run.score)}</Badge>
          <Badge>{run.events.length} events</Badge>
          <Badge>{run.transitions.length} transitions</Badge>
          {run.session_id ? <Badge>session {run.session_id.slice(0, 8)}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <Input
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            onBlur={() => onTagSave(tag)}
            placeholder="Run tag"
          />
          <Button variant="ghost" onClick={() => onToggleStar(!run.starred)} className="gap-2">
            <Star className={cn("h-4 w-4", run.starred && "fill-gold text-gold")} />
            {run.starred ? "Pinned" : "Pin Run"}
          </Button>
          <Button variant="secondary" onClick={onExport} className="gap-2">
            <Download className="h-4 w-4" />
            Export Report
          </Button>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[24px] border border-line bg-white/5 p-5"
        >
          <div className="text-xs uppercase tracking-[0.2em] text-muted">Final Answer</div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-white">{run.final_output || "(no final answer recorded)"}</p>
        </motion.section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-line bg-white/5 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm text-white">
              <Workflow className="h-4 w-4 text-accent" />
              RL transitions
            </div>
            <div className="grid max-h-[320px] gap-3 overflow-y-auto pr-1">
              {run.transitions.map((transition) => (
                <details
                  key={`${transition.step}-${transition.stage}`}
                  className="rounded-[20px] border border-white/10 bg-[#09111d] p-4"
                >
                  <summary className="cursor-pointer list-none text-sm text-white">
                    {transition.step}. {getStageLabel(transition.stage)} • status {transition.status ?? "n/a"} • score{" "}
                    {formatScore(transition.score)}
                  </summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {JSON.stringify(
                      {
                        state: transition.state,
                        action: transition.action,
                        observation: transition.observation,
                        attributes: transition.attributes
                      },
                      null,
                      2
                    )}
                  </pre>
                </details>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-line bg-white/5 p-5">
              <div className="mb-3 flex items-center gap-2 text-sm text-white">
                <MessageSquareWarning className="h-4 w-4 text-gold" />
                Feedback
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => onSubmitFeedback({ rating: 5, notes })}
                    disabled={feedbackPending}
                  >
                    Useful
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onSubmitFeedback({ rating: 2, notes })}
                    disabled={feedbackPending}
                  >
                    Needs work
                  </Button>
                </div>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional notes for this run"
                  className="min-h-28"
                />
                {run.user_feedback ? (
                  <div className="rounded-[20px] border border-white/10 bg-[#09111d] p-4 text-sm text-muted">
                    Stored feedback: rating {run.user_feedback.rating ?? "n/a"}
                    {run.user_feedback.notes ? ` • ${run.user_feedback.notes}` : ""}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[24px] border border-line bg-white/5 p-5">
              <div className="mb-3 text-sm text-white">Per-tool latency</div>
              <div className="space-y-2">
                {toolLatency.length ? toolLatency.map((tool) => (
                  <div key={`${tool.name}-${tool.latency}`} className="flex items-center justify-between rounded-full border border-white/10 bg-[#09111d] px-4 py-2 text-sm">
                    <span>{tool.name}</span>
                    <span className="font-mono text-accent">{tool.latency} ms</span>
                  </div>
                )) : (
                  <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
                    No tool calls recorded for this run.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-line bg-white/5 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm text-white">
            <SplitSquareVertical className="h-4 w-4 text-accent" />
            Run Comparison
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input
              value={compareTargetId}
              onChange={(event) => onCompareTargetChange(event.target.value)}
              placeholder="Enter another run id to compare"
            />
            <Button variant="secondary" onClick={onCompare}>
              Compare
            </Button>
          </div>
          {compare ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[20px] border border-white/10 bg-[#09111d] p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Left</div>
                <div className="text-sm font-semibold text-white">{compare.left.run_id}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted">{compare.left.final_output || "(empty)"}</div>
                <div className="mt-4 space-y-2">
                  {compare.left.events.map((event) => (
                    <div key={`left-${event.id ?? `${event.step}-${event.kind}`}`} className="rounded-full border border-white/10 px-3 py-2 text-xs text-muted">
                      {event.step}. {event.kind} • {event.name ?? "event"} • {event.latency_ms ?? 0} ms
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-[#09111d] p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Right</div>
                <div className="text-sm font-semibold text-white">{compare.right.run_id}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted">{compare.right.final_output || "(empty)"}</div>
                <div className="mt-4 space-y-2">
                  {compare.right.events.map((event) => (
                    <div key={`right-${event.id ?? `${event.step}-${event.kind}`}`} className="rounded-full border border-white/10 px-3 py-2 text-xs text-muted">
                      {event.step}. {event.kind} • {event.name ?? "event"} • {event.latency_ms ?? 0} ms
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[20px] border border-accent/20 bg-accent/10 p-4 text-sm text-white lg:col-span-2">
                Score delta {compare.summary.score_delta.toFixed(2)} • latency delta {compare.summary.latency_delta_ms} ms • event delta {compare.summary.event_delta} • transition delta {compare.summary.transition_delta}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-[24px] border border-line bg-white/5 p-5">
          <div className="mb-3 text-sm text-white">Trace events</div>
          <div className="grid max-h-[320px] gap-3 overflow-y-auto pr-1">
            {run.events.map((event) => (
              <details
                key={`${event.step}-${event.kind}-${event.name}`}
                className="rounded-[20px] border border-white/10 bg-[#09111d] p-4"
              >
                <summary className="cursor-pointer list-none text-sm text-white">
                  {event.step}. {event.kind} • {event.name ?? "event"} • {event.latency_ms ?? 0} ms
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                  {JSON.stringify(
                    {
                      input: event.input,
                      output: event.output,
                      attributes: event.attributes,
                      error: event.error
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
