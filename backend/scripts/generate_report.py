import json
import sys
from pathlib import Path
from datetime import datetime

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

def extract_insights(reports: dict) -> list[str]:
    insights = []
    
    # Semantic Search vs FTS Ablation logic
    base = reports.get("full")
    no_sem = reports.get("no-semantic")
    sem_only = reports.get("semantic-only")
    
    if base and no_sem:
        db_score = base.get("overall_score", 0)
        sem_score = no_sem.get("overall_score", 0)
        gain = ((db_score - sem_score) / max(sem_score, 0.01)) * 100
        if gain > 5:
            insights.append(f"🟢 **Memory Optimization:** Hybrid retrieval improved scores by +{gain:.1f}% compared to pure FTS.")
        elif gain < -5:
            insights.append(f"🔴 **Semantic Degradation:** Semantic retrieval polluted FTS matches, dropping scores by {abs(gain):.1f}%.")
            
    if base and reports.get("no-memory"):
        mem_score = reports["no-memory"].get("overall_score", 0)
        gain = ((base.get("overall_score", 0) - mem_score) / max(mem_score, 0.01)) * 100
        insights.append(f"🟢 **Memory Value:** Retrieving prior context actively improves agent solutions by +{gain:.1f}%.")
        
    if base and reports.get("no-reflection"):
        ref_score = reports["no-reflection"].get("overall_score", 0)
        gain = ((base.get("overall_score", 0) - ref_score) / max(ref_score, 0.01)) * 100
        if gain > 0:
            insights.append(f"🟢 **Reflection Worth:** Self-reflection overhead pays off with a {gain:.1f}% accuracy boost.")
        else:
            insights.append(f"🟡 **Reflection Neutral:** Reflection loop failed to catch or correct hallucinated logic paths significantly.")

    return insights

def main():
    results_dir = BACKEND_ROOT / "bench" / "results"
    
    if not results_dir.exists():
        print("No evaluation reports generated yet. Run python -m bench.runner --all-ablations")
        sys.exit(1)
        
    latest_files = {}
    for f in results_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            label = data.get("label", "unknown")
            ts_str = data.get("timestamp", "")
            if not ts_str:
                continue
            
            # Keep newest item per label
            dt = datetime.fromisoformat(ts_str)
            if label not in latest_files or dt > latest_files[label][0]:
                latest_files[label] = (dt, data)
        except Exception:
            continue
            
    if not latest_files:
        print("No parsable evaluation findings generated.")
        sys.exit(1)
        
    reports = {k: v[1] for k, v in latest_files.items()}
    full_report = reports.get("full", list(reports.values())[0])

    out = [
        "# AgentOS LLM Evaluation Profile",
        f"\n**Execution Snapshot:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"**Profile Flags:**",
        "```json",
        json.dumps(full_report.get("flags", {}), indent=2),
        "```\n",
    ]
    
    out.append("## Automated Causal Insights")
    insights = extract_insights(reports)
    if insights:
        out.extend([f"- {i}" for i in insights])
    else:
        out.append("No statistically significant ablations calculated.")
        
    out.append("\n## Configuration Failure Breakdowns")
    out.append("| Ablation Target | Global Score | Execution Ms | Context Util % | Recall % |")
    out.append("|---|---|---|---|---|")
    
    for lbl, r in reports.items():
        score = r.get("overall_score", 0.0)
        ms = r.get("mean_latency_ms", 0)
        ctx = r.get("context_utility_rate") or 0.0
        rec = r.get("tool_recall") or 0.0
        out.append(f"| {lbl} | {score:.3f} | {ms}ms | {ctx*100:.1f}% | {rec*100:.1f}% |")

    report_path = PROJECT_ROOT / "llm_eval_report.md"
    report_path.write_text("\n".join(out))
    print(f"Generated Analytical Evaluation Dump mapping to {report_path.name}")
    

if __name__ == "__main__":
    main()
