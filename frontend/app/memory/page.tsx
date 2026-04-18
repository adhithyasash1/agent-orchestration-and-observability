"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Link from "next/link";
import { 
  Database, 
  Search, 
  Trash2, 
  Plus, 
  Clock, 
  ShieldCheck, 
  Sparkles,
  Info,
  Layers,
  Activity,
  ChevronRight,
  AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore } from "@/lib/store";
import { ErrorBoundary, PageError } from "@/components/error-boundary";
import type { MemoryKind } from "@/lib/types";

const KINDS: MemoryKind[] = ["working", "episodic", "semantic", "experience", "style", "failure"];

export default function MemoryConsolePage() {
  const queryClient = useQueryClient();
  const { showToast } = useStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<MemoryKind[]>([]);

  const { data: stats } = useQuery({
    queryKey: ["memory-stats"],
    queryFn: () => api.getMemoryStats(),
    refetchInterval: 5000,
  });

  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ["memory-search", searchQuery, selectedKinds],
    queryFn: () => api.searchMemory({ 
      query: searchQuery, 
      kinds: selectedKinds.length ? selectedKinds : undefined,
      k: 10 
    }),
    enabled: searchQuery.length > 2,
  });

  const purgeMutation = useMutation({
    mutationFn: (kind: string) => api.purgeSystem(kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory-stats"] });
      showToast("Memory purged successfully", "success");
    },
  });

  const toggleKind = (kind: MemoryKind) => {
    setSelectedKinds(prev => 
      prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]
    );
  };

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="space-y-10 animate-fade-in pb-20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Memory Ecosystem</h1>
            <p className="text-muted mt-1">Cross-tier storage for experience, experience and semantic grounding.</p>
          </div>
          <div className="flex items-center gap-4 px-4 py-2 bg-glass rounded-xl border border-white/10">
            <Layers className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-mono font-bold">{stats?.count || 0} Total Vectors</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {KINDS.map((kind) => (
            <MemoryTierCard 
              key={kind}
              kind={kind}
              count={stats?.by_kind[kind] || 0}
              active={selectedKinds.includes(kind)}
              onClick={() => toggleKind(kind)}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-muted" />
              </div>
              <input 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Query semantic memory or search experiences..."
                className="w-full bg-background/50 border border-border rounded-xl pl-12 pr-4 py-4 text-sm focus:ring-1 focus:ring-accent outline-none"
              />
              {isSearching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xs font-bold text-muted uppercase tracking-widest">Search Results</h3>
                <div className="flex gap-2">
                  {KINDS.map(kind => (
                    <button 
                      key={kind}
                      onClick={() => toggleKind(kind)}
                      className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase border transition-all",
                        selectedKinds.includes(kind) ? "bg-accent border-accent text-accent-foreground" : "bg-white/5 border-border text-muted hover:text-foreground"
                      )}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {searchResults?.results?.map((res: any) => (
                    <SearchResultCard key={res.id} result={res} />
                  ))}
                  {!isSearching && searchQuery.length > 2 && searchResults?.results?.length === 0 && (
                    <div className="p-12 text-center text-muted text-sm bg-glass rounded-2xl border border-dashed border-border">
                      No results found in selected memory tiers for your query.
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-8">
            <section className="bg-glass rounded-2xl p-6 border border-border space-y-6">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent" />
                Memory Hygiene
              </h3>
              <div className="space-y-5">
                <HygieneAction 
                  label="Clear Working Tier" 
                  description="Removes intermediate step data from current sessions." 
                  onPurge={() => purgeMutation.mutate("working")}
                />
                <HygieneAction 
                  label="Vacuum Semantic" 
                  description="Compresses vector index and removes orphaned nodes." 
                  onPurge={() => purgeMutation.mutate("semantic")}
                />
                <HygieneAction 
                  label="Purge Experience" 
                  description="Wipes all agent journey experiences. Warning: Irreversible." 
                  danger
                  onPurge={() => purgeMutation.mutate("experience")}
                />
              </div>
            </section>

            <section className="bg-glass rounded-2xl p-6 border border-border space-y-4">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Info className="w-4 h-4 text-purple-400" />
                Tiering Logic
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                AgentOS uses a tiered memory architecture. Items with verifier scores {">"} 0.7 are promoted to <span className="text-accent">Episodic</span>. Successfully synthesized insights enter <span className="text-purple-400">Semantic</span> long-term storage.
              </p>
            </section>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function MemoryTierCard({ kind, count, active, onClick }: any) {
  const icons: Record<string, any> = {
    working: Clock,
    episodic: ShieldCheck,
    semantic: Database,
    experience: Sparkles,
    style: Activity,
    failure: AlertTriangle
  };
  const Icon = icons[kind] || Database;
  const descriptions: Record<string, string> = {
    working: "Volatile step data",
    episodic: "Verified run history",
    semantic: "Core factual knowledge",
    experience: "Synthesized wisdom",
    style: "Linguistic preferences",
    failure: "Negative patterns"
  };
  const description = descriptions[kind];

  return (
    <div 
      onClick={onClick}
      className={cn(
        "group relative p-4 rounded-2xl border transition-all cursor-pointer overflow-hidden active:scale-95",
        active ? "bg-accent/10 border-accent shadow-[0_0_15px_rgba(125,211,252,0.1)]" : "bg-glass border-white/5 hover:border-white/20"
      )}
    >
      <div className="flex flex-col gap-4 relative z-10">
        <div className={cn("p-2 rounded-lg w-fit", active ? "bg-accent text-accent-foreground" : "bg-white/5 text-muted")}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <span className={cn("text-2xl font-mono font-bold tabular-nums", active ? "text-accent" : "")}>{count}</span>
          <span className="text-xs font-bold uppercase tracking-widest text-muted group-hover:text-foreground transition-colors">{kind}</span>
        </div>
      </div>
      
      {/* Description Tooltip (Simplified) */}
      <div className="absolute inset-0 z-20 opacity-0 group-hover:opacity-100 bg-background/95 backdrop-blur-sm p-4 text-[10px] text-muted flex items-center justify-center text-center transition-all duration-300 pointer-events-none rounded-2xl border border-accent/20">
        {description}
      </div>
    </div>
  );
}

function SearchResultCard({ result }: { result: any }) {
  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="p-5 bg-glass border border-white/10 rounded-2xl group hover:border-accent/40 transition-all shadow-xl"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent font-mono font-bold uppercase border border-accent/20 tracking-widest">{result.kind}</span>
          <span className="text-[10px] text-muted font-mono">{new Date().toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Salience</span>
          <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${result.salience * 100}%` }} />
          </div>
          <span className="text-[10px] font-mono text-accent">{(result.salience * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="prose prose-sm prose-invert max-w-none">
        <p className="text-muted-foreground leading-relaxed italic group-hover:text-foreground transition-colors">
          "{result.text}"
        </p>
      </div>
      
      {result.run_id && (
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] text-muted font-mono uppercase">Origin: {result.run_id.slice(0, 8)}</span>
          <Link href={`/runs/${result.run_id}`} className="text-[10px] text-accent font-bold uppercase flex items-center gap-1 hover:underline">
            View Source <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </motion.div>
  );
}

function HygieneAction({ label, description, onPurge, danger }: any) {
  return (
    <div className="space-y-2 group">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
        <button 
          onClick={onPurge}
          className={cn(
            "p-2 rounded-lg transition-all", 
            danger ? "hover:bg-danger/10 text-danger" : "hover:bg-white/10 text-muted hover:text-foreground"
          )}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[10px] text-muted leading-relaxed">{description}</p>
      <div className="h-px bg-border w-full" />
    </div>
  );
}
