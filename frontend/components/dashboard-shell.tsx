"use client";

import { useDeferredValue, useEffect, useMemo, useState, startTransition } from "react";
import type { ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, BrainCircuit, Database, Radar } from "lucide-react";

import { RunComposer } from "@/components/run-composer";
import { RunDetail } from "@/components/run-detail";
import { RunList } from "@/components/run-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { RunComparison, UploadedFile } from "@/lib/types";
import { formatPercent, formatScore, scoreTone } from "@/lib/utils";

function newSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

export function DashboardShell() {
  const queryClient = useQueryClient();
  const {
    conversationSessionId,
    setConversationSessionId,
    showToast,
  } = useStore();

  const [prompt, setPrompt] = useState("");
  const [tag, setTag] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareTargetId, setCompareTargetId] = useState("");
  const [compareResult, setCompareResult] = useState<RunComparison | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!conversationSessionId) {
      setConversationSessionId(newSessionId());
    }
  }, [conversationSessionId, setConversationSessionId]);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.getHealth,
    refetchInterval: 15000
  });
  const memoryQuery = useQuery({
    queryKey: ["memory-stats"],
    queryFn: api.getMemoryStats,
    refetchInterval: 15000
  });
  const toolsQuery = useQuery({
    queryKey: ["tools"],
    queryFn: api.getTools
  });
  const runsQuery = useQuery({
    queryKey: [
      "runs",
      deferredSearch,
      tagFilter,
      scoreMin,
      scoreMax,
      dateFrom,
      dateTo,
      starredOnly,
      conversationSessionId,
    ],
    queryFn: () =>
      api.listRuns({
        limit: 120,
        search: deferredSearch || undefined,
        minScore: scoreMin ? Number(scoreMin) : undefined,
        maxScore: scoreMax ? Number(scoreMax) : undefined,
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
        starred: starredOnly || undefined,
        tag: tagFilter || undefined,
      }),
    refetchInterval: 15000
  });
  const runDetailQuery = useQuery({
    queryKey: ["run", selectedRunId],
    queryFn: () => api.getRun(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    refetchInterval: 15000
  });

  useEffect(() => {
    const firstRun = runsQuery.data?.[0];
    if (!firstRun) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !runsQuery.data?.some((run) => run.run_id === selectedRunId)) {
      setSelectedRunId(firstRun.run_id);
    }
  }, [runsQuery.data, selectedRunId]);

  useEffect(() => {
    setCompareResult(null);
    setCompareTargetId("");
  }, [selectedRunId]);

  const createRun = useMutation({
    mutationFn: () =>
      api.createRun(prompt, {
        tag: tag || undefined,
        session_id: conversationSessionId || undefined,
        workspace_files: uploadedFiles.map((file) => file.path),
      }),
    onSuccess: async (result) => {
      setPrompt("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["memory-stats"] })
      ]);
      const detail = await api.getRun(result.run_id);
      queryClient.setQueryData(["run", result.run_id], detail);
      startTransition(() => setSelectedRunId(result.run_id));
      showToast(`Run ${result.run_id} completed`, "success");
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadFile(file, conversationSessionId || undefined),
    onSuccess: (file) => {
      setUploadedFiles((prev) => [file, ...prev.filter((item) => item.path !== file.path)]);
      showToast(`Uploaded ${file.path}`, "success");
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const feedbackMutation = useMutation({
    mutationFn: (payload: { rating?: number; notes?: string }) =>
      api.leaveFeedback(selectedRunId as string, payload),
    onSuccess: async () => {
      if (selectedRunId) {
        const detail = await api.getRun(selectedRunId);
        queryClient.setQueryData(["run", selectedRunId], detail);
        queryClient.invalidateQueries({ queryKey: ["runs"] });
      }
    }
  });

  const patchRunMutation = useMutation({
    mutationFn: ({ runId, patch }: { runId: string; patch: { starred?: boolean; tag?: string | null; session_id?: string | null } }) =>
      api.patchRun(runId, patch),
    onSuccess: (detail) => {
      queryClient.setQueryData(["run", detail.run_id], detail);
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  const compareMutation = useMutation({
    mutationFn: ({ left, right }: { left: string; right: string }) => api.compareRuns(left, right),
    onSuccess: (data) => setCompareResult(data),
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const runs = useMemo(() => {
    return (runsQuery.data ?? []).filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [runsQuery.data, statusFilter]);

  const successRate =
    runs.length > 0
      ? runs.filter((run) => run.score >= 0.6).length / runs.length
      : 0;
  const averageScore =
    runs.length > 0
      ? runs.reduce((sum, run) => sum + (run.score ?? 0), 0) / runs.length
      : 0;

  const exportSelectedRun = async () => {
    if (!selectedRunId) return;
    try {
      const report = await api.exportRunReport(selectedRunId);
      const blob = new Blob([report], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedRunId}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast((error as Error).message, "error");
    }
  };

  return (
    <main className="min-h-screen bg-shell-glow px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]"
        >
          <Card className="p-7">
            <CardHeader>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-accent">Agentos Console</p>
                <CardTitle className="mt-3 text-4xl">Observe runs, compare traces, and keep a live conversation session.</CardTitle>
                <CardDescription className="mt-3 max-w-2xl text-base">
                  Search and pin important runs, attach workspace files, compare two traces side-by-side, and keep multi-turn context flowing through one session id.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{healthQuery.data?.status ?? "connecting"}</Badge>
                <Badge>{healthQuery.data?.config.profile ?? "profile"}</Badge>
                <Badge>{healthQuery.data?.config.llm_backend ?? "llm"}</Badge>
                <Badge>{healthQuery.data?.config.prompt_version ?? "prompt"}</Badge>
                <Badge>session {(conversationSessionId ?? "pending").slice(0, 8)}</Badge>
              </div>
            </CardHeader>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              icon={Activity}
              label="Visible Runs"
              value={String(runs.length)}
              detail="filtered from SQL-backed history"
            />
            <MetricCard
              icon={BrainCircuit}
              label="Success Rate"
              value={formatPercent(successRate)}
              detail="score ≥ 0.60"
            />
            <MetricCard
              icon={Radar}
              label="Avg Score"
              value={formatScore(averageScore)}
              detail="visible run average"
              tone={scoreTone(averageScore)}
            />
            <MetricCard
              icon={Database}
              label="Memory Rows"
              value={String(memoryQuery.data?.count ?? 0)}
              detail={`working ${memoryQuery.data?.by_kind.working ?? 0} • episodic ${memoryQuery.data?.by_kind.episodic ?? 0} • semantic ${memoryQuery.data?.by_kind.semantic ?? 0}`}
            />
          </div>
        </motion.section>

        <section className="grid gap-5 xl:grid-cols-[0.92fr_0.88fr_1.2fr]">
          <div className="space-y-5">
            <RunComposer
              value={prompt}
              tag={tag}
              sessionId={conversationSessionId ?? ""}
              files={uploadedFiles}
              onChange={setPrompt}
              onTagChange={setTag}
              onSessionChange={setConversationSessionId}
              onResetSession={() => {
                setConversationSessionId(newSessionId());
                setUploadedFiles([]);
              }}
              onUpload={(file) => uploadMutation.mutate(file)}
              onSubmit={() => createRun.mutate()}
              isPending={createRun.isPending}
              isUploading={uploadMutation.isPending}
              statusText={
                createRun.isSuccess
                  ? `Latest score ${formatScore(createRun.data?.score)} • ${createRun.data?.latency_ms ?? 0} ms`
                  : createRun.isError
                    ? (createRun.error as Error).message
                    : "Upload files, set a tag, or keep the same session for multi-turn memory."
              }
            />
            <Card className="p-6">
              <CardHeader>
                <div>
                  <CardTitle>Runtime Status</CardTitle>
                  <CardDescription>Health checks, feature flags, and tool registry.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(healthQuery.data?.dependencies ?? {}).map(([key, value]) => (
                    <Badge key={key}>
                      {key}: {value}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(healthQuery.data?.config.flags ?? {}).map(([key, value]) => (
                    <Badge key={key}>{key}: {value ? "on" : "off"}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(toolsQuery.data ?? []).map((tool) => (
                    <Badge key={tool.name}>
                      {tool.name}
                      {tool.timeout ? ` • ${tool.timeout}s` : ""}
                      {tool.retry_budget ? ` • retry ${tool.retry_budget}` : ""}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <RunList
            runs={runs}
            selectedRunId={selectedRunId}
            search={search}
            tagFilter={tagFilter}
            statusFilter={statusFilter}
            scoreMin={scoreMin}
            scoreMax={scoreMax}
            dateFrom={dateFrom}
            dateTo={dateTo}
            starredOnly={starredOnly}
            onSearchChange={setSearch}
            onTagFilterChange={setTagFilter}
            onStatusFilterChange={setStatusFilter}
            onScoreMinChange={setScoreMin}
            onScoreMaxChange={setScoreMax}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onStarredOnlyChange={setStarredOnly}
            onToggleStar={(run) =>
              patchRunMutation.mutate({
                runId: run.run_id,
                patch: { starred: !run.starred },
              })
            }
            onSelect={(runId) => startTransition(() => setSelectedRunId(runId))}
          />

          <RunDetail
            run={runDetailQuery.data}
            compare={compareResult}
            compareTargetId={compareTargetId}
            isPending={runDetailQuery.isPending}
            feedbackPending={feedbackMutation.isPending}
            onSubmitFeedback={(payload) => feedbackMutation.mutate(payload)}
            onToggleStar={(starred) => {
              if (!selectedRunId) return;
              patchRunMutation.mutate({ runId: selectedRunId, patch: { starred } });
            }}
            onTagSave={(nextTag) => {
              if (!selectedRunId) return;
              patchRunMutation.mutate({ runId: selectedRunId, patch: { tag: nextTag || null } });
            }}
            onCompareTargetChange={setCompareTargetId}
            onCompare={() => {
              if (!selectedRunId || !compareTargetId.trim()) return;
              compareMutation.mutate({ left: selectedRunId, right: compareTargetId.trim() });
            }}
            onExport={exportSelectedRun}
          />
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">{label}</p>
            <p className={`mt-3 font-serif text-4xl tracking-[-0.04em] ${tone ?? "text-white"}`}>{value}</p>
            <p className="mt-2 text-sm text-muted">{detail}</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 p-3 text-accent">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
