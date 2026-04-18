"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Cpu,
  ExternalLink,
  History,
  Paperclip,
  Send,
  X,
  File,
  Loader2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";

import { ErrorBoundary, PageError } from "@/components/error-boundary";
import { AGENT_STAGES, getStageLabel, type AgentStage } from "@/lib/constants";
import { api, BASE } from "@/lib/api";
import type { RunDetail, Tool, TraceEvent, UploadedFile } from "@/lib/types";
import { cn } from "@/lib/utils";

type UserMessage = {
  id: number;
  role: "user";
  user_input: string;
};

type ChatMessage = UserMessage | RunDetail;

const EVENT_KIND_TO_STAGE: Record<string, AgentStage> = {
  understand: "understand",
  retrieve: "retrieve",
  plan: "plan",
  tool_call: "tool_result",
  verify: "verify",
  reflect: "reflection",
  final: "final",
  error: "error",
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<TraceEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tools = [] } = useQuery({
    queryKey: ["tools"],
    queryFn: () => api.getTools(),
  });

  const dispatchMutation = useMutation({
    mutationFn: ({ text, files }: { text: string; files: string[] }) =>
      api.createRunAsync(text, { workspace_files: files }),
    onSuccess: (res) => {
      setCurrentRunId(res.run_id);
      setLiveEvents([]);
      setStreamError(null);
      setAttachedFiles([]); // Clear after sending
    },
  });

  useEffect(() => {
    if (!currentRunId) {
      return;
    }

    const es = new EventSource(`${BASE}/runs/${currentRunId}/stream`);

    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as TraceEvent | { done?: boolean; run?: RunDetail; error?: string };
      if ("done" in data && data.done) {
        if (data.run) {
          setMessages((prev) => [...prev.filter((message) => !("run_id" in message) || message.run_id !== currentRunId), data.run!]);
        }
        setCurrentRunId(null);
        setLiveEvents([]);
        setStreamError(null);
        es.close();
        return;
      }

      if ("error" in data && data.error) {
        setStreamError(data.error);
        setCurrentRunId(null);
        es.close();
        return;
      }

      setLiveEvents((prev) => [...prev, data as TraceEvent]);
    };

    es.onerror = () => {
      setStreamError("Live stream disconnected.");
      es.close();
    };

    return () => es.close();
  }, [currentRunId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveEvents]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const results = await Promise.all(
        Array.from(files).map((file) => api.uploadFile(file))
      );
      setAttachedFiles((prev) => [...prev, ...results]);
    } catch (error) {
      console.error("Upload failed", error);
      alert("Failed to upload one or more files.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (path: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || currentRunId || isUploading) {
      return;
    }

    const fileList = attachedFiles.map((f) => f.path);
    const userMessage: UserMessage = {
      role: "user",
      user_input: input || (attachedFiles.length > 0 ? `Uploaded ${attachedFiles.length} file(s)` : ""),
      id: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    dispatchMutation.mutate({ text: input, files: fileList });
    setInput("");
  };

  return (
    <ErrorBoundary fallback={<PageError />}>
      <div className="relative flex h-[calc(100vh-8rem)] flex-col animate-fade-in font-sans">
        <div ref={scrollRef} className="scrollbar-hide flex-1 space-y-8 overflow-y-auto pr-4">
          {messages.length === 0 && !currentRunId && <EmptyState tools={tools} />}

          {messages.map((message) => (
            <div key={"run_id" in message ? message.run_id : message.id}>
              {"role" in message ? (
                <UserMessage text={message.user_input} />
              ) : (
                <AgentMessage run={message} />
              )}
            </div>
          ))}

          {currentRunId && (
            <ThinkingIndicator runId={currentRunId} liveEvents={liveEvents} streamError={streamError} />
          )}
        </div>

        <div className="relative mt-8">
          <div className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-background to-transparent" />
          
          <div className="flex flex-wrap gap-2 mb-2 px-2">
            <AnimatePresence>
              {attachedFiles.map((file) => (
                <motion.div
                  key={file.path}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="group relative flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5"
                >
                  <File className="h-3 w-3 text-accent" />
                  <span className="text-[10px] font-medium truncate max-w-[120px]">
                    {file.filename || file.path.split("-").slice(1).join("-")}
                  </span>
                  <button
                    onClick={() => removeFile(file.path)}
                    className="ml-1 rounded-full p-0.5 hover:bg-white/10"
                  >
                    <X className="h-3 w-3 text-muted group-hover:text-foreground" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 rounded-2xl border border-white/10 bg-glass p-2 shadow-2xl transition-all focus-within:ring-1 focus-within:ring-accent/50"
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={Boolean(currentRunId) || isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl p-3 text-muted transition-all hover:bg-white/5 disabled:opacity-20"
            >
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Paperclip className="h-5 w-5" />
              )}
            </button>
            <textarea
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  handleSubmit(event);
                }
              }}
              placeholder="Ask anything or attach files... (Cmd/Ctrl+Enter to launch)"
              className="scrollbar-hide min-h-[44px] flex-1 resize-none border-none bg-transparent p-3 text-sm outline-none"
              disabled={Boolean(currentRunId)}
            />
            <button
              type="submit"
              disabled={(!input.trim() && attachedFiles.length === 0) || Boolean(currentRunId) || isUploading}
              className="rounded-xl bg-accent p-3 text-accent-foreground transition-all active:scale-95 disabled:opacity-20"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
          <div className="mt-2 flex justify-between px-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              {isUploading ? "Uploading docs..." : "Local Intel: Ready"}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{input.length} chars</span>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function EmptyState({ tools }: { tools: Tool[] }) {
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center space-y-6 pt-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 animate-pulse">
        <Bot className="h-8 w-8 text-accent" />
      </div>
      <div>
        <h2 className="text-xl font-bold">AgentOS Conversation</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Start a conversational research task. The agent will retrieve relevant history, run tools, and verify before it answers.
        </p>
      </div>

      <div className="w-full space-y-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Active Toolset</span>
        <div className="flex flex-wrap justify-center gap-2">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="rounded-full border border-border bg-white/5 px-3 py-1 text-[10px] font-bold uppercase text-accent"
            >
              {tool.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex justify-end pr-4">
      <div className="max-w-[80%] rounded-2xl border border-accent/20 bg-accent/10 px-5 py-3 text-sm text-foreground">
        {text}
      </div>
    </motion.div>
  );
}

