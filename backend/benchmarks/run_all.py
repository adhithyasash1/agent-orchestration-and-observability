"""
Run ALL benchmark variants and generate a comparison report.

Usage:
    cd backend
    python -m benchmarks.run_all

This runs (in order):
    1. baseline      — plain LLM, no agent loop
    2. full          — all features on
    3. no-memory     — memory disabled
    4. no-reranker   — FlashRank disabled
    5. no-eval-loop  — evaluator auto-passes
    6. no-tools      — executor skips all tools

Then generates benchmarks/results/REPORT.md comparing all runs.

Estimated time: ~30-60 minutes depending on model speed and network.
"""

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks.runner import run_benchmark, VARIANTS
from benchmarks.report import load_results, generate_report

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("benchmark.all")

# Variants to run, in order. Baseline first (fastest), full second (reference).
RUN_ORDER = [
    "baseline",
    "full",
    "no-memory",
    "no-reranker",
    "no-eval-loop",
    "no-tools",
]


async def main():
    print("=" * 60)
    print("  AgentOS Full Benchmark Suite")
    print(f"  Running {len(RUN_ORDER)} variants × 30 tasks = {len(RUN_ORDER) * 30} runs")
    print("=" * 60)

    all_results = []
    for variant in RUN_ORDER:
        print(f"\n{'─' * 40}")
        print(f"  Starting variant: {variant}")
        print(f"{'─' * 40}\n")

        try:
            result = await run_benchmark(variant=variant)
            all_results.append(result)
        except Exception as e:
            logger.error(f"Variant '{variant}' failed: {e}")
            continue

    # Generate comparison report
    print(f"\n{'=' * 60}")
    print("  Generating comparison report...")
    print(f"{'=' * 60}\n")

    # Reload from disk to include all files
    results = load_results()
    report = generate_report(results)

    output_path = Path(__file__).parent / "results" / "REPORT.md"
    with open(output_path, "w") as f:
        f.write(report)

    print(report)
    print(f"\nReport written to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
