"""HTTP API for agentos-core.

Components are built once at application startup (see `agentos.main`) and
stashed on `app.state`. Every request pulls them via the `Depends(...)`
mechanism, so we never mutate a process-global singleton under async load.
A `_config_lock` serializes `/config` patches — the handler builds a fresh
`Components` bundle from the patched settings and atomically swaps it in.
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
import re

try:
    import python_multipart  # type: ignore
    MULTIPART_AVAILABLE = True
except Exception:
    MULTIPART_AVAILABLE = False

try:
    from sse_starlette.sse import EventSourceResponse
except ImportError:
    class EventSourceResponse(StreamingResponse):
        def __init__(self, content, **kwargs):
            async def _event_stream():
                async for event in content:
                    yield f"data: {event.get('data', '')}\n\n"

            super().__init__(_event_stream(), media_type="text/event-stream", **kwargs)

from ..config import Settings
from ..llm import build_llm
from ..llm.protocol import LLM
from ..memory.store import MemoryStore
from ..runtime import TraceStore, run_agent
from ..runtime.planner import resolve_planner_prompt
from ..tools.registry import ToolRegistry, build_default_registry
from ..tools.modules.workspace import WORKSPACE_DIR


@dataclass
class Components:
    settings: Settings
    llm: LLM
    memory: MemoryStore
    tools: ToolRegistry
    traces: TraceStore


def build_components(settings: Settings) -> Components:
    return Components(
        settings=settings,
        llm=build_llm(settings),
        memory=MemoryStore(settings.db_path),
        tools=build_default_registry(settings),
        traces=TraceStore(settings.db_path, config=settings),
    )


def get_components(request: Request) -> Components:
    components = getattr(request.app.state, "components", None)
    if components is None:
        raise HTTPException(500, "components not initialized")
    return components


def get_scheduler(request: Request):
    return getattr(request.app.state, "scheduler", None)


def _config_payload(settings: Settings) -> dict[str, Any]:
    data = settings.describe()
    data["planner_prompt_template"] = resolve_planner_prompt(settings.planner_prompt_template)
    data["vision_model"] = settings.vision_model
    data["vision_timeout_seconds"] = settings.vision_timeout_seconds
    data["scheduler_timezone"] = settings.scheduler_timezone
    return data


_config_lock = asyncio.Lock()
_run_semaphore = asyncio.Semaphore(10)

api_router = APIRouter()


class RunRequest(BaseModel):
    input: str = Field(..., min_length=1, max_length=4000)
    tag: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=128)
    workspace_files: list[str] | None = None

    @field_validator("input")
    def sanitize_input(cls, v: str) -> str:
        v = v.strip()
        # strip purely non-printable characters 
        v = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', v)
        if not v:
            raise ValueError("input cannot be empty after sanitization")
        return v


class ConfigPatch(BaseModel):
    """Live-patchable feature flags.

    Scope is deliberately narrow: only the per-request routing flags that
    the loop consults every call are exposed here. The LLM instance, memory
    store, and DB path are **not** swapped on patch — they're constructed
    once at startup, and there is no safe way to swap them mid-flight
    without disrupting in-flight requests or discarding local state. If
    you need to change `llm_backend` or `db_path`, restart the process.
    """

    enable_memory: bool | None = None
    enable_planner: bool | None = None
    enable_tools: bool | None = None
    enable_reflection: bool | None = None
    enable_llm_judge: bool | None = None
    enable_otel: bool | None = None
    force_local_only: bool | None = None
    allow_internet_mcp: bool | None = None
    enable_sequential_thinking_mcp: bool | None = None
    enable_excel_mcp: bool | None = None
    enable_markdownify_mcp: bool | None = None
    enable_playwright_mcp: bool | None = None
    enable_trading_tools: bool | None = None
    debug_verbose: bool | None = None
    context_char_budget: int | None = Field(default=None, ge=1000, le=500000)
    max_steps: int | None = Field(default=None, ge=1, le=100)
    prompt_version: str | None = Field(default=None, max_length=120)
    planner_prompt_template: str | None = Field(default=None, max_length=24000)


class MemorySearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    k: int = Field(default=5, ge=1, le=20)
    kinds: list[str] | None = None
    min_salience: float | None = Field(default=None, ge=0.0, le=1.0)


class RunFeedbackRequest(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, max_length=2000)


class RunPatchRequest(BaseModel):
    starred: bool | None = None
    tag: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=128)


class MemoryEntryCreateRequest(BaseModel):
    kind: str = Field(default="working", max_length=32)
    text: str = Field(..., min_length=1, max_length=12000)
    salience: float = Field(default=0.5, ge=0.0, le=1.0)
    ttl_seconds: int | None = Field(default=None, ge=1)
    meta: dict[str, Any] | None = None


class MemoryEntryPatchRequest(BaseModel):
    kind: str | None = Field(default=None, max_length=32)
    text: str | None = Field(default=None, min_length=1, max_length=12000)
    salience: float | None = Field(default=None, ge=0.0, le=1.0)
    ttl_seconds: int | None = Field(default=None, ge=1)
    meta: dict[str, Any] | None = None


class ScheduleCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    cron: str = Field(..., min_length=5, max_length=120)
    input: str = Field(..., min_length=1, max_length=4000)
    tag: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=128)
    timezone: str = Field(default="UTC", max_length=64)
    enabled: bool = True


class SchedulePatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    cron: str | None = Field(default=None, min_length=5, max_length=120)
    input: str | None = Field(default=None, min_length=1, max_length=4000)
    tag: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=128)
    timezone: str | None = Field(default=None, max_length=64)
    enabled: bool | None = None


@api_router.post("/runs")
async def create_run(req: RunRequest, c: Components = Depends(get_components)):
    try:
        await asyncio.wait_for(_run_semaphore.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(429, "too many concurrent runs")
    
    try:
        result = await run_agent(
            req.input,
            llm=c.llm,
            tools=c.tools,
            memory=c.memory,
            traces=c.traces,
            config=c.settings,
            session_id=req.session_id,
            tag=req.tag,
            workspace_files=req.workspace_files,
        )
    finally:
        _run_semaphore.release()
        
    return {
        "run_id": result.run_id,
        "answer": result.answer,
        "score": result.score,
        "steps": result.steps,
        "status": result.status,
        "tool_calls": result.tool_calls,
        "latency_ms": result.total_latency_ms,
        "error": result.error,
        "memory_hits": result.memory_hits,
        "context_ids": result.context_ids,
        "retrieval_candidates": result.retrieval_candidates,
        "reflection_count": result.reflection_count,
        "reflection_roi": result.reflection_roi,
        "run_transition_count": result.run_transition_count,
        "prompt_version": result.prompt_version,
        "verification": result.verification,
        "initial_score": result.initial_score,
        "tag": result.tag,
        "session_id": result.session_id,
    }


@api_router.post("/runs/async")
async def create_run_async(
    req: RunRequest,
    background_tasks: BackgroundTasks,
    c: Components = Depends(get_components),
):
    """Start a run in the background and return the ID immediately.

    The client can then poll /runs/{run_id} to get live updates from the
    TraceStore (thoughts, tool calls, status, etc.).
    """
    run_id = c.traces.start_run(
        req.input,
        c.settings.profile,
        c.settings.describe()["flags"],
        prompt_version=c.settings.prompt_version,
        tag=req.tag,
        session_id=req.session_id,
    )

    background_tasks.add_task(
        _run_agent_background_task,
        req.input,
        c,
        run_id,
        req.session_id,
        req.tag,
        req.workspace_files or [],
    )

    return {"run_id": run_id, "status": "running", "tag": req.tag, "session_id": req.session_id}


async def _run_agent_background_task(
    user_input: str,
    c: Components,
    run_id: str,
    session_id: str | None = None,
    tag: str | None = None,
    workspace_files: list[str] | None = None,
):
    async with _run_semaphore:
        try:
            await run_agent(
                user_input,
                llm=c.llm,
                tools=c.tools,
                memory=c.memory,
                traces=c.traces,
                config=c.settings,
                run_id=run_id,
                session_id=session_id,
                tag=tag,
                workspace_files=workspace_files,
            )
        except Exception as e:
            # If a background run crashes, ensure the run is marked as failed.
            c.traces.finish_run(run_id, "", 0.0, 0, 0, status="error")


@api_router.get("/runs")
async def list_runs(
    limit: int = 50,
    search: str | None = None,
    min_score: float | None = None,
    max_score: float | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    starred: bool | None = None,
    tag: str | None = None,
    session_id: str | None = None,
    c: Components = Depends(get_components),
):
    return c.traces.list_runs(
        limit=limit,
        search=search,
        min_score=min_score,
        max_score=max_score,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        starred=starred,
        tag=tag,
        session_id=session_id,
    )


@api_router.get("/runs/export")
async def export_rlhf(
    format: str = "jsonl",
    min_rating: int = 4,
    max_rating: int = 2,
    c: Components = Depends(get_components),
):
    """
    Export preference pairs from run_transitions for offline training.
    Returns JSONL with {chosen, rejected, prompt} tuples derived from
    runs where user_feedback.rating >= min_rating (chosen) vs <= max_rating (rejected).
    """
    runs = c.traces.list_runs(limit=500)
    pairs = []
    for run in runs:
        fb = run.get("user_feedback") or {}
        rating = fb.get("rating")
        if rating is None:
            continue
        full = c.traces.get_run(run["run_id"])
        entry = {
            "prompt": run["user_input"],
            "response": run["final_output"],
            "score": run["score"],
            "rating": rating,
            "label": "chosen" if rating >= min_rating else
                     "rejected" if rating <= max_rating else "neutral",
            "transitions": full.get("transitions", []) if full else [],
        }
        if entry["label"] != "neutral":
            pairs.append(entry)
    if format == "jsonl":
        content = "\n".join(json.dumps(p, default=str) for p in pairs)
        return PlainTextResponse(content, media_type="application/x-ndjson")
    return pairs


@api_router.get("/runs/compare")
async def compare_runs(
    left_run_id: str,
    right_run_id: str,
    c: Components = Depends(get_components),
):
    left = c.traces.get_run(left_run_id)
    right = c.traces.get_run(right_run_id)
    if not left or not right:
        raise HTTPException(404, "one or both runs not found")
    return {
        "left": left,
        "right": right,
        "summary": {
            "score_delta": float(left.get("score") or 0.0) - float(right.get("score") or 0.0),
            "latency_delta_ms": int(left.get("total_latency_ms") or 0) - int(right.get("total_latency_ms") or 0),
            "event_delta": len(left.get("events", [])) - len(right.get("events", [])),
            "transition_delta": len(left.get("transitions", [])) - len(right.get("transitions", [])),
        },
    }


@api_router.get("/runs/tool-stats")
async def run_tool_stats(
    limit_runs: int = 100,
    c: Components = Depends(get_components),
):
    return c.traces.tool_latency_breakdown(limit_runs=limit_runs)


@api_router.get("/runs/{run_id}")
async def get_run(run_id: str, c: Components = Depends(get_components)):
    run = c.traces.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return run


@api_router.get("/runs/{run_id}/report")
async def export_run_report(run_id: str, c: Components = Depends(get_components)):
    report = c.traces.export_run_markdown(run_id)
    if report is None:
        raise HTTPException(404, "run not found")
    return PlainTextResponse(report, media_type="text/markdown")


@api_router.patch("/runs/{run_id}")
async def patch_run(
    run_id: str,
    req: RunPatchRequest,
    c: Components = Depends(get_components),
):
    changes: dict[str, Any] = {}
    if "starred" in req.model_fields_set:
        changes["starred"] = req.starred
    if "tag" in req.model_fields_set:
        changes["tag"] = req.tag
    if "session_id" in req.model_fields_set:
        changes["session_id"] = req.session_id
    run = c.traces.update_run(run_id, **changes)
    if not run:
        raise HTTPException(404, "run not found")
    return run


@api_router.get("/runs/{run_id}/stream")
async def stream_run_events(run_id: str, c: Components = Depends(get_components)):
    """SSE endpoint — streams trace events as they are written, then the final run."""

    async def generator():
        last_id = 0
        while True:
            events = c.traces.get_events_since(run_id, last_id)
            for event in events:
                last_id = event["id"]
                yield {"data": json.dumps(event, default=str)}
            run = c.traces.get_run(run_id)
            if not run:
                yield {"data": json.dumps({"error": "run not found"})}
                break
            if run["status"] != "running":
                yield {"data": json.dumps({"done": True, "run": run}, default=str)}
                break
            await asyncio.sleep(0.25)

    return EventSourceResponse(generator())


@api_router.post("/runs/{run_id}/feedback")
async def leave_feedback(
    run_id: str,
    req: RunFeedbackRequest,
    c: Components = Depends(get_components),
):
    if not c.traces.get_run(run_id):
        raise HTTPException(404, "run not found")
    feedback = req.model_dump(exclude_none=True)
    c.traces.record_feedback(run_id, feedback)
    return {"run_id": run_id, "feedback": feedback}


@api_router.get("/traces/{run_id}")
async def get_trace(run_id: str, c: Components = Depends(get_components)):
    run = c.traces.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return run


@api_router.get("/memory/stats")
async def memory_stats(c: Components = Depends(get_components)):
    return await asyncio.to_thread(c.memory.stats)


@api_router.get("/memory")
async def list_memory_entries(
    limit: int = 100,
    offset: int = 0,
    query: str | None = None,
    kind: str | None = None,
    min_salience: float | None = None,
    max_salience: float | None = None,
    c: Components = Depends(get_components),
):
    try:
        return await asyncio.to_thread(
            c.memory.list_entries,
            limit=limit,
            offset=offset,
            query=query,
            kind=kind,
            min_salience=min_salience,
            max_salience=max_salience,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@api_router.post("/memory")
async def create_memory_entry(
    req: MemoryEntryCreateRequest,
    c: Components = Depends(get_components),
):
    try:
        entry_id = await asyncio.to_thread(
            c.memory.add,
            req.text,
            req.meta,
            kind=req.kind,
            salience=req.salience,
            ttl_seconds=req.ttl_seconds,
        )
        entry = await asyncio.to_thread(c.memory.get_entry, entry_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return entry


@api_router.post("/memory/search")
async def memory_search(
    req: MemorySearchRequest,
    c: Components = Depends(get_components),
):
    try:
        results = await asyncio.to_thread(
            c.memory.search,
            req.query,
            req.k,
            kinds=req.kinds,
            min_salience=req.min_salience,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"results": results}


@api_router.get("/memory/{entry_id}")
async def get_memory_entry(entry_id: int, c: Components = Depends(get_components)):
    entry = await asyncio.to_thread(c.memory.get_entry, entry_id)
    if not entry:
        raise HTTPException(404, "memory entry not found")
    return entry


@api_router.patch("/memory/{entry_id}")
async def patch_memory_entry(
    entry_id: int,
    req: MemoryEntryPatchRequest,
    c: Components = Depends(get_components),
):
    try:
        entry = await asyncio.to_thread(
            c.memory.update_entry,
            entry_id,
            **req.model_dump(exclude_unset=True, exclude_none=True),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not entry:
        raise HTTPException(404, "memory entry not found")
    return entry


@api_router.delete("/memory/{entry_id}")
async def delete_memory_entry(entry_id: int, c: Components = Depends(get_components)):
    deleted = await asyncio.to_thread(c.memory.delete_entry, entry_id)
    if not deleted:
        raise HTTPException(404, "memory entry not found")
    return {"status": "ok", "deleted": entry_id}


@api_router.get("/tools")
async def list_tools(c: Components = Depends(get_components)):
    return [
        {
            "name": t.name,
            "description": t.description,
            "args": t.args_schema,
            "requires_internet": t.requires_internet,
            "timeout": t.timeout,
            "retry_budget": t.retry_budget,
        }
        for t in c.tools.list()
    ]


@api_router.get("/config")
async def get_config(c: Components = Depends(get_components)):
    return _config_payload(c.settings)


@api_router.patch("/config")
@api_router.post("/config")
async def patch_config(patch: ConfigPatch, request: Request):
    """Patch feature flags atomically.

    Builds a fresh Settings + Components bundle from the patched values
    and swaps `app.state.components` under a lock. In-flight requests keep
    the components reference they already resolved through Depends, so
    they finish with consistent settings rather than half-patched state.

    Scope: only the routing flags in `ConfigPatch` are applied. The LLM
    instance and memory store are reused — the loop gates every use of
    them on the flag, so flipping a flag immediately changes behavior
    without needing a rebuild. The tool registry and TraceStore are
    rebuilt because tool availability (e.g. Tavily / HTTP fetch) and
    OTEL exporter setup are decided at construction.
    """
    async with _config_lock:
        current: Components = request.app.state.components
        changes = patch.model_dump(exclude_none=True)
        if not changes:
            return {"updated": {}, "current": _config_payload(current.settings)}

        updates: dict[str, dict[str, Any]] = {
            field: {"old": getattr(current.settings, field), "new": val}
            for field, val in changes.items()
        }
        new_settings = _clone_settings(current.settings, changes)

        new_components = Components(
            settings=new_settings,
            llm=current.llm,  # LLM swap is not exposed through this endpoint
            memory=current.memory,
            tools=build_default_registry(new_settings),
            traces=TraceStore(new_settings.db_path, config=new_settings),
        )
        request.app.state.components = new_components
        scheduler = get_scheduler(request)
        if scheduler is not None:
            scheduler.components = new_components
            scheduler.reload()
        return {"updated": updates, "current": _config_payload(new_settings)}


class PurgeRequest(BaseModel):
    kind: str | None = Field(
        default=None,
        pattern="^(working|episodic|semantic|experience|style|failure|all)$",
    )


@api_router.post("/system/purge")
async def system_purge(req: PurgeRequest, c: Components = Depends(get_components)):
    """Wipe memory/traces for a clean demo start."""
    if req.kind == "all":
        c.memory.purge()
        c.traces.clear_history()
    else:
        c.memory.purge(kind=req.kind)
    return {"status": "ok", "purged": req.kind or "everything"}


@api_router.post("/debug/dump-context")
async def dump_context(run_id: str | None = None, c: Components = Depends(get_components)):
    """Technical debug: Print the last packed context to STDOUT."""
    # We'd need to fetch the last packed context from traces or state
    # For now, print a breadcrumb to confirm the signal is received
    print(f"\033[95m[DEBUG]\033[0m Context dump requested for run {run_id or 'latest'}")
    return {"status": "ok", "target": "backend_terminal"}


@api_router.get("/schedules")
async def list_schedules(c: Components = Depends(get_components)):
    return c.traces.list_schedules()


@api_router.post("/schedules")
async def create_schedule(
    req: ScheduleCreateRequest,
    request: Request,
    c: Components = Depends(get_components),
):
    scheduler = get_scheduler(request)
    if req.enabled and not getattr(scheduler, "available", False):
        raise HTTPException(503, "scheduler is unavailable; install APScheduler to enable cron runs")
    schedule = c.traces.create_schedule(
        name=req.name,
        cron=req.cron,
        user_input=req.input,
        tag=req.tag,
        session_id=req.session_id,
        timezone_name=req.timezone,
        enabled=req.enabled,
    )
    if scheduler is not None:
        try:
            schedule = scheduler.sync_schedule(schedule)
        except Exception as exc:
            c.traces.delete_schedule(schedule["schedule_id"])
            raise HTTPException(400, f"invalid cron schedule: {exc}") from exc
    return schedule


@api_router.patch("/schedules/{schedule_id}")
async def patch_schedule(
    schedule_id: str,
    req: SchedulePatchRequest,
    request: Request,
    c: Components = Depends(get_components),
):
    scheduler = get_scheduler(request)
    changes = req.model_dump(exclude_unset=True, exclude_none=True)
    if changes.get("enabled") and not getattr(scheduler, "available", False):
        raise HTTPException(503, "scheduler is unavailable; install APScheduler to enable cron runs")
    if "input" in changes:
        changes["user_input"] = changes.pop("input")
    schedule = c.traces.update_schedule(schedule_id, **changes)
    if not schedule:
        raise HTTPException(404, "schedule not found")
    if scheduler is not None:
        try:
            schedule = scheduler.sync_schedule(schedule)
        except Exception as exc:
            raise HTTPException(400, f"invalid cron schedule: {exc}") from exc
    return schedule


@api_router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    request: Request,
    c: Components = Depends(get_components),
):
    scheduler = get_scheduler(request)
    if scheduler is not None:
        scheduler.remove_schedule(schedule_id)
    deleted = c.traces.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(404, "schedule not found")
    return {"status": "ok", "deleted": schedule_id}


if MULTIPART_AVAILABLE:
    @api_router.post("/files/upload")
    async def upload_file(
        file: UploadFile = File(...),
        session_id: str | None = Form(default=None),
        c: Components = Depends(get_components),
    ):
        filename = Path(file.filename or "upload.bin").name
        if not filename:
            raise HTTPException(400, "filename is required")

        WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
        target = WORKSPACE_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{filename}"
        with target.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)

        preview: str | None = None
        semantic_summary: str | None = None
        media_type, _ = mimetypes.guess_type(target.name)
        suffix = target.suffix.lower()
        relative_path = str(target.relative_to(WORKSPACE_DIR))

        if suffix == ".pdf":
            preview = await asyncio.to_thread(_extract_pdf_text, target)
            if preview:
                await asyncio.to_thread(
                    c.memory.add,
                    f"Uploaded PDF `{relative_path}`\n\n{preview[:4000]}",
                    kind="working",
                    salience=0.7,
                    meta={"path": relative_path, "source": "upload", "session_id": session_id},
                )
        elif suffix in {".csv", ".tsv", ".xlsx", ".xls"}:
            semantic_summary = await asyncio.to_thread(_summarize_tabular_file, target)
            if semantic_summary:
                await asyncio.to_thread(
                    c.memory.add,
                    semantic_summary,
                    kind="semantic",
                    salience=0.75,
                    meta={"path": relative_path, "source": "upload", "session_id": session_id},
                )
        elif media_type and media_type.startswith("image/"):
            preview = "Image stored in workspace. Use describe_image for visual analysis."
            await asyncio.to_thread(
                c.memory.add,
                f"Uploaded image available at `{relative_path}`",
                kind="working",
                salience=0.6,
                meta={"path": relative_path, "source": "upload", "session_id": session_id},
            )
        else:
            try:
                preview = target.read_text(encoding="utf-8")[:2000]
            except Exception:
                preview = None

        return {
            "filename": target.name,
            "path": relative_path,
            "media_type": media_type,
            "preview": preview,
            "semantic_summary": semantic_summary,
        }
else:
    @api_router.post("/files/upload")
    async def upload_file_unavailable():
        raise HTTPException(503, "file uploads require python-multipart to be installed")


@api_router.get("/files")
async def list_uploaded_files():
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for item in sorted(WORKSPACE_DIR.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True):
        if not item.is_file():
            continue
        files.append(
            {
                "name": item.name,
                "path": str(item.relative_to(WORKSPACE_DIR)),
                "size": item.stat().st_size,
                "modified_at": datetime.fromtimestamp(item.stat().st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return files


def _clone_settings(settings: Settings, overrides: dict[str, Any]) -> Settings:
    """Return a copy of `settings` with `overrides` applied.

    We deliberately do NOT re-run `apply_profile()` here. `apply_profile`
    is a *profile-time* transform: the first time `Settings` is loaded,
    it normalizes flags to match the selected profile. Re-running it on a
    config patch would overwrite explicit intent (e.g. the user flipping
    `enable_llm_judge` on under the minimal profile). Since patches never
    change `profile`, there is nothing for `apply_profile` to do here.
    """
    data = settings.model_dump()
    data.update(overrides)
    return Settings(**data)


def _extract_pdf_text(path: Path) -> str | None:
    try:
        import fitz  # type: ignore
    except Exception:
        return None
    try:
        with fitz.open(path) as doc:
            text = "\n".join(page.get_text() for page in doc[:5])
    except Exception:
        return None
    return text[:8000] or None


def _summarize_tabular_file(path: Path) -> str | None:
    try:
        import pandas as pd  # type: ignore
    except Exception:
        return None
    try:
        if path.suffix.lower() in {".xlsx", ".xls"}:
            frame = pd.read_excel(path)
        elif path.suffix.lower() == ".tsv":
            frame = pd.read_csv(path, sep="\t")
        else:
            frame = pd.read_csv(path)
    except Exception:
        return None

    columns = [
        f"- {name}: {str(dtype)}"
        for name, dtype in frame.dtypes.items()
    ]
    sample_rows = frame.head(3).to_dict(orient="records")
    return (
        f"Tabular dataset `{path.name}`\n"
        f"Rows: {len(frame)}\n"
        f"Columns:\n" + "\n".join(columns) +
        "\nSample rows:\n" + json.dumps(sample_rows, default=str)[:2000]
    )


@api_router.get("/health")
async def health(request: Request, c: Components = Depends(get_components)):
    deps = {"memory": "ok", "traces": "ok"}
    try:
        _ = await asyncio.to_thread(c.memory.count)
    except Exception:
        deps["memory"] = "error"

    if c.settings.llm_backend == "ollama":
        import httpx

        headers = {}
        if c.settings.ollama_api_key:
            headers["Authorization"] = f"Bearer {c.settings.ollama_api_key}"
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                r = await client.get(
                    f"{c.settings.ollama_base_url}/api/tags",
                    headers=headers,
                )
            deps["ollama"] = "ok" if r.status_code == 200 else "error"
        except Exception:
            deps["ollama"] = "unreachable"
    else:
        deps["llm"] = f"mock ({c.settings.llm_backend})"

    scheduler = get_scheduler(request)
    deps["otel"] = "enabled" if c.traces.otel_enabled else "disabled"
    deps["scheduler"] = "enabled" if getattr(scheduler, "available", False) else "unavailable"
    all_ok = all(
        v.startswith(("ok", "mock")) or v in {"disabled", "unavailable"}
        for v in deps.values()
    )
    return {
        "status": "ok" if all_ok else "degraded",
        "dependencies": deps,
        "config": _config_payload(c.settings),
    }
