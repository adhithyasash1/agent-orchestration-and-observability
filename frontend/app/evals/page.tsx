"use client";

import { MOCK_EVAL } from "@/lib/mock-data";
import { Activity, Lightbulb, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function EvaluationsPage() {
  
  return (
    <div className="flex flex-col h-full bg-background animate-fade-in font-sans">
      
      <header className="flex flex-col border-b border-border bg-background/90 backdrop-blur-md px-6 py-4 space-y-4">
        <div className="flex items-center gap-3">
           <div className="flex items-center justify-center h-8 w-8 rounded-md bg-accent/10 text-accent">
              <Activity className="h-4 w-4" />
           </div>
           <div>
              <h1 className="text-[14px] font-bold text-foreground">Configuration Evaluations</h1>
              <p className="text-[12px] text-muted">Ablation Matrices & Benchmark Deltas</p>
           </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 max-w-5xl mx-auto w-full space-y-8">
         
         {/* Natural Language Insights */}
         <section className="bg-glass rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
               <Lightbulb className="h-4 w-4 text-accent" />
               <h2 className="text-[13px] font-bold text-foreground uppercase tracking-widest">Core Architectural Insights</h2>
            </div>
            <ul className="space-y-3">
               <li className="flex items-start gap-3">
                  <div className="h-1.5 w-1.5 rounded-full bg-success mt-1.5 shrink-0" />
                  <p className="text-[13px] text-muted leading-relaxed">
                    <strong className="text-foreground font-bold">Memory Architecture rescues pipelines.</strong> Incorporating memory improved global completion ratios by <span className="text-success font-mono">+31%</span> natively across all deterministic workflows.
                  </p>
               </li>
               <li className="flex items-start gap-3">
                  <div className="h-1.5 w-1.5 rounded-full bg-success mt-1.5 shrink-0" />
                  <p className="text-[13px] text-muted leading-relaxed">
                    <strong className="text-foreground font-bold">FlashRank handles lexical noise.</strong> Without a Reranker crossing the FTS lexicons, hybrid performance crashed by -16% strictly due to contextual overload.
                  </p>
               </li>
               <li className="flex items-start gap-3">
                  <div className="h-1.5 w-1.5 rounded-full bg-danger mt-1.5 shrink-0" />
                  <p className="text-[13px] text-muted leading-relaxed">
                    <strong className="text-foreground font-bold">Failure recovery drops off sharply.</strong> The highest failure point globally remains recursive infinite loops causing memory bounds to exhaust.
                  </p>
               </li>
            </ul>
         </section>

         {/* Visual Deltas */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {MOCK_EVAL.improvements.map((impact, idx) => (
              <div key={idx} className="bg-glass border border-border rounded-xl p-4 flex flex-col justify-center">
                 <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1">{impact.label}</div>
                 <div className="flex items-center gap-2">
                    {impact.type === 'positive' && <TrendingUp className="h-5 w-5 text-success" />}
                    {impact.type === 'negative' && <TrendingDown className="h-5 w-5 text-danger" />}
                    {impact.type === 'neutral' && <Minus className="h-5 w-5 text-gold" />}
                    <span className={`text-[24px] font-bold tracking-tight ${
                      impact.type === 'positive' ? 'text-success' : 
                      impact.type === 'negative' ? 'text-danger' : 'text-gold'
                    }`}>
                      {impact.value}
                    </span>
                 </div>
              </div>
            ))}
         </div>
         
         {/* Recharts Area */}
         <section className="bg-glass border border-border rounded-xl p-5 shadow-sm h-[350px] flex flex-col">
            <h2 className="text-[12px] font-bold tracking-wide uppercase text-muted mb-6">Ablation Benchmark Scaling Curve</h2>
            <div className="flex-1 min-h-0">
               <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={MOCK_EVAL.chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      stroke="hsl(var(--muted))" 
                      fontSize={11} 
                      tickLine={false} 
                      axisLine={false}
                      dy={10}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted))" 
                      fontSize={11} 
                      tickLine={false} 
                      axisLine={false}
                      domain={[0.5, 1]}
                      tickFormatter={(val) => val.toFixed(2)}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: '12px', color: '#fff' }}
                      itemStyle={{ color: 'hsl(var(--accent))' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="score" 
                      stroke="hsl(var(--accent))" 
                      strokeWidth={3} 
                      dot={{ fill: 'hsl(var(--accent))', strokeWidth: 0, r: 4 }} 
                      activeDot={{ r: 6, fill: 'hsl(var(--accent))', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                    />
                  </LineChart>
               </ResponsiveContainer>
            </div>
         </section>

      </main>

    </div>
  );
}
