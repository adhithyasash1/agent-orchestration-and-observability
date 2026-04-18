from agentos.runtime.trace import RunTransition, TraceEvent, TraceStore, _format_console_payload


def test_start_and_finish_run(traces):
    run_id = traces.start_run("hello", "minimal", {"memory": True}, prompt_version="test-v1")
    assert run_id
    traces.log(
        TraceEvent(
            run_id,
            1,
            "understand",
            "input",
            input="hello",
            attributes={"prompt_version": "test-v1"},
        )
    )
    traces.finish_run(run_id, "hi", 0.9, 50, 0, status="ok")

    run = traces.get_run(run_id)
    assert run["user_input"] == "hello"
    assert run["final_output"] == "hi"
    assert run["score"] == 0.9
    assert run["prompt_version"] == "test-v1"
    assert len(run["events"]) == 1
    assert run["events"][0]["kind"] == "understand"
    assert run["events"][0]["attributes"]["prompt_version"] == "test-v1"


def test_list_runs(traces):
    for i in range(3):
        rid = traces.start_run(f"q{i}", "minimal", {}, prompt_version="bench-v1")
        traces.finish_run(rid, "a", 1.0, 10, 0)
    runs = traces.list_runs(limit=10)
    assert len(runs) == 3


def test_list_runs_supports_metadata_filters(traces):
    left = traces.start_run(
        "research prompt",
        "minimal",
        {},
        prompt_version="bench-v1",
        tag="research",
        session_id="session-a",
    )
    right = traces.start_run(
        "coding prompt",
        "minimal",
        {},
        prompt_version="bench-v1",
        tag="coding",
    )
    traces.finish_run(left, "a", 0.9, 10, 0)
    traces.finish_run(right, "b", 0.2, 15, 0)
    traces.update_run(left, starred=True)

    starred = traces.list_runs(limit=10, starred=True)
    assert [run["run_id"] for run in starred] == [left]

    tagged = traces.list_runs(limit=10, tag="coding")
    assert [run["run_id"] for run in tagged] == [right]

    session_runs = traces.list_runs(limit=10, session_id="session-a")
    assert [run["run_id"] for run in session_runs] == [left]


def test_rl_transitions_are_returned_with_run(traces):
    run_id = traces.start_run("hello", "minimal", {}, prompt_version="rl-v1")
    traces.log_transition(
        RunTransition(
            run_id=run_id,
            step=1,
            stage="plan",
            state={"prompt": "hello"},
            action={"action": "answer"},
            observation={"packed": True},
            score=None,
            done=False,
            status="planned",
            attributes={"context_ids": ["memory:1"]},
        )
    )
    traces.finish_run(run_id, "hi", 0.8, 20, 0)
    run = traces.get_run(run_id)
    assert len(run["transitions"]) == 1
    assert run["transitions"][0]["stage"] == "plan"
    assert run["transitions"][0]["attributes"]["context_ids"] == ["memory:1"]


def test_console_payload_redacts_sensitive_tool_args():
    rendered = _format_console_payload(
        {
            "url": "https://example.com",
            "api_key": "secret-value",
            "headers": {"Authorization": "Bearer secret-token"},
        }
    )
    assert "secret-value" not in rendered
    assert "secret-token" not in rendered
    assert '"api_key": "***"' in rendered
