# agentos-core

A **local-first orchestration and observability layer** for agentic workflows.

agentos-core accepts a user request, retrieves relevant context, plans a next
step, calls tools, verifies the result, and logs every step as a trace — all
on one machine, in one process, using SQLite as the default store.

It is not a general AGI. It is a small, honest runtime you can read in an
afternoon, run without any API keys, and benchmark against ablations of
itself.

---

## What problem it solves

Most agent frameworks assume cloud infra (vector DBs, graph DBs, hosted LLMs,
observability SaaS). That makes them hard to reason about, hard to debug
locally, and hard to prove anything about.

agentos-core flips that:

- **local by default** — SQLite only; no Neo4j / Chroma / Qdrant needed
- **observable by default** — every phase of every run is a row in
  `trace_events`
- **testable by default** — a deterministic mock LLM runs the whole loop
  without a network
- **measurable by default** — one `python -m bench.runner --all-ablations`
  produces a report comparing full-system vs. each component off

---

## The agent loop

Every run walks a fixed sequence. Each step emits a `TraceEvent`.

```
understand  →  retrieve  →  plan  →  act  →  verify  →  (reflect & retry?)  →  final
```

| Phase        | What happens                                              | Gated by           |
|--------------|-----------------------------------------------------------|--------------------|
| `understand` | Record the raw user input, validate non-empty             | always             |
| `retrieve`   | FTS5 search over SQLite memory                            | `enable_memory`    |
| `plan`       | LLM emits JSON `{action, tool, tool_args, answer}`        | `enable_planner`   |
| `act`        | Execute the chosen tool via the registry                  | `enable_tools`     |
| `verify`     | Heuristic or expected-match scoring                       | always             |
| `reflect`    | LLM critique → feed back into planner for next iteration  | `enable_reflection`|
| `final`      | Persist answer + score; optionally write to memory        | always             |

Max iterations and the pass threshold are configurable.

---

## Architecture

```
agentos/
├── config.py             # pydantic-settings; profiles + feature flags
├── main.py               # FastAPI entrypoint + static UI mount
├── runtime/
│   ├── loop.py           # The phase-by-phase agent loop
│   ├── planner.py        # LLM JSON-decision planner
│   └── trace.py          # SQLite TraceStore + TraceEvent
├── memory/store.py       # SQLite FTS5 memory
├── tools/
│   ├── registry.py       # Tool protocol + flag-aware registry
│   └── builtin.py        # calculator, http_fetch, tavily (optional)
├── llm/
│   ├── protocol.py       # LLM.complete(prompt, system=...)
│   ├── mock.py           # Deterministic mock for tests/minimal profile
│   ├── ollama.py         # Optional Ollama chat backend
│   └── factory.py
├── eval/
│   ├── scorer.py         # expected-match + grounded-heuristic scoring
│   └── reflection.py     # critique prompt
└── api/routes.py         # /runs, /traces, /memory, /tools, /config, /health
bench/                    # tasks + runner + report
tests/                    # pytest suite (uses MockLLM, no network)
ui/index.html             # minimal single-file trace viewer
```

### Core vs. optional

| Component          | Core | Optional | Flag                     |
|--------------------|:----:|:--------:|--------------------------|
| FastAPI API        | ✅   |          |                          |
| SQLite TraceStore  | ✅   |          |                          |
| SQLite MemoryStore | ✅   |          | `enable_memory`          |
| Calculator tool    | ✅   |          | `enable_tools`           |
| MockLLM            | ✅   |          | `llm_backend=mock`       |
| Planner (LLM JSON) | ✅   |          | `enable_planner`         |
| Scorer             | ✅   |          |                          |
| Reflection         |      | ✅       | `enable_reflection`      |
| HTTP fetch tool    |      | ✅       | `enable_http_fetch`      |
| Ollama backend     |      | ✅       | `llm_backend=ollama`     |
| Tavily search      |      | ✅       | `enable_tavily`          |
| Static UI          |      | ✅       | (served if `ui/` exists) |

---

## Quickstart (zero external services)

```bash
cd agentos-core
python3 -m venv venv && source venv/bin/activate
pip install -e '.[dev]'

# run the API on http://localhost:8000
python -m agentos.main
# or
uvicorn agentos.main:app --reload
```

Open <http://localhost:8000/> for the trace viewer, or
<http://localhost:8000/docs> for the OpenAPI docs.

Try it:

```bash
curl -s http://localhost:8000/api/v1/runs \
  -H 'content-type: application/json' \
  -d '{"input": "Calculate 12 * 11"}' | jq
```

No API keys are required. The default `minimal` profile uses MockLLM, which
is deterministic and gives the loop just enough signal to exercise tools,
memory, and scoring.

---

## Running with Ollama

```bash
# in .env (or export env vars)
AGENTOS_PROFILE=full
AGENTOS_LLM_BACKEND=ollama
AGENTOS_OLLAMA_MODEL=llama3.2
```

