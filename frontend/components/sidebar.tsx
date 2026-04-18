"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Terminal, 
  Database, 
  Settings, 
  MessageSquare,
  Activity,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { motion } from "motion/react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Runs", href: "/runs", icon: Terminal },
  { label: "Memory", href: "/memory", icon: Database },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  const { data: runs } = useQuery({
    queryKey: ["runs", "last-24h"],
    queryFn: () => api.listRuns(50),
    refetchInterval: 30000,
  });

  const activeRunCount = runs?.filter(r => r.status === "running").length || 0;

  return (
    <aside className="w-64 border-r border-border bg-background/50 backdrop-blur-md flex flex-col h-full z-20">
      <div className="p-6 flex items-center gap-3">
        <Activity className="text-accent w-6 h-6" />
        <span className="font-bold tracking-tight text-lg italic">Agent<span className="text-accent">OS</span></span>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all relative",
                isActive 
                  ? "text-accent bg-accent/5 ring-1 ring-accent/20" 
                  : "text-muted hover:text-foreground hover:bg-white/5"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">{item.label}</span>
              
              {item.label === "Runs" && activeRunCount > 0 && (
                <span className="ml-auto flex h-2 w-2 rounded-full bg-accent animate-pulse" />
              )}

              {isActive && (
                <motion.div 
                  layoutId="active-pill"
                  className="absolute left-0 w-1 h-1/2 bg-accent rounded-r-full"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border mt-auto">
        <div className="bg-white/5 rounded-xl p-4 flex items-center justify-between group cursor-pointer hover:bg-white/10 transition-colors">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted font-bold uppercase tracking-widest">Version</span>
            <span className="text-sm font-mono text-accent">1.0.4-beta</span>
          </div>
          <ChevronRight className="w-4 h-4 text-muted group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </aside>
  );
}
