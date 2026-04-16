"""SQLite-backed trace store.

Every interesting event in an agent run becomes a row in `trace_events`.
The UI and benchmarks both read from this one source of truth.

Schema is intentionally small:
  run_id      — groups events from one request
  step        — monotonic integer inside a run
  kind        — one of: understand, retrieve, plan, tool_call, verify, error, final
  name        — tool/node name or short label
  input/output— JSON strings (may be truncated)
  latency_ms  — int, measured by the caller
  tokens_in/tokens_out — ints, best-effort
  error       — nullable error string
  ts          — ISO timestamp
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    user_input TEXT NOT NULL,
    final_output TEXT,
    score REAL,
    profile TEXT,
    flags TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    total_latency_ms INTEGER,
    total_tokens INTEGER,
    status TEXT DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS trace_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT,
    input TEXT,
    output TEXT,
    latency_ms INTEGER,
    tokens_in INTEGER,
    tokens_out INTEGER,
    error TEXT,
    ts TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_events_run ON trace_events(run_id, step);
"""


@dataclass
class TraceEvent:
    run_id: str
    step: int
    kind: str
    name: str | None = None
    input: Any = None
    output: Any = None
    latency_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    error: str | None = None
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_row(self) -> tuple:
        return (
            self.run_id,
            self.step,
            self.kind,
            self.name,
            _dumps(self.input),
            _dumps(self.output),
            self.latency_ms,
            self.tokens_in,
            self.tokens_out,
            self.error,
            self.ts,
        )


def _dumps(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, default=str)[:8000]
    except Exception:
        return str(v)[:8000]


class TraceStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    def _conn(self):
        c = sqlite3.connect(self.db_path)
        c.row_factory = sqlite3.Row
        return c

    # --- run lifecycle ---
    def start_run(self, user_input: str, profile: str, flags: dict) -> str:
        run_id = uuid.uuid4().hex[:12]
        with self._conn() as c:
            c.execute(
                "INSERT INTO runs (run_id, user_input, profile, flags, started_at) VALUES (?, ?, ?, ?, ?)",
                (run_id, user_input, profile, json.dumps(flags),
                 datetime.now(timezone.utc).isoformat()),
            )
        return run_id

    def finish_run(
        self,
        run_id: str,
        final_output: str,
        score: float,
        total_latency_ms: int,
        total_tokens: int,
        status: str = "ok",
    ) -> None:
        with self._conn() as c:
            c.execute(
                """UPDATE runs SET final_output=?, score=?, finished_at=?,
                   total_latency_ms=?, total_tokens=?, status=? WHERE run_id=?""",
                (final_output, score, datetime.now(timezone.utc).isoformat(),
                 total_latency_ms, total_tokens, status, run_id),
            )

    # --- event logging ---
    def log(self, event: TraceEvent) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT INTO trace_events
                   (run_id, step, kind, name, input, output, latency_ms,
                    tokens_in, tokens_out, error, ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                event.to_row(),
            )

    # --- reads ---
    def list_runs(self, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def get_run(self, run_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
            if not r:
                return None
            events = c.execute(
                "SELECT * FROM trace_events WHERE run_id=? ORDER BY step",
                (run_id,),
            ).fetchall()
        return {**dict(r), "events": [dict(e) for e in events]}


class Timer:
    """Context manager for measuring wall-clock latency."""
    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = int((time.perf_counter() - self.start) * 1000)
