# AgentOS Benchmark Report

Generated from 1 run(s).

## Summary

| Variant | Pass Rate | Avg Score | Avg Latency | Median Latency | P95 Latency | Errors |
|---------|-----------|-----------|-------------|----------------|-------------|--------|
| baseline | 14/30 (46.7%) | 0.000 | 45512ms | 25828ms | 128673ms | 4 |

## By Category

| Category | baseline |
|----------|--------|
| failure_handling | 6/6 (100%) |
| knowledge | 6/6 (100%) |
| multi_step | 0/6 (0%) |
| reasoning | 2/6 (33%) |
| tool_use | 0/6 (0%) |

## By Difficulty

| Difficulty | baseline |
|------------|--------|
| easy | 10/14 (71%) |
| medium | 3/12 (25%) |
| hard | 1/4 (25%) |

## Task Detail — baseline

| ID | Category | Diff | Pass | Score | Latency | Misses |
|----|----------|------|------|-------|---------|--------|
| know-01 | knowledge | easy | ✓ | 0.00 | 1906ms | — |
| know-02 | knowledge | easy | ✓ | 0.00 | 25828ms | — |
| know-03 | knowledge | easy | ✓ | 0.00 | 78669ms | — |
| know-04 | knowledge | easy | ✓ | 0.00 | 4736ms | — |
| know-05 | knowledge | medium | ✓ | 0.00 | 42471ms | — |
| know-06 | knowledge | easy | ✓ | 0.00 | 33993ms | — |
| tool-01 | tool_use | easy | ✗ | 0.00 | 7935ms | — |
| tool-02 | tool_use | easy | ✗ | 0.00 | 49165ms | Moby |
| tool-03 | tool_use | easy | ✗ | 0.00 | 53824ms | — |
| tool-04 | tool_use | medium | ✗ | 0.00 | 105035ms | — |
| tool-05 | tool_use | easy | ✗ | 0.00 | 4770ms | — |
| tool-06 | tool_use | medium | ✗ | 0.00 | 67746ms | — |
| multi-01 | multi_step | medium | ✗ | 0.00 | 56542ms | — |
| multi-02 | multi_step | medium | ✗ | 0.00 | 95247ms | — |
| multi-03 | multi_step | medium | ✗ | 0.00 | 128673ms | — |
| multi-04 | multi_step | medium | ✗ | 0.00 | 355223ms | — |
| multi-05 | multi_step | hard | ✗ | 0.00 | 42216ms | — |
| multi-06 | multi_step | hard | ✗ | 0.00 | 65775ms | — |
| fail-01 | failure_handling | easy | ✓ | 0.00 | 11174ms | — |
| fail-02 | failure_handling | easy | ✓ | 0.00 | 0ms | — |
| fail-03 | failure_handling | easy | ✓ | 0.00 | 2560ms | — |
| fail-04 | failure_handling | easy | ✓ | 0.00 | 37838ms | — |
| fail-05 | failure_handling | hard | ✓ | 0.00 | 16243ms | — |
| fail-06 | failure_handling | medium | ✓ | 0.00 | 412ms | — |
| reason-01 | reasoning | medium | ✗ | 0.00 | 599ms | 5.64, 5.6, approximately 5 |
| reason-02 | reasoning | medium | ✗ | 0.00 | 1222ms | 3/10, 0.3, 30% |
| reason-03 | reasoning | medium | ✗ | 0.00 | 488ms | 25 |
| reason-04 | reasoning | easy | ✓ | 0.00 | 1188ms | — |
| reason-05 | reasoning | medium | ✓ | 0.00 | 11112ms | — |
| reason-06 | reasoning | hard | ✗ | 0.00 | 17243ms | 979 |

## Methodology

- **Benchmark suite**: 30 fixed tasks across 5 categories (knowledge, tool_use, multi_step, failure_handling, reasoning)
- **Pass criteria**: `expected_contains` substring match (≥50% hit rate), correct tool called, appropriate failure behavior
- **Scoring**: LLM Council critique-then-score (0.0–1.0) for agent variants; not applicable for baseline
- **Latency**: Wall-clock time per task including all LLM calls, tool invocations, and memory lookups
- **Ablation**: Each variant disables one subsystem while keeping the rest intact
- **Baseline**: Plain `ChatOllama` call with no agent loop, tools, memory, or evaluation
- **Model**: gemma4:31b-cloud
- **Date**: 2026-04-16
