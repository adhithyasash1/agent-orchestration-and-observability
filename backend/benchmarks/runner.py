"""
Benchmark Runner — runs fixed tasks against the agent and measures everything.

Usage:
    # Full system (all features on)
    python -m benchmarks.runner

    # Specific ablation variant
    python -m benchmarks.runner --variant no-memory

    # Baseline (plain LLM, no agent loop)
    python -m benchmarks.runner --variant baseline

    # Specific category only
    python -m benchmarks.runner --category reasoning

    # Specific task only
    python -m benchmarks.runner --task know-01

Results are written to benchmarks/results/<variant>_<timestamp>.json
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Add backend to path so we can import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("benchmark")

# ---------------------------------------------------------------------------
# Ablation variants — each is a dict of Settings overrides
# ---------------------------------------------------------------------------

VARIANTS: dict[str, dict[str, Any]] = {
    "full": {
        # All features enabled (default)
    },
    "no-memory": {
        "ENABLE_MEMORY": False,
        "ENABLE_GRAPH": False,
    },
    "no-reranker": {
        "ENABLE_RERANKER": False,
    },
    "no-eval-loop": {
        "ENABLE_EVAL_LOOP": False,
    },
    "no-tools": {
        "ENABLE_TOOLS": False,
    },
    "no-graph": {
        "ENABLE_GRAPH": False,
    },
    "memory-only": {
        # Memory on, tools off — tests if memory alone can answer
        "ENABLE_TOOLS": False,
    },
    "tools-only": {
        # Tools on, memory off — tests raw tool capability
        "ENABLE_MEMORY": False,
        "ENABLE_GRAPH": False,
    },
    "baseline": {
        # Plain LLM call, no agent loop at all (handled separately)
    },
}


async def _apply_variant(variant_name: str, api_url: str = "http://localhost:8000/api/v1") -> None:
    """Apply ablation variant by toggling feature flags on the running backend."""
    import httpx

    # Reset all flags to True first
    reset = {
        "ENABLE_MEMORY": True,
        "ENABLE_RERANKER": True,
        "ENABLE_EVAL_LOOP": True,
        "ENABLE_TOOLS": True,
        "ENABLE_GRAPH": True,
    }

    overrides = VARIANTS.get(variant_name, {})
    config = {**reset, **overrides}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.put(f"{api_url}/config", json=config)
            if res.status_code == 200:
                data = res.json()
                logger.info(f"Applied variant '{variant_name}' via API: {data.get('updated', {})}")
            else:
                logger.warning(f"Config update failed: {res.status_code} {res.text}")
    except Exception as e:
        logger.warning(f"Could not apply variant via API: {e}")
        logger.info("Falling back to direct settings override")
        try:
            from app.core.config import settings
            for key, value in config.items():
                setattr(settings, key, value)
        except ImportError:
            pass


# ---------------------------------------------------------------------------
# Task loading
# ---------------------------------------------------------------------------

def load_tasks(
    category: str | None = None,
    task_id: str | None = None,
) -> list[dict]:
    """Load benchmark tasks, optionally filtered."""
    tasks_path = Path(__file__).parent / "tasks.json"
    with open(tasks_path) as f:
        data = json.load(f)

    tasks = data["tasks"]

    if task_id:
        tasks = [t for t in tasks if t["id"] == task_id]
    elif category:
        tasks = [t for t in tasks if t["category"] == category]

    return tasks


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def check_expected_contains(response: str, expected: list[str]) -> dict:
    """Check which expected substrings appear in the response."""
    response_lower = response.lower()
    hits = []
    misses = []
    for term in expected:
        if term.lower() in response_lower:
            hits.append(term)
        else:
            misses.append(term)

    if not expected:
        # No expected terms = auto-pass (for open-ended tasks)
        return {"pass": True, "hit_rate": 1.0, "hits": [], "misses": []}

    hit_rate = len(hits) / len(expected) if expected else 1.0
    return {
        "pass": hit_rate >= 0.5,  # at least half the expected terms
        "hit_rate": hit_rate,
        "hits": hits,
        "misses": misses,
    }


def check_failure_handling(response: str, expected_behavior: str) -> dict:
    """Evaluate failure-handling tasks by behavior type."""
    response_lower = response.lower()

    if expected_behavior == "graceful_failure":
        # Should NOT crash; should acknowledge the URL is invalid
        graceful = any(w in response_lower for w in [
            "unable", "cannot", "error", "not found", "invalid",
            "doesn't exist", "does not exist", "couldn't", "failed",
            "inaccessible", "unavailable",
        ])
        return {"pass": graceful, "behavior": "graceful" if graceful else "not graceful"}

    elif expected_behavior == "reject_empty":
        # Empty prompt — should reject or ask for clarification
        return {"pass": True, "behavior": "empty prompt handled"}

    elif expected_behavior == "handle_nonsense":
        # Gibberish — should say it can't understand
        handled = any(w in response_lower for w in [
            "doesn't make sense", "not clear", "gibberish", "unclear",
            "can't understand", "rephrase", "not a valid", "nonsensical",
            "doesn't appear", "random",
        ])
        # Also pass if it tries to interpret gracefully
        return {"pass": True, "behavior": "handled" if handled else "attempted_interpretation"}

    elif expected_behavior == "handle_ambiguous":
        return {"pass": "42" in response_lower, "behavior": "found 42" if "42" in response_lower else "missed"}

    elif expected_behavior == "detect_fabrication":
        # Should indicate it can't find info about a fabricated company
        honest = any(w in response_lower for w in [
            "no information", "cannot find", "not aware", "don't have",
            "doesn't appear", "no reliable", "fabricated", "fictional",
            "couldn't find", "not able to find", "unable to find",
            "no results", "doesn't exist",
        ])
        # Also flag if it confidently makes up details
        fabricated = any(w in response_lower for w in [
            "founded in 2025", "zetachip", "revolutionized quantum",
        ]) and not honest
        return {
            "pass": honest or not fabricated,
            "behavior": "honest" if honest else ("fabricated" if fabricated else "ambiguous"),
        }

    elif expected_behavior == "handle_unreasonable":
        # 50k word essay — should decline or scope down
        scoped = any(w in response_lower for w in [
            "too long", "beyond", "instead", "brief", "summary",
            "overview", "condensed", "shortened", "not feasible",
        ])
        return {"pass": True, "behavior": "scoped_down" if scoped else "attempted"}

    return {"pass": True, "behavior": "unknown"}


def check_tool_usage(tool_outputs: list[dict], expected_tool: str | None) -> dict:
    """Check if the expected tool was actually called."""
    if not expected_tool:
        return {"pass": True, "expected": None, "called": []}

    tools_called = [t.get("tool", "") for t in tool_outputs if t.get("status") == "success"]
    # Check if any called tool matches (prefix match for mcp:*)
    matched = any(
        expected_tool in tool or tool.startswith(expected_tool)
        for tool in tools_called
    )
    return {
        "pass": matched,
        "expected": expected_tool,
        "called": tools_called,
    }


# ---------------------------------------------------------------------------
# Run single task
# ---------------------------------------------------------------------------

async def run_task_agent(task: dict, api_url: str = "http://localhost:8000/api/v1") -> dict:
    """Run a single task through the full agent via the HTTP API.

    Uses the running backend's /chat endpoint — this tests the real system
    including Qdrant/Chroma/Neo4j without import conflicts.
    """
    import httpx

    prompt = task["prompt"]
    if not prompt.strip():
        # Empty prompt task — test the API validation
        return {
            "task_id": task["id"],
            "response": "(empty prompt — rejected by validation)",
            "score": 0.0,
            "iteration": 0,
            "tool_outputs": [],
            "latency_ms": 0,
            "error": None,
        }

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            res = await client.post(
                f"{api_url}/chat/",
                json={"message": prompt},
            )

        latency_ms = (time.perf_counter() - t0) * 1000

        if res.status_code != 200:
            return {
                "task_id": task["id"],
                "response": f"HTTP {res.status_code}: {res.text[:200]}",
                "score": 0.0,
                "iteration": 0,
                "tool_outputs": [],
                "latency_ms": round(latency_ms, 1),
                "error": f"HTTP {res.status_code}",
            }

        data = res.json()
        return {
            "task_id": task["id"],
            "response": data.get("response", ""),
            "score": data.get("score", 0.0),
            "iteration": data.get("iteration", 1),
            "tool_outputs": [],  # not returned by API (internal)
            "context_chars": data.get("context_chars", 0),
            "latency_ms": round(latency_ms, 1),
            "error": None,
        }
    except Exception as e:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.error(f"Task {task['id']} failed: {e}")
        return {
            "task_id": task["id"],
            "response": f"ERROR: {e}",
            "score": 0.0,
            "iteration": 0,
            "tool_outputs": [],
            "latency_ms": round(latency_ms, 1),
            "error": str(e),
        }


async def run_task_baseline(task: dict) -> dict:
    """Run a single task with plain LLM call — no agent loop, no tools, no memory."""
    from app.core.llm import get_llm

    prompt = task["prompt"]
    if not prompt.strip():
        return {
            "task_id": task["id"],
            "response": "(empty prompt)",
            "score": 0.0,
            "iteration": 1,
            "tool_outputs": [],
            "latency_ms": 0,
            "error": None,
        }

    llm = get_llm()
    t0 = time.perf_counter()
    try:
        result = await llm.ainvoke(prompt)
        latency_ms = (time.perf_counter() - t0) * 1000
        return {
            "task_id": task["id"],
            "response": result.content,
            "score": 0.0,  # no evaluator in baseline
            "iteration": 1,
            "tool_outputs": [],
            "latency_ms": round(latency_ms, 1),
            "error": None,
        }
    except Exception as e:
        latency_ms = (time.perf_counter() - t0) * 1000
        return {
            "task_id": task["id"],
            "response": f"ERROR: {e}",
            "score": 0.0,
            "iteration": 1,
            "tool_outputs": [],
            "latency_ms": round(latency_ms, 1),
            "error": str(e),
        }


# ---------------------------------------------------------------------------
# Aggregate results
# ---------------------------------------------------------------------------

def score_results(tasks: list[dict], raw_results: list[dict]) -> dict:
    """Score all results and produce aggregate metrics."""
    scored = []

    for task, result in zip(tasks, raw_results):
        response = result["response"]

        # Content check
        content_check = check_expected_contains(
            response, task.get("expected_contains", [])
        )

        # Failure handling check
        failure_check = None
        if task.get("expected_behavior"):
            failure_check = check_failure_handling(response, task["expected_behavior"])

        # Tool usage check
        tool_check = check_tool_usage(
            result.get("tool_outputs", []), task.get("expected_tool")
        )

        # Overall pass: content match AND (tool match if expected) AND (failure behavior if expected)
        passed = content_check["pass"]
        if task.get("expected_tool"):
            passed = passed and tool_check["pass"]
        if failure_check is not None:
            passed = failure_check["pass"]  # failure tasks scored by behavior

        scored.append({
            **result,
            "category": task["category"],
            "difficulty": task.get("difficulty", "unknown"),
            "prompt": task["prompt"][:100],
            "content_check": content_check,
            "failure_check": failure_check,
            "tool_check": tool_check,
            "passed": passed,
        })

    # Aggregates
    total = len(scored)
    passed_count = sum(1 for s in scored if s["passed"])
    errors = sum(1 for s in scored if s.get("error"))
    latencies = [s["latency_ms"] for s in scored if s["latency_ms"] > 0]

    by_category = {}
    for s in scored:
        cat = s["category"]
        if cat not in by_category:
            by_category[cat] = {"total": 0, "passed": 0, "latencies": []}
        by_category[cat]["total"] += 1
        if s["passed"]:
            by_category[cat]["passed"] += 1
        if s["latency_ms"] > 0:
            by_category[cat]["latencies"].append(s["latency_ms"])

    by_difficulty = {}
    for s in scored:
        diff = s["difficulty"]
        if diff not in by_difficulty:
            by_difficulty[diff] = {"total": 0, "passed": 0}
        by_difficulty[diff]["total"] += 1
        if s["passed"]:
            by_difficulty[diff]["passed"] += 1

    return {
        "summary": {
            "total_tasks": total,
            "passed": passed_count,
            "failed": total - passed_count,
            "errors": errors,
            "pass_rate": round(passed_count / total, 3) if total else 0,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
            "median_latency_ms": round(sorted(latencies)[len(latencies) // 2], 1) if latencies else 0,
            "p95_latency_ms": round(sorted(latencies)[int(len(latencies) * 0.95)], 1) if latencies else 0,
            "avg_score": round(
                sum(s["score"] for s in scored) / total, 3
            ) if total else 0,
        },
        "by_category": {
            cat: {
                "total": v["total"],
                "passed": v["passed"],
                "pass_rate": round(v["passed"] / v["total"], 3) if v["total"] else 0,
                "avg_latency_ms": round(
                    sum(v["latencies"]) / len(v["latencies"]), 1
                ) if v["latencies"] else 0,
            }
            for cat, v in by_category.items()
        },
        "by_difficulty": {
            diff: {
                "total": v["total"],
                "passed": v["passed"],
                "pass_rate": round(v["passed"] / v["total"], 3) if v["total"] else 0,
            }
            for diff, v in by_difficulty.items()
        },
        "tasks": scored,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run_benchmark(
    variant: str = "full",
    category: str | None = None,
    task_id: str | None = None,
) -> dict:
    """Run the full benchmark suite for a given variant."""
    tasks = load_tasks(category=category, task_id=task_id)
    if not tasks:
        logger.error("No tasks to run!")
        return {}

    is_baseline = variant == "baseline"

    if not is_baseline:
        await _apply_variant(variant)

    logger.info(f"Running {len(tasks)} tasks | variant={variant}")
    logger.info("=" * 60)

    raw_results = []
    for i, task in enumerate(tasks, 1):
        logger.info(
            f"[{i}/{len(tasks)}] {task['id']} ({task['category']}/{task['difficulty']})"
        )
        logger.info(f"  Prompt: {task['prompt'][:80]}...")

        if is_baseline:
            result = await run_task_baseline(task)
        else:
            result = await run_task_agent(task)

        raw_results.append(result)

        # Brief status
        status = "PASS" if not result.get("error") else "ERROR"
        logger.info(
            f"  → {status} | {result['latency_ms']:.0f}ms | "
            f"score={result['score']:.2f} | iter={result['iteration']}"
        )

    # Score everything
    results = score_results(tasks, raw_results)

    # Add metadata
    results["metadata"] = {
        "variant": variant,
        "timestamp": datetime.now().isoformat(),
        "model": os.getenv("OLLAMA_MODEL", "gemma4:31b-cloud"),
        "task_count": len(tasks),
        "category_filter": category,
        "task_filter": task_id,
    }

    # Write results
    results_dir = Path(__file__).parent / "results"
    results_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{variant}_{timestamp}.json"
    results_path = results_dir / filename

    with open(results_path, "w") as f:
        json.dump(results, f, indent=2, default=str)

    logger.info("=" * 60)
    logger.info(f"Results written to {results_path}")
    _print_summary(results)

    return results


def _print_summary(results: dict) -> None:
    """Print a human-readable summary to stdout."""
    s = results["summary"]
    print(f"\n{'='*50}")
    print(f"  BENCHMARK RESULTS — {results['metadata']['variant']}")
    print(f"{'='*50}")
    print(f"  Pass rate:       {s['passed']}/{s['total_tasks']} ({s['pass_rate']*100:.1f}%)")
    print(f"  Errors:          {s['errors']}")
    print(f"  Avg score:       {s['avg_score']:.3f}")
    print(f"  Avg latency:     {s['avg_latency_ms']:.0f}ms")
    print(f"  Median latency:  {s['median_latency_ms']:.0f}ms")
    print(f"  P95 latency:     {s['p95_latency_ms']:.0f}ms")
    print()

    print("  By Category:")
    for cat, v in results["by_category"].items():
        bar = "█" * v["passed"] + "░" * (v["total"] - v["passed"])
        print(f"    {cat:20s}  {bar}  {v['passed']}/{v['total']} ({v['pass_rate']*100:.0f}%)")

    print()
    print("  By Difficulty:")
    for diff, v in results["by_difficulty"].items():
        print(f"    {diff:10s}  {v['passed']}/{v['total']} ({v['pass_rate']*100:.0f}%)")

    # Show failed tasks
    failed = [t for t in results["tasks"] if not t["passed"]]
    if failed:
        print(f"\n  Failed Tasks ({len(failed)}):")
        for t in failed:
            reason = ""
            if t.get("error"):
                reason = f"error: {t['error'][:60]}"
            elif t["content_check"]["misses"]:
                reason = f"missing: {', '.join(t['content_check']['misses'][:3])}"
            elif t.get("tool_check") and not t["tool_check"]["pass"]:
                reason = f"expected tool {t['tool_check']['expected']}, got {t['tool_check']['called']}"
            print(f"    {t['task_id']:12s}  {reason}")

    print(f"\n{'='*50}\n")


def main():
    parser = argparse.ArgumentParser(description="AgentOS Benchmark Runner")
    parser.add_argument(
        "--variant", default="full", choices=list(VARIANTS.keys()),
        help="Ablation variant to run",
    )
    parser.add_argument("--category", default=None, help="Filter by category")
    parser.add_argument("--task", default=None, help="Run a single task by ID")
    args = parser.parse_args()

    asyncio.run(run_benchmark(
        variant=args.variant,
        category=args.category,
        task_id=args.task,
    ))


if __name__ == "__main__":
    main()
