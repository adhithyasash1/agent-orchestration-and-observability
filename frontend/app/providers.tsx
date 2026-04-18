"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { useStore } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ToastViewport />
    </QueryClientProvider>
  );
}

function ToastViewport() {
  const toast = useStore((state) => state.toast);

  if (!toast) {
    return null;
  }

  const tone =
    toast.type === "success"
      ? "border-success/30 bg-success/10 text-success"
      : toast.type === "error"
        ? "border-danger/30 bg-danger/10 text-danger"
        : "border-accent/30 bg-accent/10 text-accent";

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] max-w-sm">
      <div className={`rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${tone}`}>
        {toast.message}
      </div>
    </div>
  );
}
