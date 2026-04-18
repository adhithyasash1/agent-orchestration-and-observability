"use client";

import { Paperclip, RefreshCcw, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { UploadedFile } from "@/lib/types";

const SAMPLE_PROMPTS = [
  "Calculate 19 * 17 and tell me whether the tool call was necessary.",
  "Using stored notes, what database powers agentos-core by default?",
  "Compare the last two research-tagged runs and summarize what changed.",
  "Read the uploaded file and give me the key takeaways."
];

type RunComposerProps = {
  value: string;
  tag: string;
  sessionId: string;
  files: UploadedFile[];
  onChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onSessionChange: (value: string) => void;
  onResetSession: () => void;
  onUpload: (file: File) => void;
  onSubmit: () => void;
  isPending: boolean;
  isUploading: boolean;
  statusText: string;
};

export function RunComposer({
  value,
  tag,
  sessionId,
  files,
  onChange,
  onTagChange,
  onSessionChange,
  onResetSession,
  onUpload,
  onSubmit,
  isPending,
  isUploading,
  statusText
}: RunComposerProps) {
  return (
    <Card className="p-6">
      <CardHeader>
        <div>
          <CardTitle>Launch A Run</CardTitle>
          <CardDescription>
            Send a prompt through planning, tools, verification, uploads, and multi-turn memory.
          </CardDescription>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 p-3 text-accent">
          <WandSparkles className="h-5 w-5" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input
            value={tag}
            onChange={(event) => onTagChange(event.target.value)}
            placeholder="Tag this run, for example research or coding"
          />
          <Input
            value={sessionId}
            onChange={(event) => onSessionChange(event.target.value)}
            placeholder="Conversation session id"
          />
          <Button variant="ghost" onClick={onResetSession} className="gap-2">
            <RefreshCcw className="h-4 w-4" />
            New Session
          </Button>
        </div>

        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask something that exercises planning, memory, or tools."
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white/5 px-4 py-2 text-sm text-white transition hover:border-accent/50">
            <Paperclip className="h-4 w-4" />
            <span>{isUploading ? "Uploading..." : "Upload File"}</span>
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onUpload(file);
                  event.currentTarget.value = "";
                }
              }}
            />
          </label>
          <Button onClick={onSubmit} disabled={isPending || !value.trim()}>
            {isPending ? "Running..." : "Run Agent"}
          </Button>
          <span className="text-sm text-muted">{statusText}</span>
        </div>

        {files.length ? (
          <div className="rounded-[24px] border border-line bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted">Workspace Files</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((file) => (
                <span key={file.path} className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">
                  {file.path}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {SAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onChange(prompt)}
              className="rounded-3xl border border-line bg-white/5 px-4 py-4 text-left text-sm text-muted transition hover:border-accent/60 hover:bg-white/10"
            >
              {prompt}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
