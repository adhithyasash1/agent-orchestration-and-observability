"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Zap, TerminalSquare } from "lucide-react";

import { ChatInterface } from "@/components/chat-interface";
import { DashboardShell } from "@/components/dashboard-shell";

export default function Page() {
  const [activeTab, setActiveTab] = useState<"chat" | "developer">("chat");

  return (
    <div className="flex h-screen w-full flex-col bg-[#0b0f19] text-white">
      {/* Global Tab Header */}
      <header className="sticky top-0 z-50 flex items-center justify-center border-b border-white/5 bg-[#0b0f19]/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex space-x-1 rounded-[20px] border border-white/10 bg-black/40 p-1">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center gap-2 rounded-[16px] px-6 py-2 text-sm font-medium transition-all ${
              activeTab === "chat"
                ? "bg-white/10 text-white shadow-sm"
                : "text-muted hover:text-white hover:bg-white/5"
            }`}
          >
            <Zap className={`h-4 w-4 ${activeTab === "chat" ? "text-accent" : ""}`} />
            Agent Chat
          </button>
          <button
            onClick={() => setActiveTab("developer")}
            className={`flex items-center gap-2 rounded-[16px] px-6 py-2 text-sm font-medium transition-all ${
              activeTab === "developer"
                ? "bg-white/10 text-white shadow-sm"
                : "text-muted hover:text-white hover:bg-white/5"
            }`}
          >
            <TerminalSquare className={`h-4 w-4 ${activeTab === "developer" ? "text-accent" : ""}`} />
            Developer Console
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeTab === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <ChatInterface />
            </motion.div>
          ) : (
            <motion.div
              key="developer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <DashboardShell />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
