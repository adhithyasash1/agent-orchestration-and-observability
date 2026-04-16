"""API endpoint tests. Uses FastAPI TestClient — no server needed."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Fresh DB per test; force mock backend.
    monkeypatch.setenv("AGENTOS_DB_PATH", str(tmp_path / "api.db"))
    monkeypatch.setenv("AGENTOS_LLM_BACKEND", "mock")
    monkeypatch.setenv("AGENTOS_PROFILE", "minimal")

    # Reload settings + components module so env takes effect.
    import importlib
    from agentos import config as config_mod
    importlib.reload(config_mod)
    from agentos.api import routes as routes_mod
    importlib.reload(routes_mod)
    from agentos import main as main_mod
    importlib.reload(main_mod)

    return TestClient(main_mod.app)


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert "status" in body
    assert "config" in body


def test_tools_list(client):
    r = client.get("/api/v1/tools")
    assert r.status_code == 200
    names = [t["name"] for t in r.json()]
    assert "calculator" in names


def test_run_and_fetch(client):
    r = client.post("/api/v1/runs", json={"input": "What is the capital of France?"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    run_id = data["run_id"]

    r2 = client.get(f"/api/v1/runs/{run_id}")
    assert r2.status_code == 200
    assert len(r2.json()["events"]) > 0


def test_list_runs_after_create(client):
    client.post("/api/v1/runs", json={"input": "What is the capital of France?"})
    r = client.get("/api/v1/runs")
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_memory_search(client):
    client.post("/api/v1/runs", json={"input": "What is the capital of France?"})
    r = client.post("/api/v1/memory/search", json={"query": "Paris", "k": 3})
    assert r.status_code == 200
    assert "results" in r.json()


def test_config_patch(client):
    r = client.post("/api/v1/config", json={"enable_tools": False})
    assert r.status_code == 200
    body = r.json()
    assert body["current"]["flags"]["tools"] is False


def test_reject_empty_input(client):
    r = client.post("/api/v1/runs", json={"input": ""})
    assert r.status_code == 422  # pydantic min_length
