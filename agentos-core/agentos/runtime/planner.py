"""Planner: decides the next step.

Given the user input, retrieved context, and tool outputs so far, the planner
returns a PlanDecision with one of three actions:
  - call_tool: execute a registered tool
  - answer:    produce a final answer
  - refine:    re-plan using prior critique

The decision is made by asking the LLM for a small JSON blob. We keep the
prompt tiny so mock LLMs and small local models can follow it.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..llm.protocol import LLM
from ..tools.registry import ToolRegistry


@dataclass
class PlanDecision:
    action: str  # "call_tool" | "answer" | "refine"
    tool: str | None = None
    tool_args: dict | None = None
    rationale: str = ""
    answer: str | None = None


PLANNER_PROMPT = """You are the planner for a local agent runtime.
Goal: decide the next step for the user's request.

Available tools:
{tool_list}

Retrieved context (may be empty):
{context}

Prior tool results (may be empty):
{tool_results}

Prior critique (only present on refine):
{critique}

User request: {user_input}

Respond in JSON only with this schema:
{{"action": "call_tool" | "answer",
  "tool": "<tool_name or null>",
  "tool_args": {{...}},
  "rationale": "<one sentence>",
  "answer": "<final answer if action=answer, else null>"}}

Rules:
- Prefer "answer" when you can respond from existing context.
- Use "call_tool" only when a tool is clearly needed.
- Keep answers grounded in the provided context when it is relevant.
"""


async def plan_next_step(
    llm: LLM,
    tools: ToolRegistry,
    user_input: str,
    context: str,
    tool_results: list[dict],
    critique: str = "",
) -> PlanDecision:
    tool_list = tools.describe() or "(no tools enabled)"
    prompt = PLANNER_PROMPT.format(
        tool_list=tool_list,
        context=context[:2000] or "(none)",
        tool_results=_summarize_tool_results(tool_results),
        critique=critique or "(none)",
        user_input=user_input,
    )
    raw = await llm.complete(prompt, system="You output only valid JSON.")
    return _parse_decision(raw)


def _summarize_tool_results(results: list[dict]) -> str:
    if not results:
        return "(none)"
    out = []
    for r in results[-5:]:
        status = r.get("status", "?")
        tool = r.get("tool", "?")
        summary = str(r.get("output", ""))[:300]
        out.append(f"- {tool} [{status}]: {summary}")
    return "\n".join(out)


def _parse_decision(raw: str) -> PlanDecision:
    """Robust JSON extraction. Falls back to plain answer."""
    text = raw.strip()
    # Strip fenced code
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
            return PlanDecision(
                action=data.get("action", "answer"),
                tool=data.get("tool") or None,
                tool_args=data.get("tool_args") or {},
                rationale=data.get("rationale", ""),
                answer=data.get("answer"),
            )
        except json.JSONDecodeError:
            pass
    # Fallback: treat whole text as final answer
    return PlanDecision(action="answer", answer=text, rationale="parser fallback")
