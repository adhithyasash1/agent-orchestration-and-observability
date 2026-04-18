"""Shared fixtures."""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

# Ensure project root is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agentos.api import api_router, build_components
from agentos.config import Settings
from agentos.llm.mock import MockLLM
from agentos.memory.store import MemoryStore
from agentos.runtime.trace import TraceStore
from agentos.tools.registry import build_default_registry


@pytest.fixture
def tmp_db(tmp_path: Path) -> str:
    return str(tmp_path / "agentos.db")


@pytest.fixture
def settings(tmp_db) -> Settings:
    s = Settings(db_path=tmp_db, profile="minimal", llm_backend="mock")
    s.apply_profile()
    return s


@pytest.fixture
def memory(tmp_db) -> MemoryStore:
    return MemoryStore(tmp_db)


@pytest.fixture
def traces(tmp_db) -> TraceStore:
    return TraceStore(tmp_db)


@pytest.fixture
def tools(settings):
    return build_default_registry(settings)


@pytest.fixture
def llm():
    return MockLLM()


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        db_path=str(tmp_path / "api.db"),
        llm_backend="mock",
        profile="minimal",
    )
    settings.apply_profile()

    @asynccontextmanager
    async def test_lifespan(app: FastAPI):
        app.state.components = build_components(settings)
        yield
        app.state.components.memory.close()
        app.state.components.traces.close()

    app = FastAPI(title="agentos-core-test", lifespan=test_lifespan)
    app.include_router(api_router, prefix=settings.api_prefix)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def async_client(tmp_path):
    settings = Settings(db_path=str(tmp_path / "sse.db"), profile="minimal", llm_backend="mock")
    settings.apply_profile()

    @asynccontextmanager
    async def test_lifespan(app: FastAPI):
        app.state.components = build_components(settings)
        yield
        app.state.components.memory.close()
        app.state.components.traces.close()

    app = FastAPI(lifespan=test_lifespan, title="test")
    app.include_router(api_router, prefix=settings.api_prefix)

    async with test_lifespan(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
