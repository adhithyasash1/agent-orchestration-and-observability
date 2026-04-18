"use client";

import { Filter, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RunSummary } from "@/lib/types";
import { cn, formatScore, formatWhen, scoreTone } from "@/lib/utils";

type RunListProps = {
  runs: RunSummary[];
  selectedRunId: string | null;
  search: string;
  tagFilter: string;
  statusFilter: string;
  scoreMin: string;
  scoreMax: string;
  dateFrom: string;
  dateTo: string;
  starredOnly: boolean;
  onSearchChange: (value: string) => void;
  onTagFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onScoreMinChange: (value: string) => void;
  onScoreMaxChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onStarredOnlyChange: (value: boolean) => void;
  onToggleStar: (run: RunSummary) => void;
  onSelect: (runId: string) => void;
};

export function RunList({
  runs,
  selectedRunId,
  search,
  tagFilter,
  statusFilter,
  scoreMin,
  scoreMax,
  dateFrom,
  dateTo,
  starredOnly,
  onSearchChange,
  onTagFilterChange,
  onStatusFilterChange,
  onScoreMinChange,
  onScoreMaxChange,
  onDateFromChange,
  onDateToChange,
  onStarredOnlyChange,
  onToggleStar,
  onSelect
}: RunListProps) {
  return (
    <Card className="p-6">
      <CardHeader>
        <div>
          <CardTitle>Runs</CardTitle>
          <CardDescription>
            Search by prompt text, score, date, tag, or pinned state.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3">
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search prompts"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={tagFilter}
              onChange={(event) => onTagFilterChange(event.target.value)}
              placeholder="Filter by tag"
            />
            <label className="flex items-center gap-2 rounded-full border border-line bg-white/5 px-4 py-2 text-sm text-muted">
              <Filter className="h-4 w-4" />
              <select
                value={statusFilter}
                onChange={(event) => onStatusFilterChange(event.target.value)}
                className="w-full bg-transparent outline-none"
              >
                <option value="all">All statuses</option>
                <option value="ok">Ok</option>
                <option value="rejected">Rejected</option>
                <option value="error">Error</option>
                <option value="running">Running</option>
                <option value="timeout_synthesis">Timeout</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={scoreMin}
                onChange={(event) => onScoreMinChange(event.target.value)}
                placeholder="Min score"
              />
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={scoreMax}
                onChange={(event) => onScoreMaxChange(event.target.value)}
                placeholder="Max score"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} />
              <Input type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} />
            </div>
          </div>
          <Button variant={starredOnly ? "secondary" : "ghost"} onClick={() => onStarredOnlyChange(!starredOnly)} className="justify-start gap-2">
            <Star className={cn("h-4 w-4", starredOnly && "fill-gold text-gold")} />
            {starredOnly ? "Showing pinned runs only" : "Show pinned runs only"}
          </Button>
        </div>

        <div className="grid max-h-[760px] gap-3 overflow-y-auto pr-1">
          {runs.map((run) => (
            <div
              key={run.run_id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(run.run_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(run.run_id);
                }
              }}
              className={cn(
                "rounded-[24px] border border-line bg-white/5 p-4 text-left transition hover:border-accent/50 hover:bg-white/10",
                selectedRunId === run.run_id && "border-accent/80 bg-accent/10"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-white">{run.user_input || "(empty prompt)"}</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleStar(run);
                  }}
                  className="rounded-full p-1 transition hover:bg-white/10"
                >
                  <Star className={cn("h-4 w-4", run.starred ? "fill-gold text-gold" : "text-muted")} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge>{run.status}</Badge>
                <Badge className={scoreTone(run.score)}>score {formatScore(run.score)}</Badge>
                <Badge>{run.total_latency_ms ?? 0} ms</Badge>
                {run.tag ? <Badge>{run.tag}</Badge> : null}
                {run.session_id ? <Badge>session {run.session_id.slice(0, 8)}</Badge> : null}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>{formatWhen(run.started_at)}</span>
                <span>{run.prompt_version}</span>
              </div>
            </div>
          ))}
          {!runs.length ? (
            <div className="rounded-[24px] border border-dashed border-line px-4 py-12 text-center text-sm text-muted">
              No runs match the current filter.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
