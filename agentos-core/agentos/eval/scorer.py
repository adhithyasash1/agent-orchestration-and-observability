"""Local scoring without requiring an LLM call.

We expose two scoring modes:

  score_expected(answer, expected)  — exact/keyword match, used in benchmarks
  score_answer(user_input, answer, context, expected=None)
                                    — heuristic quality proxy used inside the
                                      agent loop when no explicit expected
                                      value is available

Heuristic penalises empty, refusal-only, or clearly non-answer outputs and
rewards overlap with the provided context. It is intentionally simple and
its limitations are documented in the README.
"""
from __future__ import annotations

import re


REFUSAL_PHRASES = (
    "i don't know",
    "i cannot",
    "i'm unable",
    "i was unable",
    "i do not have",
    "i encountered an error",
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def score_expected(answer: str, expected: dict | None) -> float | None:
    """Benchmark-time scoring. Returns None when no expectation given.

    `expected` may contain:
      - expected_contains: list of substrings, all must appear (case-insensitive)
      - expected_tool: tool name that must have been called (handled by caller)
      - expected_behavior: label, informational
    """
    if not expected:
        return None
    contains = expected.get("expected_contains") or []
    if not contains:
        return 1.0 if answer.strip() else 0.0
    hay = _norm(answer)
    hits = sum(1 for c in contains if _norm(str(c)) in hay)
    return hits / len(contains)


def score_answer(user_input: str, answer: str, context: str,
                 expected: dict | None = None) -> float:
    """Return a 0..1 heuristic score."""
    # If caller provided ground-truth, use that directly.
    g = score_expected(answer, expected)
    if g is not None:
        return g

    if not answer or not answer.strip():
        return 0.0

    norm = _norm(answer)
    if any(p in norm for p in REFUSAL_PHRASES):
        # Refusals aren't automatically bad — empty input or fabrication should
        # produce them — but they shouldn't score as a good answer.
        return 0.3

    score = 0.5  # baseline for a non-empty, non-refusal answer

    # Reward grounding: some overlap with context words >= 4 chars
    if context:
        ctx_words = {w for w in re.findall(r"[A-Za-z0-9]{4,}", context.lower())}
        ans_words = {w for w in re.findall(r"[A-Za-z0-9]{4,}", norm)}
        if ctx_words:
            overlap = len(ctx_words & ans_words) / max(len(ctx_words), 1)
            score += min(0.3, overlap * 3)

    # Reward reasonable length
    if 40 <= len(answer) <= 2000:
        score += 0.1

    # Penalise fabrication markers (placeholder text)
    fab_markers = ["lorem ipsum", "placeholder", "as an ai language model"]
    if any(m in norm for m in fab_markers):
        score -= 0.2

    return max(0.0, min(1.0, score))
