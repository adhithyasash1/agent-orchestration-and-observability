"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Settings, X } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function SettingsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: config } = useQuery({
    queryKey: ["dialog-config"],
    queryFn: () => api.getConfig(),
    enabled: isOpen,
  });

  const patchConfig = useMutation({
    mutationFn: api.patchConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(["dialog-config"], data.current);
      queryClient.setQueryData(["config"], data.current);
    },
  });

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-xl overflow-hidden rounded-[24px] border border-white/10 bg-[#0F1117] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/5 bg-white/2 px-6 py-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white">Agent Configuration</h2>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 transition-colors hover:bg-white/5">
              <X className="h-4 w-4 text-muted" />
            </button>
          </div>

          <div className="space-y-4 p-6">
            <DialogToggle
              label="Memory"
              checked={config?.flags.memory ?? false}
              onChange={(value) => patchConfig.mutate({ enable_memory: value })}
            />
            <DialogToggle
              label="Tools"
              checked={config?.flags.tools ?? false}
              onChange={(value) => patchConfig.mutate({ enable_tools: value })}
            />
            <DialogToggle
              label="Reflection"
              checked={config?.flags.reflection ?? false}
              onChange={(value) => patchConfig.mutate({ enable_reflection: value })}
            />
            <DialogToggle
              label="Force Local Only"
              checked={config?.force_local_only ?? false}
              onChange={(value) => patchConfig.mutate({ force_local_only: value })}
            />
            <DialogToggle
              label="Allow Internet MCP"
              checked={config?.allow_internet_mcp ?? false}
              onChange={(value) => patchConfig.mutate({ allow_internet_mcp: value })}
            />
            <DialogToggle
              label="Excel MCP"
              checked={config?.mcp.local_mcp.excel ?? false}
              onChange={(value) => patchConfig.mutate({ enable_excel_mcp: value })}
            />
            <DialogToggle
              label="Markdownify MCP"
              checked={config?.mcp.local_mcp.markdownify ?? false}
              onChange={(value) => patchConfig.mutate({ enable_markdownify_mcp: value })}
            />
            <DialogToggle
              label="Trading Tools"
              checked={config?.flags.trading_tools ?? false}
              onChange={(value) => patchConfig.mutate({ enable_trading_tools: value })}
            />
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function DialogToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-4">
      <span className="text-sm text-white">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-white/10",
        )}
      >
        <span
          className={cn(
            "absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}