Ensure Ollama is running locally (`ollama serve` and `ollama pull llama3.2`),
then start the API as above.

---

## Tests

```bash
pytest -q
```

The suite covers:

- **memory** — add/search/FTS correctness, meta roundtrip
- **tools** — calculator, flag gating, unknown tool handling, unsafe input
- **scorer** — expected-match, grounding bonus, refusal handling
- **trace** — run lifecycle, event listing
- **loop** — happy path, tool path, empty-input rejection, flag gating,
  trace completeness
- **api** — health, runs create/list/get, memory search, config patch,
  empty input rejection

All tests run against MockLLM and a temporary SQLite DB — no network, no
model downloads.

---

## Benchmarks

```bash
# single profile
python -m bench.runner --profile minimal

# specific ablation
python -m bench.runner --ablation no-memory

# everything
python -m bench.runner --all-ablations

# markdown report across all saved results
python -m bench.report
```

### Tasks

`bench/tasks.json` ships a small, balanced set:

- `knowledge` — direct factual questions
- `tool_use` — must invoke the calculator
- `reasoning` — small arithmetic / logic puzzles
- `failure_handling` — empty input, nonsense, fabrication baiting

### Metrics tracked per run

- `overall_score` — mean of per-task scores (expected-match or heuristic)
- `success_rate` — fraction scoring ≥ 0.6
- `tool_call_success_rate` — of tasks with `expected_tool`, how many called it
- `mean_latency_ms` — wall-clock per task
- `by_category` — score per category
- `flags` — feature flags used for this run

### Ablations

| Label            | What's off       |
|------------------|------------------|
| `full`           | nothing          |
| `no-memory`      | FTS retrieval    |
| `no-planner`     | LLM planner      |
| `no-tools`       | tool execution   |
| `no-reflection`  | critique retry   |

`bench/report.py` emits a markdown report with a summary table and deltas
vs. `full`, so you can see whether a component is pulling its weight.

---

## Observability

Every run produces a complete trace:

```
GET /api/v1/runs/{run_id}
```

Returns the run row plus ordered `trace_events`, each carrying:

- `kind` — `understand | retrieve | plan | tool_call | verify | reflect | final | error`
- `name` — tool/node name or short label
- `input` / `output` — JSON strings (bounded to 8 KB)
- `latency_ms`, `tokens_in`, `tokens_out` (best-effort)
- `error` — populated if the step failed

The static UI at `/` renders runs and their traces directly from these rows.

---

## Reliability

- Planner output is parsed with a tolerant regex + JSON fallback — if the LLM
  ignores the schema, the raw text is treated as the final answer.
- Ollama backend retries with exponential backoff.
- Tools wrap every call in try/except and return a uniform
  `{status, output, error}` dict.
- Empty or whitespace-only input is rejected before the loop runs.
- Config patches rebuild the tool registry so flag flips take effect on the
  next request.

---

## Limitations (honest edition)

- **Heuristic scorer.** The in-loop scorer is a simple grounding proxy; it
  can over-reward verbose answers and under-reward terse correct ones. Use
  `expected_contains` in benchmarks for real signal.
- **MockLLM is not an LLM.** It is a stub so the loop is runnable and
  testable without a model. Non-trivial reasoning requires Ollama or a
  hosted backend.
- **Memory is keyword-only.** FTS5 beats LIKE but is not semantic. Adding
  embeddings is straightforward but intentionally deferred.
- **Tools are minimal.** Calculator + HTTP fetch + optional Tavily. The
  registry is designed so adding tools is ~20 lines, not a refactor.
- **No multi-agent orchestration.** One loop, one agent. Multi-agent is not
  claimed.
- **Trace payloads are truncated** at 8 KB to keep SQLite fast; full payloads
  are not preserved.

---

## Environment variables

All prefixed with `AGENTOS_`. See `.env.example` for the full list. The most
important ones:

| Variable                    | Default  | Notes                              |
|-----------------------------|----------|------------------------------------|
| `AGENTOS_PROFILE`           | minimal  | `minimal` or `full`                |
| `AGENTOS_LLM_BACKEND`       | mock     | `mock` or `ollama`                 |
| `AGENTOS_DB_PATH`           | `./data/agentos.db` | SQLite file            |
| `AGENTOS_MAX_STEPS`         | 4        | max planner/executor iterations    |
| `AGENTOS_EVAL_PASS_THRESHOLD` | 0.6    | score threshold for completion     |
| `AGENTOS_ENABLE_MEMORY`     | true     |                                    |
| `AGENTOS_ENABLE_PLANNER`    | true     |                                    |
| `AGENTOS_ENABLE_TOOLS`      | true     |                                    |
| `AGENTOS_ENABLE_REFLECTION` | true     |                                    |

---

## License

Personal project scaffolding. No license assigned; adapt as you like.
