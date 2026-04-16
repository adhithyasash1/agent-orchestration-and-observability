from agentos.runtime.trace import TraceEvent, TraceStore


def test_start_and_finish_run(traces):
    run_id = traces.start_run("hello", "minimal", {"memory": True})
    assert run_id
    traces.log(TraceEvent(run_id, 1, "understand", "input", input="hello"))
    traces.finish_run(run_id, "hi", 0.9, 50, 0, status="ok")

    run = traces.get_run(run_id)
    assert run["user_input"] == "hello"
    assert run["final_output"] == "hi"
    assert run["score"] == 0.9
    assert len(run["events"]) == 1
    assert run["events"][0]["kind"] == "understand"


def test_list_runs(traces):
    for i in range(3):
        rid = traces.start_run(f"q{i}", "minimal", {})
        traces.finish_run(rid, "a", 1.0, 10, 0)
    runs = traces.list_runs(limit=10)
    assert len(runs) == 3
