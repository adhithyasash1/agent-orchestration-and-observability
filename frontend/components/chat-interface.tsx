"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Settings } from "lucide-react";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { api } from "@/lib/api";
import { SettingsDialog } from "./settings-dialog";

export function ChatInterface() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.listRuns(50),
    refetchInterval: 5000,
  });

  const createRun = useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    },
  });

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0b0f19] text-white">
      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      <div className="sticky top-0 z-40 flex items-center justify-end border-b border-white/5 bg-white/2 px-6 py-4 backdrop-blur-xl">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="flex items-center gap-2 rounded-full p-2 text-xs font-medium text-muted transition-all hover:bg-white/10 hover:text-white"
        >
          <Settings className="h-4 w-4" /> Config
        </button>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-8 pb-32">
          {runs.map((run) => (
            <div key={run.run_id} className="space-y-6">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-[24px] bg-accent/20 px-6 py-4 text-[15px] leading-relaxed text-[#f3f4f6]">
                  {run.user_input}
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[100%] rounded-[24px] border border-white/5 bg-[#121826] px-6 py-5 text-[15px] leading-relaxed shadow-lg backdrop-blur-sm">
                  <ReactMarkdown>{run.final_output || "No output recorded yet."}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </main>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || createRun.isPending) {
            return;
          }
          createRun.mutate(input);
        }}
        className="sticky bottom-0 border-t border-white/5 bg-[#0b0f19]/90 px-6 py-4 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-3 rounded-[20px] border border-white/5 bg-[#121826] p-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-[72px] flex-1 resize-none bg-transparent text-sm outline-none"
            placeholder="Ask the agent something..."
          />
          <button
            type="submit"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
