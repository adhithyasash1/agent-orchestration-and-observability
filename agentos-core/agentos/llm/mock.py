"""Deterministic mock LLM.

Used by tests and the minimal profile so the project runs with zero external
services. Recognises a handful of patterns from the planner prompt and from
direct answer prompts, and produces plausible outputs.

This is NOT an attempt at intelligence — it is a stable stub so the agent
loop, tool calls, and memory paths can be exercised end-to-end.
"""
from __future__ import annotations

import json
import re


class MockLLM:
    def __init__(self):
        self._calls = 0

    async def complete(self, prompt: str, system: str | None = None) -> str:
        self._calls += 1
        p = prompt.lower()

        # Planner prompt — respond with structured JSON
        if "respond in json only" in p or "action" in p and "tool" in p and "rationale" in p:
            return self._plan(prompt)

        # Reflection prompt — emit a short critique
        if "critique" in p and ("answer" in p or "response" in p):
            return "Answer could be more specific and grounded in context."

        # Default: extract key phrase and echo
        return self._direct_answer(prompt)

    # --- internals ---

    def _plan(self, prompt: str) -> str:
        user_line = self._extract_user(prompt)
        user = user_line.lower()

        # If a tool was already called, answer from its output
        tool_section = re.search(
            r"prior tool results.*?:\s*(.*?)(?:prior critique|user request)",
            prompt, re.DOTALL | re.IGNORECASE,
        )
        has_prior_tool = tool_section and tool_section.group(1).strip() not in ("(none)", "")

        # Arithmetic → calculator (only if not already called)
        if not has_prior_tool and (
            re.search(r"\b(\d+\s*[\+\-\*/]\s*\d+)", user) or "calculate" in user
        ) and "calculator" in prompt:
            expr_match = re.search(r"[\d\s\+\-\*/\(\)\.]+", user_line)
            return json.dumps({
                "action": "call_tool",
                "tool": "calculator",
                "tool_args": {"expression": (expr_match.group(0) if expr_match else user_line).strip()},
                "rationale": "arithmetic detected",
                "answer": None,
            })

        # URL → http_fetch (only if not already called)
        url_match = re.search(r"https?://\S+", user_line)
        if not has_prior_tool and url_match and "http_fetch" in prompt:
            return json.dumps({
                "action": "call_tool",
                "tool": "http_fetch",
                "tool_args": {"url": url_match.group(0)},
                "rationale": "url detected",
                "answer": None,
            })

        # Tool results present → fabricate an answer that includes the output
        if has_prior_tool:
            out_match = re.search(r"ok.*?:\s*(.+)", tool_section.group(1))
            tool_out = (out_match.group(1).strip() if out_match
                        else tool_section.group(1).strip())[:200]
            return json.dumps({
                "action": "answer",
                "tool": None,
                "tool_args": {},
                "rationale": "tool result in hand",
                "answer": f"The result is {tool_out}.",
            })

        # Prefer direct-answer knowledge; fall back to context if present
        answer = self._direct_answer(user_line)
        if answer.startswith("I don't have enough"):
            ctx_match = re.search(
                r"retrieved context.*?:\s*(.*?)(?:prior tool|user request)",
                prompt, re.DOTALL | re.IGNORECASE,
            )
            if ctx_match:
                ctx = ctx_match.group(1).strip()
                if ctx and ctx not in ("(none)", "(empty)"):
                    answer = ctx[:400]
        return json.dumps({
            "action": "answer",
            "tool": None,
            "tool_args": {},
            "rationale": "answered from context/knowledge",
            "answer": answer,
        })

    def _extract_user(self, prompt: str) -> str:
        m = re.search(r"user request:\s*(.*)", prompt, re.IGNORECASE | re.DOTALL)
        if m:
            return m.group(1).split("\n")[0].strip()
        m = re.search(r"user:\s*(.*)", prompt, re.IGNORECASE)
        if m:
            return m.group(1).split("\n")[0].strip()
        return prompt.strip()[:500]

    def _direct_answer(self, prompt: str) -> str:
        q = self._extract_user(prompt).lower()
        # Tiny knowledge stub so benchmark tests have *some* signal
        table = {
            "capital of france": "The capital of France is Paris.",
            "binary search": "Binary search runs in O(log n) time.",
            "list and a tuple": "Lists are mutable; tuples are immutable in Python.",
            "acid": "ACID: Atomicity, Consistency, Isolation, Durability.",
            "rest api": "A REST API exposes resources over HTTP using standard verbs.",
            "supervised": "Supervised learning uses labeled data; unsupervised does not.",
            "median": "Sorted: 1, 2, 4, 5, 7, 8, 9. Median is 5.",
            "probability both are red": "3/10 (= 0.3 = 30%).",
            "answer to life": "42.",
            "center": "5.",
        }
        for key, val in table.items():
            if key in q:
                return val
        return "I don't have enough information to answer confidently."
