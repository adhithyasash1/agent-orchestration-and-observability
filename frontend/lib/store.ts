import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AgentConfig } from "./types";

interface UIState {
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  
  settingsCache: AgentConfig | null;
  setSettingsCache: (config: AgentConfig | null) => void;
  
  lastPurgeTs: number | null;
  recordPurge: () => void;

  toast: { message: string; type: "success" | "error" | "info" } | null;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  hideToast: () => void;
}

export const useStore = create<UIState>()(
  persist(
    (set) => ({
      activeRunId: null,
      setActiveRunId: (activeRunId) => set({ activeRunId }),
      
      isCommandPaletteOpen: false,
      setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
      
      settingsCache: null,
      setSettingsCache: (settingsCache) => set({ settingsCache }),
      
      lastPurgeTs: null,
      recordPurge: () => set({ lastPurgeTs: Date.now() }),

      toast: null,
      showToast: (message, type = "info") => {
        set({ toast: { message, type } });
        setTimeout(() => set({ toast: null }), 3000);
      },
      hideToast: () => set({ toast: null }),
    }),
    {
      name: "agentos-storage",
      partialize: (state) => ({ 
        activeRunId: state.activeRunId,
        settingsCache: state.settingsCache
      }),
    }
  )
);
