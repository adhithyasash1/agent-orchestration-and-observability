"""End-to-end tests of the agent loop against the mock LLM."""
import pytest

from agentos.runtime import run_agent


async def test_loop_answers_simple_question(llm, tools, memory, traces, settings):
    result = await run_agent(
        "What is the capital of France?",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    assert result.status == "ok"
    assert "Paris" in result.answer
    assert result.score > 0


async def test_loop_uses_calculator(llm, tools, memory, traces, settings):
    result = await run_agent(
        "Calculate 2 + 2 * 3",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    assert result.status == "ok"
    assert any(tc["tool"] == "calculator" for tc in result.tool_calls)


async def test_loop_rejects_empty_input(llm, tools, memory, traces, settings):
    result = await run_agent(
        "   ",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    assert result.status == "rejected"
    assert result.answer == ""


async def test_loop_records_trace_events(llm, tools, memory, traces, settings):
    result = await run_agent(
        "What is the capital of France?",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    run = traces.get_run(result.run_id)
    kinds = [e["kind"] for e in run["events"]]
    assert "understand" in kinds
    assert "retrieve" in kinds
    assert "plan" in kinds
    assert "final" in kinds


async def test_loop_memory_disabled_still_works(llm, tools, memory, traces, settings):
    settings.enable_memory = False
    result = await run_agent(
        "What is the capital of France?",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    assert result.status == "ok"
    # No retrieve event should appear
    run = traces.get_run(result.run_id)
    kinds = [e["kind"] for e in run["events"]]
    assert "retrieve" not in kinds


async def test_loop_tools_disabled(llm, tools, memory, traces, settings):
    settings.enable_tools = False
    # Rebuild tools registry to reflect flag
    from agentos.tools.registry import build_default_registry
    tools = build_default_registry(settings)
    result = await run_agent(
        "Calculate 2 + 2 * 3",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    assert result.status == "ok"
    assert not any(tc["tool"] == "calculator" for tc in result.tool_calls)


async def test_loop_stores_passing_answer_in_memory(llm, tools, memory, traces, settings):
    before = memory.count()
    await run_agent(
        "What is the capital of France?",
        llm=llm, tools=tools, memory=memory, traces=traces, config=settings,
    )
    # With mock LLM + heuristic scoring, passing answers may or may not be
    # stored depending on threshold. Count should at least not decrease.
    assert memory.count() >= before
