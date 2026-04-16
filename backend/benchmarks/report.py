"""
Report Generator — produces markdown comparison tables from benchmark results.

Usage:
    # Compare all results in benchmarks/results/
    python -m benchmarks.report

    # Compare specific files
    python -m benchmarks.report results/full_20250416.json results/baseline_20250416.json

Output: benchmarks/results/REPORT.md
"""

import json
import sys
from pathlib import Path


def load_results(paths: list[Path] | None = None) -> list[dict]:
    """Load result files, sorted by timestamp."""
    results_dir = Path(__file__).parent / "results"

    if paths:
        files = [Path(p) for p in paths]
    else:
        files = sorted(results_dir.glob("*.json"))

    results = []
    for f in files:
        try:
            with open(f) as fh:
                data = json.load(fh)
                data["_filename"] = f.name
                results.append(data)
        except Exception as e:
            print(f"Warning: couldn't load {f}: {e}")

    return results


def generate_report(results: list[dict]) -> str:
    """Generate a markdown report comparing benchmark runs."""
    lines = []
    lines.append("# AgentOS Benchmark Report\n")
    lines.append(f"Generated from {len(results)} run(s).\n")

    if not results:
        lines.append("No results found. Run benchmarks first:\n")
        lines.append("```bash")
        lines.append("cd backend && python -m benchmarks.runner --variant full")
        lines.append("python -m benchmarks.runner --variant baseline")
        lines.append("```\n")
        return "\n".join(lines)

    # ---------------------------------------------------------------
    # 1. Summary comparison table
    # ---------------------------------------------------------------
    lines.append("## Summary\n")
    lines.append("| Variant | Pass Rate | Avg Score | Avg Latency | Median Latency | P95 Latency | Errors |")
    lines.append("|---------|-----------|-----------|-------------|----------------|-------------|--------|")

    for r in results:
        meta = r.get("metadata", {})
        s = r.get("summary", {})
        variant = meta.get("variant", "?")
        lines.append(
            f"| {variant} "
            f"| {s.get('passed', 0)}/{s.get('total_tasks', 0)} "
            f"({s.get('pass_rate', 0)*100:.1f}%) "
            f"| {s.get('avg_score', 0):.3f} "
            f"| {s.get('avg_latency_ms', 0):.0f}ms "
            f"| {s.get('median_latency_ms', 0):.0f}ms "
            f"| {s.get('p95_latency_ms', 0):.0f}ms "
            f"| {s.get('errors', 0)} |"
        )

    # ---------------------------------------------------------------
    # 2. Category breakdown
    # ---------------------------------------------------------------
    lines.append("\n## By Category\n")

    # Collect all categories across all runs
    all_cats = set()
    for r in results:
        all_cats.update(r.get("by_category", {}).keys())
    all_cats = sorted(all_cats)

    header = "| Category |"
    divider = "|----------|"
    for r in results:
        variant = r.get("metadata", {}).get("variant", "?")
        header += f" {variant} |"
        divider += "--------|"
    lines.append(header)
    lines.append(divider)

    for cat in all_cats:
        row = f"| {cat} |"
        for r in results:
            cat_data = r.get("by_category", {}).get(cat, {})
            p = cat_data.get("passed", 0)
            t = cat_data.get("total", 0)
            rate = cat_data.get("pass_rate", 0)
            row += f" {p}/{t} ({rate*100:.0f}%) |"
        lines.append(row)

    # ---------------------------------------------------------------
    # 3. Difficulty breakdown
    # ---------------------------------------------------------------
    lines.append("\n## By Difficulty\n")

    all_diffs = set()
    for r in results:
        all_diffs.update(r.get("by_difficulty", {}).keys())
    all_diffs = sorted(all_diffs, key=lambda d: {"easy": 0, "medium": 1, "hard": 2}.get(d, 9))

    header = "| Difficulty |"
    divider = "|------------|"
    for r in results:
        variant = r.get("metadata", {}).get("variant", "?")
        header += f" {variant} |"
        divider += "--------|"
    lines.append(header)
    lines.append(divider)

    for diff in all_diffs:
        row = f"| {diff} |"
        for r in results:
            diff_data = r.get("by_difficulty", {}).get(diff, {})
            p = diff_data.get("passed", 0)
            t = diff_data.get("total", 0)
            rate = diff_data.get("pass_rate", 0)
            row += f" {p}/{t} ({rate*100:.0f}%) |"
        lines.append(row)

    # ---------------------------------------------------------------
    # 4. Ablation delta (if we have both full and other variants)
    # ---------------------------------------------------------------
    full_run = next((r for r in results if r.get("metadata", {}).get("variant") == "full"), None)
    ablation_runs = [r for r in results if r.get("metadata", {}).get("variant") not in ("full", "baseline")]

    if full_run and ablation_runs:
        lines.append("\n## Ablation Impact\n")
        lines.append("Shows pass rate change compared to the full system.\n")
        lines.append("| Variant | Pass Rate | Delta | Interpretation |")
        lines.append("|---------|-----------|-------|----------------|")

        full_rate = full_run["summary"]["pass_rate"]
        for r in ablation_runs:
            variant = r["metadata"]["variant"]
            rate = r["summary"]["pass_rate"]
            delta = rate - full_rate
            sign = "+" if delta >= 0 else ""

            if abs(delta) < 0.02:
                interp = "No measurable impact"
            elif delta < -0.15:
                interp = "**Critical** — large regression"
            elif delta < -0.05:
                interp = "Moderate regression"
            elif delta > 0.05:
                interp = "Improvement (overhead removed?)"
            else:
                interp = "Minor change"

            lines.append(
                f"| {variant} "
                f"| {r['summary']['passed']}/{r['summary']['total_tasks']} ({rate*100:.1f}%) "
                f"| {sign}{delta*100:.1f}pp "
                f"| {interp} |"
            )

    # ---------------------------------------------------------------
    # 5. Baseline comparison
    # ---------------------------------------------------------------
    baseline_run = next((r for r in results if r.get("metadata", {}).get("variant") == "baseline"), None)

    if full_run and baseline_run:
        lines.append("\n## Baseline Comparison\n")
        lines.append("Plain LLM (no agent loop, no tools, no memory) vs full system.\n")

        full_s = full_run["summary"]
        base_s = baseline_run["summary"]

        lines.append("| Metric | Baseline | Full System | Delta |")
        lines.append("|--------|----------|-------------|-------|")

        for metric, label, fmt, higher_better in [
            ("pass_rate", "Pass Rate", lambda v: f"{v*100:.1f}%", True),
            ("avg_score", "Avg Score", lambda v: f"{v:.3f}", True),
            ("avg_latency_ms", "Avg Latency", lambda v: f"{v:.0f}ms", False),
        ]:
            bv = base_s.get(metric, 0)
            fv = full_s.get(metric, 0)
            delta = fv - bv
            if metric == "pass_rate":
                delta_str = f"{'+' if delta >= 0 else ''}{delta*100:.1f}pp"
            elif metric == "avg_latency_ms":
                delta_str = f"{'+' if delta >= 0 else ''}{delta:.0f}ms"
            else:
                delta_str = f"{'+' if delta >= 0 else ''}{delta:.3f}"

            lines.append(f"| {label} | {fmt(bv)} | {fmt(fv)} | {delta_str} |")

        # Per-category comparison
        lines.append("\n### Category Breakdown: Baseline vs Full\n")
        lines.append("| Category | Baseline | Full | Delta |")
        lines.append("|----------|----------|------|-------|")

        for cat in all_cats:
            bc = baseline_run.get("by_category", {}).get(cat, {})
            fc = full_run.get("by_category", {}).get(cat, {})
            br = bc.get("pass_rate", 0)
            fr = fc.get("pass_rate", 0)
            delta = fr - br
            lines.append(
                f"| {cat} "
                f"| {bc.get('passed', 0)}/{bc.get('total', 0)} ({br*100:.0f}%) "
                f"| {fc.get('passed', 0)}/{fc.get('total', 0)} ({fr*100:.0f}%) "
                f"| {'+' if delta >= 0 else ''}{delta*100:.0f}pp |"
            )

    # ---------------------------------------------------------------
    # 6. Task-level detail for most recent run
    # ---------------------------------------------------------------
    latest = results[-1]
    lines.append(f"\n## Task Detail — {latest.get('metadata', {}).get('variant', '?')}\n")
    lines.append("| ID | Category | Diff | Pass | Score | Latency | Misses |")
    lines.append("|----|----------|------|------|-------|---------|--------|")

    for t in latest.get("tasks", []):
        status = "✓" if t["passed"] else "✗"
        misses = ", ".join(t.get("content_check", {}).get("misses", [])[:3])
        lines.append(
            f"| {t['task_id']} "
            f"| {t['category']} "
            f"| {t['difficulty']} "
            f"| {status} "
            f"| {t['score']:.2f} "
            f"| {t['latency_ms']:.0f}ms "
            f"| {misses or '—'} |"
        )

    # ---------------------------------------------------------------
    # 7. Methodology notes
    # ---------------------------------------------------------------
    lines.append("\n## Methodology\n")
    lines.append("- **Benchmark suite**: 30 fixed tasks across 5 categories (knowledge, tool_use, multi_step, failure_handling, reasoning)")
    lines.append("- **Pass criteria**: `expected_contains` substring match (≥50% hit rate), correct tool called, appropriate failure behavior")
    lines.append("- **Scoring**: LLM Council critique-then-score (0.0–1.0) for agent variants; not applicable for baseline")
    lines.append("- **Latency**: Wall-clock time per task including all LLM calls, tool invocations, and memory lookups")
    lines.append("- **Ablation**: Each variant disables one subsystem while keeping the rest intact")
    lines.append("- **Baseline**: Plain `ChatOllama` call with no agent loop, tools, memory, or evaluation")
    lines.append(f"- **Model**: {latest.get('metadata', {}).get('model', 'unknown')}")
    lines.append(f"- **Date**: {latest.get('metadata', {}).get('timestamp', 'unknown')[:10]}")

    return "\n".join(lines) + "\n"


def main():
    paths = [Path(p) for p in sys.argv[1:]] if len(sys.argv) > 1 else None
    results = load_results(paths)

    report = generate_report(results)

    output_path = Path(__file__).parent / "results" / "REPORT.md"
    with open(output_path, "w") as f:
        f.write(report)

    print(report)
    print(f"\nReport written to {output_path}")


if __name__ == "__main__":
    main()
