"""SQLite-backed trace and step log store."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


TABLE_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    user_input TEXT NOT NULL,
    final_output TEXT,
    score REAL,
    profile TEXT,
    flags TEXT,
    prompt_version TEXT,
    user_feedback TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    total_latency_ms INTEGER,
    total_tokens INTEGER,
    status TEXT DEFAULT 'running',
    starred INTEGER NOT NULL DEFAULT 0,
    tag TEXT,
    session_id TEXT,
    schedule_id TEXT
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
    attributes TEXT,
    ts TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS run_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    stage TEXT NOT NULL,
    state TEXT,
    action TEXT,
    observation TEXT,
    score REAL,
    done INTEGER DEFAULT 0,
    status TEXT,
    attributes TEXT,
    ts TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS scheduled_runs (
    schedule_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    user_input TEXT NOT NULL,
    tag TEXT,
    session_id TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
"""

INDEX_SCHEMA = """
CREATE INDEX IF NOT EXISTS idx_events_run ON trace_events(run_id, step);
CREATE INDEX IF NOT EXISTS idx_transitions_run ON run_transitions(run_id, step);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_starred_started_at ON runs(starred DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_tag ON runs(tag);
CREATE INDEX IF NOT EXISTS idx_runs_session_id ON runs(session_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_enabled ON scheduled_runs(enabled);
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
    attributes: dict[str, Any] | None = None
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
            _dumps(self.attributes),
            self.ts,
        )


@dataclass
class RunTransition:
    run_id: str
    step: int
    stage: str
    state: Any = None
    action: Any = None
    observation: Any = None
    score: float | None = None
    done: bool = False
    status: str | None = None
    attributes: dict[str, Any] | None = None
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_row(self) -> tuple:
        return (
            self.run_id,
            self.step,
            self.stage,
            _dumps(self.state),
            _dumps(self.action),
            _dumps(self.observation),
            self.score,
            1 if self.done else 0,
            self.status,
            _dumps(self.attributes),
            self.ts,
        )


def _dumps(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        return v[:12000]
    try:
        return json.dumps(v, default=str)[:12000]
    except Exception:
        return str(v)[:12000]


_initialized_dbs: set[str] = set()
SENSITIVE_FIELD_MARKERS = (
    "api_key",
    "apikey",
    "authorization",
    "auth",
    "token",
    "secret",
    "password",
    "cookie",
    "session",
    "bearer",
)


class TraceStore:
    def __init__(self, db_path: str, config: Any | None = None):
        self.db_path = db_path
        self.config = config
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        
        global _initialized_dbs
        if db_path not in _initialized_dbs:
            with self._conn() as c:
                c.executescript(TABLE_SCHEMA)
                self._ensure_column(c, "runs", "prompt_version", "TEXT")
                self._ensure_column(c, "runs", "user_feedback", "TEXT")
                self._ensure_column(c, "runs", "starred", "INTEGER NOT NULL DEFAULT 0")
                self._ensure_column(c, "runs", "tag", "TEXT")
                self._ensure_column(c, "runs", "session_id", "TEXT")
                self._ensure_column(c, "runs", "schedule_id", "TEXT")
                self._ensure_column(c, "trace_events", "attributes", "TEXT")
                c.executescript(INDEX_SCHEMA)
            _initialized_dbs.add(db_path)
            
        self._otel = _OTelBridge(config)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def close(self) -> None:
        """Compatibility no-op: connections are scoped per operation."""
        return None

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
        cols = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    @property
    def otel_enabled(self) -> bool:
        return self._otel.enabled

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def start_run(
        self,
        user_input: str,
        profile: str,
        flags: dict,
        prompt_version: str = "v1",
        *,
        starred: bool = False,
        tag: str | None = None,
        session_id: str | None = None,
        schedule_id: str | None = None,
    ) -> str:
        run_id = uuid.uuid4().hex[:12]
        started_at = self._now_iso()
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO runs
                (run_id, user_input, profile, flags, prompt_version, started_at,
                 starred, tag, session_id, schedule_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    user_input,
                    profile,
                    json.dumps(flags),
                    prompt_version,
                    started_at,
                    1 if starred else 0,
                    (tag or None),
                    (session_id or None),
                    (schedule_id or None),
                ),
            )
        self._otel.start_run(run_id, profile=profile, prompt_version=prompt_version, flags=flags)
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
        finished_at = self._now_iso()
        with self._conn() as c:
            c.execute(
                """UPDATE runs SET final_output=?, score=?, finished_at=?,
                   total_latency_ms=?, total_tokens=?, status=? WHERE run_id=?""",
                (final_output, score, finished_at, total_latency_ms, total_tokens, status, run_id),
            )
        self._otel.finish_run(run_id, score=score, total_latency_ms=total_latency_ms, total_tokens=total_tokens, status=status)

    def log(self, event: TraceEvent) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT INTO trace_events
                   (run_id, step, kind, name, input, output, latency_ms,
                    tokens_in, tokens_out, error, attributes, ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                event.to_row(),
            )
        self._otel.log_event(event)
        self._console_stream("event", event)

    def log_transition(self, transition: RunTransition) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT INTO run_transitions
                   (run_id, step, stage, state, action, observation, score,
                    done, status, attributes, ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                transition.to_row(),
            )
        self._console_stream("transition", transition)

    def _console_stream(self, kind: str, item: Any) -> None:
        """Stream colored summaries to the terminal for live debugging."""
        # ANSI Escape Codes
        BLUE = "\033[94m"
        CYAN = "\033[96m"
        GREEN = "\033[92m"
        YELLOW = "\033[93m"
        RED = "\033[91m"
        BOLD = "\033[1m"
        RESET = "\033[0m"

        ts = datetime.now().strftime("%H:%M:%S")
        prefix = f"{RESET}[{ts}] {BOLD}"

        if self.config and not getattr(self.config, "debug_verbose", True):
            return

        if kind == "event":
            color = BLUE if item.kind == "understand" else YELLOW
            print(f"{prefix}{color}{item.kind.upper()}{RESET} | step {item.step} | {item.name or ''}")
            if item.error:
                print(f"  {RED}Error: {item.error}{RESET}")
        
        elif kind == "transition":
            color = CYAN if item.stage == "plan" else GREEN
            status = f" ({item.status})" if item.status else ""
            print(f"{prefix}{color}{item.stage.upper()}{RESET} | step {item.step}{status}")
            
            if item.action:
                action_type = item.action.get("action", item.action.get("type"))
                goal = item.action.get("goal")
                rationale = item.action.get("rationale")
                
                if goal:
                    print(f"  {BOLD}Goal:{RESET} {goal}")
                if rationale:
                    print(f"  {BOLD}Rationale:{RESET} {rationale}")
                
                print(f"  {BOLD}Action:{RESET} {action_type}")
                if "tool" in item.action:
                    tool_args = _format_console_payload(item.action.get("tool_args", {}))
                    print(f"    {BOLD}Tool:{RESET} {item.action['tool']}({tool_args})")
            
            if item.observation:
                obs_summary = item.observation.get("summary", item.observation.get("observation_summary", ""))
                if obs_summary:
                    print(f"  {BOLD}Observation:{RESET} {obs_summary}")
                elif "error" in item.observation:
                    print(f"  {RED}Observation Error:{RESET} {item.observation['error']}{RESET}")
            
            if item.done:
                print(f"  {BOLD}{GREEN}COMPLETED{RESET}")

    def record_feedback(self, run_id: str, feedback: dict[str, Any]) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE runs SET user_feedback=? WHERE run_id=?",
                (json.dumps(feedback), run_id),
            )
        self._otel.annotate_run(run_id, {"user_feedback": feedback})

    def clear_history(self) -> None:
        """Wipe all run history and trace logs for a clean demo slate."""
        with self._conn() as c:
            c.execute("DELETE FROM scheduled_runs")
            c.execute("DELETE FROM run_transitions")
            c.execute("DELETE FROM trace_events")
            c.execute("DELETE FROM runs")

        # VACUUM must be run outside of a transaction.
        tmp_conn = sqlite3.connect(self.db_path)
        try:
            tmp_conn.execute("VACUUM")
        finally:
            tmp_conn.close()

    def get_events_since(self, run_id: str, last_id: int) -> list[dict]:
        """Return all trace_events for run_id with id > last_id, ordered by id."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM trace_events WHERE run_id=? AND id>? ORDER BY id",
                (run_id, last_id),
            ).fetchall()
        return [_loads_row(dict(r)) for r in rows]

    def update_run(
        self,
        run_id: str,
        **changes: Any,
    ) -> dict | None:
        fields: list[str] = []
        params: list[Any] = []
        if "starred" in changes:
            fields.append("starred=?")
            params.append(1 if changes.get("starred") else 0)
        if "tag" in changes:
            fields.append("tag=?")
            params.append(changes.get("tag") or None)
        if "session_id" in changes:
            fields.append("session_id=?")
            params.append(changes.get("session_id") or None)
        if not fields:
            return self.get_run(run_id)

        params.append(run_id)
        with self._conn() as c:
            c.execute(f"UPDATE runs SET {', '.join(fields)} WHERE run_id=?", params)
        return self.get_run(run_id)

    def list_session_runs(
        self,
        session_id: str,
        *,
        limit: int = 6,
        exclude_run_id: str | None = None,
    ) -> list[dict]:
        if not session_id:
            return []
        sql = """
            SELECT *
            FROM runs
            WHERE session_id=?
              AND final_output IS NOT NULL
              AND status != 'running'
        """
        params: list[Any] = [session_id]
        if exclude_run_id:
            sql += " AND run_id != ?"
            params.append(exclude_run_id)
        sql += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        with self._conn() as c:
            rows = c.execute(sql, params).fetchall()
            metrics = self._run_metrics(c, [row["run_id"] for row in rows])
        hydrated = [self._hydrate_run_row(row, metrics.get(row["run_id"])) for row in rows]
        hydrated.reverse()
        return hydrated

    def tool_latency_breakdown(self, *, limit_runs: int = 100) -> list[dict[str, Any]]:
        with self._conn() as c:
            run_rows = c.execute(
                "SELECT run_id FROM runs ORDER BY started_at DESC LIMIT ?",
                (limit_runs,),
            ).fetchall()
            run_ids = [row["run_id"] for row in run_rows]
            if not run_ids:
                return []
            placeholders = ",".join("?" for _ in run_ids)
            rows = c.execute(
                f"""
                SELECT name AS tool,
                       COUNT(*) AS call_count,
                       AVG(COALESCE(latency_ms, 0)) AS avg_latency_ms,
                       MAX(COALESCE(latency_ms, 0)) AS max_latency_ms,
                       SUM(COALESCE(latency_ms, 0)) AS total_latency_ms
                FROM trace_events
                WHERE kind='tool_call'
                  AND run_id IN ({placeholders})
                  AND name IS NOT NULL
                GROUP BY name
                ORDER BY total_latency_ms DESC, call_count DESC
                """,
                run_ids,
            ).fetchall()
        return [
            {
                "tool": row["tool"],
                "call_count": int(row["call_count"] or 0),
                "avg_latency_ms": round(float(row["avg_latency_ms"] or 0.0), 2),
                "max_latency_ms": int(row["max_latency_ms"] or 0),
                "total_latency_ms": int(row["total_latency_ms"] or 0),
            }
            for row in rows
        ]

    def create_schedule(
        self,
        *,
        name: str,
        cron: str,
        user_input: str,
        tag: str | None = None,
        session_id: str | None = None,
        timezone_name: str = "UTC",
        enabled: bool = True,
    ) -> dict:
        schedule_id = uuid.uuid4().hex[:12]
        now = self._now_iso()
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO scheduled_runs
                (schedule_id, name, cron, user_input, tag, session_id, timezone,
                 enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    schedule_id,
                    name,
                    cron,
                    user_input,
                    tag or None,
                    session_id or None,
                    timezone_name or "UTC",
                    1 if enabled else 0,
                    now,
                    now,
                ),
            )
        return self.get_schedule(schedule_id) or {}

    def list_schedules(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM scheduled_runs ORDER BY created_at DESC"
            ).fetchall()
        return [self._hydrate_schedule_row(row) for row in rows]

    def get_schedule(self, schedule_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM scheduled_runs WHERE schedule_id=?",
                (schedule_id,),
            ).fetchone()
        if not row:
            return None
        return self._hydrate_schedule_row(row)

    def update_schedule(self, schedule_id: str, **changes: Any) -> dict | None:
        allowed = {
            "name",
            "cron",
            "user_input",
            "tag",
            "session_id",
            "timezone",
            "enabled",
            "last_run_at",
            "next_run_at",
            "run_count",
            "last_error",
        }
        fields: list[str] = []
        params: list[Any] = []
        for key, value in changes.items():
            if key not in allowed:
                continue
            fields.append(f"{key}=?")
            if key == "enabled":
                params.append(1 if value else 0)
            else:
                params.append(value)
        if not fields:
            return self.get_schedule(schedule_id)
        fields.append("updated_at=?")
        params.append(self._now_iso())
        params.append(schedule_id)
        with self._conn() as c:
            c.execute(
                f"UPDATE scheduled_runs SET {', '.join(fields)} WHERE schedule_id=?",
                params,
            )
        return self.get_schedule(schedule_id)

    def delete_schedule(self, schedule_id: str) -> bool:
        with self._conn() as c:
            cur = c.execute(
                "DELETE FROM scheduled_runs WHERE schedule_id=?",
                (schedule_id,),
            )
        return bool(cur.rowcount)

    def _hydrate_schedule_row(self, row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        data = dict(row)
        data["enabled"] = bool(data.get("enabled"))
        data["run_count"] = int(data.get("run_count") or 0)
        return data

    def _run_metrics(self, conn: sqlite3.Connection, run_ids: list[str]) -> dict[str, dict[str, Any]]:
        metrics = {
            run_id: {
                "reflection_count": 0,
                "tool_call_count": 0,
                "tool_call_success_count": 0,
                "initial_score": None,
            }
            for run_id in run_ids
        }
        if not run_ids:
            return metrics

        placeholders = ",".join("?" for _ in run_ids)
        rows = conn.execute(
            f"""
            SELECT run_id, stage, score, status
            FROM run_transitions
            WHERE run_id IN ({placeholders})
            ORDER BY id
            """,
            run_ids,
        ).fetchall()
        for row in rows:
            metric = metrics[row["run_id"]]
            if row["stage"] == "reflection":
                metric["reflection_count"] += 1
            elif row["stage"] == "tool_result":
                metric["tool_call_count"] += 1
                if row["status"] == "ok":
                    metric["tool_call_success_count"] += 1
            elif row["stage"] == "verify" and metric["initial_score"] is None and row["score"] is not None:
                metric["initial_score"] = float(row["score"])
        return metrics

    def _hydrate_run_row(
        self,
        row: sqlite3.Row | dict[str, Any],
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = _loads_row(dict(row))
        for key in ("flags", "user_feedback"):
            value = data.get(key)
            if not value or not isinstance(value, str):
                continue
            try:
                data[key] = json.loads(value)
            except Exception:
                data[key] = value

        metric = metrics or {}
        reflection_count = int(metric.get("reflection_count") or 0)
        tool_call_count = int(metric.get("tool_call_count") or 0)
        tool_call_success_count = int(metric.get("tool_call_success_count") or 0)
        initial_score = metric.get("initial_score")
        if initial_score is None:
            initial_score = float(data.get("score") or 0.0)
        final_score = float(data.get("score") or 0.0)

        data["reflection_count"] = reflection_count
        data["tool_call_count"] = tool_call_count
        data["tool_call_success_count"] = tool_call_success_count
        data["initial_score"] = float(initial_score)
        data["starred"] = bool(data.get("starred"))
        data["reflection_roi"] = (
            round(max(final_score - float(initial_score), 0.0), 4) if reflection_count else 0.0
        )
        return data

    def list_runs(
        self,
        limit: int = 50,
        *,
        search: str | None = None,
        min_score: float | None = None,
        max_score: float | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        starred: bool | None = None,
        tag: str | None = None,
        session_id: str | None = None,
    ) -> list[dict]:
        where: list[str] = []
        params: list[Any] = []
        if search:
            where.append("LOWER(user_input) LIKE ?")
            params.append(f"%{search.strip().lower()}%")
        if min_score is not None:
            where.append("COALESCE(score, 0) >= ?")
            params.append(float(min_score))
        if max_score is not None:
            where.append("COALESCE(score, 0) <= ?")
            params.append(float(max_score))
        if date_from:
            where.append("started_at >= ?")
            params.append(date_from)
        if date_to:
            where.append("started_at <= ?")
            params.append(date_to)
        if starred is not None:
            where.append("starred = ?")
            params.append(1 if starred else 0)
        if tag:
            where.append("tag = ?")
            params.append(tag)
        if session_id:
            where.append("session_id = ?")
            params.append(session_id)

        sql = "SELECT * FROM runs"
        if where:
            sql += f" WHERE {' AND '.join(where)}"
        sql += " ORDER BY starred DESC, started_at DESC LIMIT ?"
        params.append(limit)
        with self._conn() as c:
            rows = c.execute(sql, params).fetchall()
            metrics = self._run_metrics(c, [row["run_id"] for row in rows])
        return [self._hydrate_run_row(r, metrics.get(r["run_id"])) for r in rows]

    def get_run(self, run_id: str) -> dict | None:
        with self._conn() as c:
            run = c.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
            if not run:
                return None
            events = c.execute(
                "SELECT * FROM trace_events WHERE run_id=? ORDER BY step, id",
                (run_id,),
            ).fetchall()
            transitions = c.execute(
                "SELECT * FROM run_transitions WHERE run_id=? ORDER BY step, id",
                (run_id,),
            ).fetchall()
            metrics = self._run_metrics(c, [run_id])
        data = self._hydrate_run_row(run, metrics.get(run_id))
        data["events"] = [_loads_row(dict(event)) for event in events]
        data["transitions"] = [_loads_row(dict(transition)) for transition in transitions]
        return data

    def export_run_markdown(self, run_id: str) -> str | None:
        run = self.get_run(run_id)
        if not run:
            return None
        tool_lines: list[str] = []
        for event in run.get("events", []):
            if event.get("kind") != "tool_call":
                continue
            output = event.get("output")
            status = output.get("status", "unknown") if isinstance(output, dict) else "unknown"
            tool_lines.append(
                f"- `{event.get('name')}`: status `{status}`"
                f", latency {event.get('latency_ms') or 0} ms"
            )
        transition_lines = [
            f"- Step {transition.get('step')}: `{transition.get('stage')}`"
            f" [{transition.get('status') or 'n/a'}] score {transition.get('score')}"
            for transition in run.get("transitions", [])
        ]
        feedback = run.get("user_feedback") or {}
        sections = [
            f"# Run Report `{run['run_id']}`",
            "",
            "## Overview",
            f"- Prompt: {run.get('user_input') or ''}",
            f"- Status: `{run.get('status')}`",
            f"- Score: {run.get('score') or 0}",
            f"- Prompt version: `{run.get('prompt_version')}`",
            f"- Started: {run.get('started_at') or 'n/a'}",
            f"- Finished: {run.get('finished_at') or 'n/a'}",
            f"- Latency: {run.get('total_latency_ms') or 0} ms",
            f"- Tag: `{run.get('tag') or 'none'}`",
            f"- Session: `{run.get('session_id') or 'none'}`",
            "",
            "## Final Output",
            run.get("final_output") or "_No final output recorded._",
            "",
            "## Tool Calls",
            *(tool_lines or ["_No tool calls recorded._"]),
            "",
            "## Transitions",
            *(transition_lines or ["_No transitions recorded._"]),
            "",
            "## Feedback",
            f"- Rating: {feedback.get('rating', 'n/a')}",
            f"- Notes: {feedback.get('notes', 'n/a')}",
        ]
        return "\n".join(sections)


def _loads_row(row: dict[str, Any]) -> dict[str, Any]:
    for key in ("input", "output", "state", "action", "observation", "attributes"):
        value = row.get(key)
        if not value or not isinstance(value, str):
            continue
        try:
            row[key] = json.loads(value)
        except Exception:
            row[key] = value
    return row


class Timer:
    """Context manager for measuring wall-clock latency."""
    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = int((time.perf_counter() - self.start) * 1000)


class _OTelBridge:
    def __init__(self, config: Any | None):
        self.enabled = False
        self._run_spans: dict[str, Any] = {}
        if not config or not getattr(config, "enable_otel", False):
            return
        try:
            from opentelemetry import trace as otel_trace
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
        except Exception:
            return

        provider = TracerProvider(
            resource=Resource.create({"service.name": getattr(config, "otel_service_name", "agentos-core")})
        )
        endpoint = getattr(config, "otel_exporter_otlp_endpoint", "") or ""
        exporter = None
        if endpoint:
            try:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

                exporter = OTLPSpanExporter(endpoint=endpoint)
            except Exception:
                exporter = None
        if exporter is None:
            exporter = ConsoleSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(exporter))
        try:
            otel_trace.set_tracer_provider(provider)
        except Exception:
            pass

        self._trace = otel_trace
        self._tracer = otel_trace.get_tracer(getattr(config, "otel_service_name", "agentos-core"))
        self.enabled = True

    def start_run(self, run_id: str, **attributes: Any) -> None:
        if not self.enabled:
            return
        span = self._tracer.start_span("agent.run", attributes=_otel_attributes({"run_id": run_id, **attributes}))
        self._run_spans[run_id] = span

    def annotate_run(self, run_id: str, attributes: dict[str, Any]) -> None:
        if not self.enabled:
            return
        span = self._run_spans.get(run_id)
        if not span:
            return
        for key, value in _otel_attributes(attributes).items():
            span.set_attribute(key, value)

    def log_event(self, event: TraceEvent) -> None:
        if not self.enabled:
            return
        parent = self._run_spans.get(event.run_id)
        context = self._trace.set_span_in_context(parent) if parent else None
        span = self._tracer.start_span(
            f"agent.{event.kind}",
            context=context,
            attributes=_otel_attributes(
                {
                    "run_id": event.run_id,
                    "step": event.step,
                    "kind": event.kind,
                    "name": event.name,
                    "latency_ms": event.latency_ms,
                    "error": event.error,
                    **(event.attributes or {}),
                }
            ),
        )
        span.end()

    def finish_run(self, run_id: str, **attributes: Any) -> None:
        if not self.enabled:
            return
        span = self._run_spans.pop(run_id, None)
        if not span:
            return
        for key, value in _otel_attributes(attributes).items():
            span.set_attribute(key, value)
        span.end()


def _otel_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in attributes.items():
        if value is None:
            continue
        if isinstance(value, (str, bool, int, float)):
            out[key] = value
        else:
            out[key] = json.dumps(value, default=str)[:4000]
    return out


def _format_console_payload(value: Any) -> str:
    redacted = _redact_sensitive(value)
    try:
        text = json.dumps(redacted, default=str)
    except Exception:
        text = str(redacted)
    return text[:400]


def _redact_sensitive(value: Any, key_hint: str | None = None) -> Any:
    if isinstance(value, dict):
        return {
            key: _redact_sensitive(item, str(key))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_sensitive(item, key_hint) for item in value]
    if key_hint and any(marker in key_hint.lower() for marker in SENSITIVE_FIELD_MARKERS):
        return "***"
    return value
