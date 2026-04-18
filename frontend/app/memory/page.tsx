"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Database,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { MemoryEntry, MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS: MemoryKind[] = ["working", "episodic", "semantic", "experience", "style", "failure"];

const EMPTY_FORM = {
  text: "",
  kind: "working",
  salience: "0.5",
  meta: "{}",
};

export default function MemoryConsolePage() {
  const queryClient = useQueryClient();
  const { showToast } = useStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<MemoryKind[]>([]);
  const [editingEntry, setEditingEntry] = useState<MemoryEntry | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const statsQuery = useQuery({
    queryKey: ["memory-stats"],
    queryFn: () => api.getMemoryStats(),
    refetchInterval: 5000,
  });

  const memoryQuery = useQuery({
    queryKey: ["memory-list", searchQuery, selectedKinds],
    queryFn: () =>
      api.listMemory({
        limit: 120,
        query: searchQuery || undefined,
        kind: selectedKinds.length === 1 ? selectedKinds[0] : undefined,
      }),
  });

  const searchResults = useMemo(() => {
    const entries = memoryQuery.data ?? [];
    if (!selectedKinds.length) {
      return entries;
    }
    return entries.filter((entry) => selectedKinds.includes(entry.kind as MemoryKind));
  }, [memoryQuery.data, selectedKinds]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        text: form.text,
        kind: form.kind,
        salience: Number(form.salience),
        meta: JSON.parse(form.meta || "{}"),
      };
      if (editingEntry) {
        return api.patchMemory(editingEntry.id, payload);
      }
      return api.createMemory(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory-list"] });
      queryClient.invalidateQueries({ queryKey: ["memory-stats"] });
      setEditingEntry(null);
      setForm(EMPTY_FORM);
      showToast("Memory entry saved", "success");
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: number) => api.deleteMemory(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory-list"] });
      queryClient.invalidateQueries({ queryKey: ["memory-stats"] });
      showToast("Memory entry deleted", "success");
    },
    onError: (error: Error) => showToast(error.message, "error"),
  });

  const toggleKind = (kind: MemoryKind) => {
    setSelectedKinds((prev) =>
      prev.includes(kind) ? prev.filter((item) => item !== kind) : [...prev, kind]
    );
  };

  const startEditing = (entry: MemoryEntry | null) => {
    setEditingEntry(entry);
    if (!entry) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      text: entry.text,
      kind: entry.kind,
      salience: String(entry.salience),
      meta: JSON.stringify(entry.meta ?? {}, null, 2),
    });
  };

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="space-y-10 animate-fade-in pb-20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Memory Console</h1>
            <p className="text-muted mt-1">Search memory, edit entries manually, and inspect salience distribution.</p>
          </div>
          <div className="flex items-center gap-4 px-4 py-2 bg-glass rounded-xl border border-white/10">
            <Database className="w-4 h-4 text-accent" />
            <span className="text-sm font-mono font-bold">{statsQuery.data?.count || 0} Entries</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              className={cn(
                "rounded-2xl border p-4 text-left transition-all",
                selectedKinds.includes(kind)
                  ? "border-accent bg-accent/10"
                  : "border-white/10 bg-glass hover:border-white/20"
              )}
            >
              <div className="text-xs uppercase tracking-widest text-muted">{kind}</div>
              <div className="mt-3 text-2xl font-mono font-bold">{statsQuery.data?.by_kind[kind] ?? 0}</div>
            </button>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-muted" />
              </div>
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search memory text"
                className="pl-12"
              />
            </div>

            <div className="rounded-2xl border border-border bg-glass p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">Salience Histogram</h3>
                <span className="text-xs text-muted">from `/memory/stats`</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                  <BarChart data={statsQuery.data?.salience_histogram ?? []}>
                    <XAxis dataKey="bucket" stroke="hsl(var(--muted))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "12px",
                      }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-3">
              {(searchResults ?? []).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-white/10 bg-glass p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] uppercase tracking-widest text-accent">
                          {entry.kind}
                        </span>
                        <span className="text-xs text-muted">salience {entry.salience.toFixed(2)}</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm text-white">{entry.text}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="rounded-full p-2 hover:bg-white/10" onClick={() => startEditing(entry)}>
                        <Pencil className="h-4 w-4 text-muted" />
                      </button>
                      <button className="rounded-full p-2 hover:bg-danger/10" onClick={() => deleteMutation.mutate(entry.id)}>
                        <Trash2 className="h-4 w-4 text-danger" />
                      </button>
                    </div>
                  </div>
                  {entry.meta && Object.keys(entry.meta).length ? (
                    <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-xs text-muted">
                      {JSON.stringify(entry.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-glass p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">{editingEntry ? `Edit #${editingEntry.id}` : "New Memory Entry"}</h3>
                <Button variant="ghost" onClick={() => startEditing(null)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              </div>
              <div className="space-y-3">
                <Input
                  value={form.kind}
                  onChange={(event) => setForm((prev) => ({ ...prev, kind: event.target.value }))}
                  placeholder="kind"
                />
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.salience}
                  onChange={(event) => setForm((prev) => ({ ...prev, salience: event.target.value }))}
                  placeholder="salience"
                />
                <Textarea
                  value={form.text}
                  onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
                  placeholder="memory text"
                  className="min-h-40"
                />
                <Textarea
                  value={form.meta}
                  onChange={(event) => setForm((prev) => ({ ...prev, meta: event.target.value }))}
                  placeholder="JSON metadata"
                  className="min-h-36"
                />
                <Button onClick={() => saveMutation.mutate()} className="w-full gap-2">
                  <Save className="h-4 w-4" />
                  {saveMutation.isPending ? "Saving..." : "Save Entry"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