function AgentMessage({ run }: { run: RunDetail }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex gap-4">
      <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-400/10">
        <Bot className="h-5 w-5 text-blue-400" />
      </div>
      <div className="flex-1 space-y-4">
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{run.final_output || "No output generated."}</ReactMarkdown>
        </div>

        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-muted">
          <div className="flex items-center gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-0.5 text-success">
            <Zap className="h-3 w-3" /> Score {(run.score || 0).toFixed(2)}
          </div>
          <div className="flex items-center gap-1.5 rounded border border-border bg-white/5 px-2 py-0.5">
            <History className="h-3 w-3" /> {run.transitions.length} stages
          </div>
          <Link
            href={`/runs/${run.run_id}`}
            className="ml-auto flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent transition-all hover:bg-accent/20"
          >
            Trace Inspector <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {run.status === "timeout_synthesis" && (
          <div className="flex w-fit items-center gap-2 rounded border border-gold/20 bg-gold/10 px-2 py-1 text-[10px] font-bold uppercase text-gold">
            <AlertTriangle className="h-3 w-3" /> Partial Synthesis
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ThinkingIndicator({
  runId,
  liveEvents,
  streamError,
}: {
  runId: string;
  liveEvents: TraceEvent[];
  streamError: string | null;
}) {
  const lastEvent = liveEvents[liveEvents.length - 1];
  const normalizedStage = (
    lastEvent ? EVENT_KIND_TO_STAGE[lastEvent.kind] ?? "understand" : "understand"
  ) as AgentStage;
  const currentLabel = streamError ? "Error" : getStageLabel(normalizedStage);
  const activeIndex = AGENT_STAGES.indexOf(normalizedStage);
  const toolName = lastEvent?.kind === "tool_call" ? lastEvent.name : undefined;

  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10">
        <Cpu className="h-5 w-5 text-accent animate-pulse" />
      </div>
      <div className="flex-1 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-tighter text-accent animate-pulse">
              {currentLabel}
            </span>
            <span className="text-[10px] font-mono uppercase text-muted">#{runId.slice(0, 8)}</span>
          </div>
          <p className="border-l-2 border-accent/20 pl-4 py-1 text-xs italic leading-relaxed text-muted">
            {streamError
              ? streamError
              : toolName
                ? `Calling ${toolName} and waiting for the result.`
                : `${currentLabel} phase in progress.`}
          </p>
        </div>

        <div className="flex gap-1">
          {AGENT_STAGES.filter((stage) => stage !== "reject").map((stage, index) => (
            <div
              key={stage}
              className={cn(
                "h-1 flex-1 rounded-full bg-white/5 transition-all duration-500",
                index <= activeIndex && "bg-accent shadow-[0_0_8px_rgba(125,211,252,0.5)]",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
