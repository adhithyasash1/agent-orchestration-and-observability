"""Local-first memory store.

Uses SQLite FTS5 for keyword search over stored snippets. No network, no
external vector DB, no embedding service required. When FTS5 is unavailable
we fall back to LIKE-based search — still local, just slower.

The store is intentionally small: one table, two columns + metadata. Anything
more ambitious (embeddings, graph memory) belongs behind a feature flag and
lives outside this file.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class MemoryStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._fts_available = False
        self._init_schema()

    def _conn(self):
        c = sqlite3.connect(self.db_path)
        c.row_factory = sqlite3.Row
        return c

    def _init_schema(self) -> None:
        with self._conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    text TEXT NOT NULL,
                    meta TEXT,
                    created_at REAL NOT NULL
                )
            """)
            # Try FTS5 virtual table
            try:
                c.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
                    USING fts5(text, content='memory', content_rowid='id')
                """)
                c.execute("""
                    CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
                      INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text);
                    END
                """)
                c.execute("""
                    CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
                      INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.id, old.text);
                    END
                """)
                self._fts_available = True
            except sqlite3.OperationalError:
                self._fts_available = False

    def add(self, text: str, meta: dict | None = None) -> int:
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO memory (text, meta, created_at) VALUES (?, ?, ?)",
                (text, json.dumps(meta or {}), time.time()),
            )
            return cur.lastrowid

    def search(self, query: str, k: int = 3) -> list[dict]:
        if not query.strip():
            return []
        rows: list[sqlite3.Row]
        if self._fts_available:
            # Escape FTS special chars, keep it simple: quote the phrase
            sanitized = query.replace('"', " ").strip()
            if not sanitized:
                return []
            try:
                with self._conn() as c:
                    rows = c.execute(
                        """SELECT m.id, m.text, m.meta, m.created_at, bm25(memory_fts) AS rank
                           FROM memory_fts
                           JOIN memory m ON m.id = memory_fts.rowid
                           WHERE memory_fts MATCH ?
                           ORDER BY rank LIMIT ?""",
                        (f'"{sanitized}"', k),
                    ).fetchall()
            except sqlite3.OperationalError:
                rows = self._like_search(query, k)
        else:
            rows = self._like_search(query, k)

        results = []
        for r in rows:
            d = dict(r)
            try:
                d["meta"] = json.loads(d.get("meta") or "{}")
            except Exception:
                d["meta"] = {}
            results.append(d)
        return results

    def _like_search(self, query: str, k: int) -> list[sqlite3.Row]:
        pattern = f"%{query.strip()}%"
        with self._conn() as c:
            return c.execute(
                "SELECT * FROM memory WHERE text LIKE ? ORDER BY created_at DESC LIMIT ?",
                (pattern, k),
            ).fetchall()

    def count(self) -> int:
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) AS n FROM memory").fetchone()[0]

    def clear(self) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM memory")
            if self._fts_available:
                c.execute("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')")
