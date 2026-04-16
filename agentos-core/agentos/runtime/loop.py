"""Core agent loop.

Phases per run:
  1. understand  — record the request
  2. retrieve    — pull relevant memory/context
  3. plan        — decide next step (tool call or answer)
  4. act         — execute tool if requested
  5. verify      — score answer, optionally reflect
  6. log         — every phase writes a TraceEvent

All phases are feature-flag gated so ablations (no memory / no planner /
no tools / no reflection) work by toggling flags at request time.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..config import Settings, settings as default_settings
from ..eval.scorer import score_answer
from ..eval.reflection import reflect
from ..llm.protocol import LLM
from ..memory.store import MemoryStore
from ..tools.registry import ToolRegistry
from .planner import plan_next_step, PlanDecision
from .trace import TraceEvent, TraceStore, Timer


@dataclass
class AgentResult:
    run_id: str
    answer: str
    score: float
    steps: int
    tool_calls: list[dict] = field(default_factory=list)
    total_latency_ms: int = 0
    total_tokens: int = 0
    status: str = "ok"
    error: str | None = None


async def run_agent(
    user_input: str,
    *,
    llm: LLM,
    tools: ToolRegistry,
    memory: MemoryStore,
    traces: TraceStore,
    config: Settings | None = None,
    expected: dict | None = None,
) -> AgentResult:
    cfg = config or default_settings
    run_id = traces.start_run(user_input, cfg.profile, cfg.describe()["flags"])

    step = 0
    tool_results: list[dict] = []
    total_latency = 0
    total_tokens = 0
    critique = ""
    answer = ""
    score = 0.0

    def next_step() -> int:
        nonlocal step
        step += 1
        return step

    # --- validate input ---
    if not user_input or not user_input.strip():
        traces.log(TraceEvent(run_id, next_step(), "error", "input", error="empty input"))
        traces.finish_run(run_id, "", 0.0, 0, 0, status="rejected")
        return AgentResult(run_id=run_id, answer="", score=0.0, steps=step,
                           status="rejected", error="empty input")

    try:
        # --- 1. understand ---
        traces.log(TraceEvent(run_id, next_step(), "understand", "input",
                              input=user_input[:2000]))

        # --- 2. retrieve ---
        context = ""
        if cfg.enable_memory:
            with Timer() as t:
                hits = memory.search(user_input, k=3)
            context = "\n".join(f"- {h['text']}" for h in hits)[: cfg.context_char_budget]
            traces.log(TraceEvent(run_id, next_step(), "retrieve", "memory",
                                  input=user_input, output={"hits": hits},
                                  latency_ms=t.ms))

        # --- planner / executor loop ---
        for iteration in range(cfg.max_steps):
            decision = _direct_answer(user_input) if not cfg.enable_planner else None

            if decision is None:
                with Timer() as t:
                    decision = await plan_next_step(
                        llm, tools, user_input, context, tool_results, critique
                    )
                total_latency += t.ms
                traces.log(TraceEvent(run_id, next_step(), "plan", "planner",
                                      input={"critique": critique, "ctx_chars": len(context)},
                                      output={"action": decision.action, "tool": decision.tool,
                                              "rationale": decision.rationale},
                                      latency_ms=t.ms))

            if decision.action == "call_tool" and cfg.enable_tools and decision.tool:
                with Timer() as t:
                    result = await tools.call(decision.tool, decision.tool_args or {})
                total_latency += t.ms
                tool_results.append({
                    "tool": decision.tool,
                    "args": decision.tool_args,
                    "status": result["status"],
                    "output": result.get("output", ""),
                })
                traces.log(TraceEvent(run_id, next_step(), "tool_call", decision.tool,
                                      input=decision.tool_args,
                                      output=result,
                                      latency_ms=t.ms,
                                      error=result.get("error")))
                # Feed tool results back into context
                context = (context + "\n" + str(result.get("output", ""))[:2000])\
                    [: cfg.context_char_budget]
                continue

            # answer path
            answer = decision.answer or ""
            if not answer:
                # Ask LLM directly for an answer
                with Timer() as t:
                    answer = await llm.complete(
                        f"Context:\n{context}\n\nUser: {user_input}\n\nAnswer concisely:",
                        system="You are a concise assistant. Ground answers in context when present.",
                    )
                total_latency += t.ms

            # --- 5. verify ---
            with Timer() as t:
                score = score_answer(user_input, answer, context, expected=expected)
            traces.log(TraceEvent(run_id, next_step(), "verify", "scorer",
                                  input={"answer_len": len(answer)},
                                  output={"score": score},
                                  latency_ms=t.ms))

            if score >= cfg.eval_pass_threshold or not cfg.enable_reflection:
                break

            # reflect → get critique and retry
            with Timer() as t:
                critique = await reflect(llm, user_input, answer, context)
            total_latency += t.ms
            traces.log(TraceEvent(run_id, next_step(), "reflect", "reflection",
                                  input={"score": score},
                                  output={"critique": critique[:400]},
                                  latency_ms=t.ms))
            # loop again with critique

        # --- final log + memory write ---
        traces.log(TraceEvent(run_id, next_step(), "final", "answer",
                              output={"answer": answer[:2000], "score": score}))

        if cfg.enable_memory and score >= cfg.eval_pass_threshold:
            memory.add(
                text=f"Q: {user_input}\nA: {answer}",
                meta={"score": score, "run_id": run_id},
            )

        traces.finish_run(run_id, answer, score, total_latency, total_tokens, status="ok")
        return AgentResult(run_id=run_id, answer=answer, score=score, steps=step,
                           tool_calls=tool_results, total_latency_ms=total_latency,
                           total_tokens=total_tokens)

    except Exception as e:
        traces.log(TraceEvent(run_id, next_step(), "error", "loop", error=str(e)))
        traces.finish_run(run_id, answer, score, total_latency, total_tokens, status="error")
        return AgentResult(run_id=run_id, answer=answer, score=score, steps=step,
                           status="error", error=str(e))


def _direct_answer(user_input: str) -> PlanDecision | None:
    """When the planner is disabled (ablation), route straight to the LLM."""
    return PlanDecision(action="answer", answer=None, rationale="planner disabled")
