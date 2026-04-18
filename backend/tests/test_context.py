from agentos.config import Settings
from agentos.runtime.context_packer import pack_context


def test_context_packer_prioritizes_memory_and_tool_chunks():
    packed = pack_context(
        user_input="What powers agentos-core by default?",
        memory_hits=[
            {
                "id": 1,
                "kind": "semantic",
                "text": "agentos-core uses SQLite as the default store.",
                "salience": 0.9,
                "utility_score": 1.2,
                "source_run_id": "r1",
            }
        ],
        tool_results=[
            {
                "tool": "calculator",
                "status": "ok",
                "output": 132,
                "observation_summary": "Computed the requested arithmetic result.",
                "iteration": 1,
            }
        ],
        critique="Be more grounded in the retrieved note.",
        prior_decisions=[],
        budget_chars=2200,
        prompt_version="test-prompt",
    )
    assert "developer:instructions" in packed.included_ids
    assert "memory:1" in packed.included_ids
    assert any(chunk_id.startswith("tool:") for chunk_id in packed.included_ids)
    assert packed.prompt_version == "test-prompt"
    assert "SQLite" in packed.rendered


def test_pack_does_not_exceed_budget():
    budget_chars = 1800
    packed = pack_context(
        user_input="Summarize this run",
        memory_hits=[
            {
                "id": 1,
                "kind": "semantic",
                "text": "A" * 1200,
                "salience": 0.9,
                "utility_score": 1.0,
                "source_run_id": "r1",
            }
        ],
        tool_results=[
            {
                "tool": "calculator",
                "tool_args": {"expression": "2 + 2"},
                "status": "ok",
                "output": "B" * 1200,
                "observation_summary": "C" * 400,
                "iteration": 1,
            }
        ],
        critique="D" * 800,
        prior_decisions=[],
        budget_chars=budget_chars,
        prompt_version="test-prompt",
    )
    assert len(packed.rendered) <= budget_chars


def test_pack_budget_ratios_match_settings_defaults():
    settings = Settings()
    settings.apply_profile()
    budget_chars = 20000
    packed = pack_context(
        user_input="Explain the tradeoffs",
        memory_hits=[],
        tool_results=[
            {
                "tool": "calculator",
                "tool_args": {"expression": "2 + 2"},
                "status": "ok",
                "output": "tool output " * 3000,
                "observation_summary": "Summarized tool output",
                "iteration": 1,
            }
        ],
        critique="critique " * 2000,
        prior_decisions=[],
        budget_chars=budget_chars,
        prompt_version="test-prompt",
        developer_instructions="developer " * 3000,
    )
    assert len(packed.rendered) <= budget_chars
    assert packed.section_sizes["developer_instructions"] <= int(budget_chars * settings.context_developer_ratio)
    assert packed.section_sizes["compressed_scratchpad"] <= int(budget_chars * settings.context_scratchpad_ratio)
    assert packed.section_sizes["live_tool_observations"] <= int(budget_chars * settings.context_tool_ratio)
