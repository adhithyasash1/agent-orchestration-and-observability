import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/sidebar";
import { CommandBar } from "@/components/ui/command-bar";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "AgentOS | Professional Orchestration",
  description: "High-density trace inspection and memory management for AI agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} font-sans selection:bg-accent selection:text-app-foreground`}>
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
              <div className="absolute inset-0 pointer-events-none opacity-20 bg-grid-pattern bg-grid-size" />
              <div className="relative z-10 p-6 max-w-7xl mx-auto">
                {children}
              </div>
            </main>
          </div>
          <CommandBar />
        </Providers>
      </body>
    </html>
  );
}
