"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { 
  LayoutDashboard, 
  Terminal, 
  Database, 
  Settings, 
  MessageSquare,
  Search,
  Plus,
  Trash2
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function CommandBar() {
  const router = useRouter();
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useStore();
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  const { data: memoryResults } = useQuery({
    queryKey: ["memory-search", searchQuery],
    queryFn: () => api.searchMemory({ query: searchQuery, k: 5 }),
    enabled: searchQuery.length > 2,
  });

  const navigate = (path: string) => {
    router.push(path);
    setCommandPaletteOpen(false);
  };

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="w-full max-w-2xl bg-glass shadow-2xl rounded-2xl border border-white/10 overflow-hidden animate-slide-down">
        <Command className="flex flex-col h-[450px] bg-transparent">
          <div className="flex items-center px-4 border-b border-border gap-3">
            <Search className="w-5 h-5 text-muted" />
            <Command.Input
              autoFocus
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search or type a command..."
              className="flex-1 h-14 bg-transparent border-none outline-none text-foreground placeholder:text-muted focus:ring-0"
            />
          </div>

          <Command.List className="overflow-y-auto p-2 scrollbar-hide">
            <Command.Empty className="py-12 text-center text-muted">
              No results found for "{searchQuery}"
            </Command.Empty>

            <Command.Group heading="Navigation" className="px-2 py-1 text-xs font-bold text-muted uppercase tracking-widest bg-transparent">
              <CommandItem icon={LayoutDashboard} onSelect={() => navigate("/")}>Dashboard</CommandItem>
              <CommandItem icon={Terminal} onSelect={() => navigate("/runs")}>Runs</CommandItem>
              <CommandItem icon={Database} onSelect={() => navigate("/memory")}>Memory Console</CommandItem>
              <CommandItem icon={MessageSquare} onSelect={() => navigate("/chat")}>Live Chat</CommandItem>
              <CommandItem icon={Settings} onSelect={() => navigate("/settings")}>Settings</CommandItem>
            </Command.Group>

            {memoryResults?.results && memoryResults.results.length > 0 && (
              <Command.Group heading="Memory Results" className="mt-4 px-2 py-1 text-xs font-bold text-muted uppercase tracking-widest bg-transparent">
                {memoryResults.results.map((item) => (
                  <Command.Item
                    key={item.id}
                    className="flex flex-col gap-1 p-3 rounded-xl hover:bg-white/5 cursor-pointer aria-selected:bg-white/5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono uppercase">{item.kind}</span>
                      <span className="text-[10px] text-muted font-mono">Salience: {(item.salience * 100).toFixed(0)}</span>
                    </div>
                    <p className="text-sm line-clamp-1 text-muted-foreground">{item.text}</p>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="System" className="mt-4 px-2 py-1 text-xs font-bold text-muted uppercase tracking-widest bg-transparent">
              <CommandItem icon={Plus} onSelect={() => navigate("/")}>New Run</CommandItem>
              <CommandItem icon={Trash2} onSelect={() => navigate("/memory")}>Purge System</CommandItem>
            </Command.Group>
          </Command.List>

          <div className="mt-auto px-4 py-3 border-t border-border bg-white/5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted font-bold">
            <div className="flex gap-4">
              <span>↑↓ Navigate</span>
              <span>⏎ Select</span>
              <span>ESC Close</span>
            </div>
            <span>⌘K Command Palette</span>
          </div>
        </Command>
      </div>
      <div 
        className="absolute inset-0 -z-10" 
        onClick={() => setCommandPaletteOpen(false)} 
      />
    </div>
  );
}

function CommandItem({ children, icon: Icon, onSelect }: { children: React.ReactNode, icon: any, onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 cursor-pointer text-sm text-foreground hover:text-accent transition-colors aria-selected:bg-white/5 aria-selected:text-accent"
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      {children}
    </Command.Item>
  );
}
