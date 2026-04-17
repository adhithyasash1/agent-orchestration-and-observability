# AgentOS LLM Evaluation Profile

**Execution Snapshot:** 2026-04-17 18:34:36
**Profile Flags:**
```json
{
  "memory": true,
  "planner": true,
  "tools": true,
  "reflection": true,
  "llm_judge": false,
  "http_fetch": false,
  "tavily": false,
  "mcp_plugins": true,
  "otel": false,
  "embeddings": true,
  "reranker": true,
  "embedding_cache": true,
  "retrieval_cache": true
}
```

## Automated Causal Insights
- 🟢 **Memory Optimization:** Hybrid retrieval improved scores by +20.0% compared to pure FTS.
- 🟢 **Memory Value:** Retrieving prior context actively improves agent solutions by +50.0%.
- 🟢 **Reflection Worth:** Self-reflection overhead pays off with a 20.0% accuracy boost.

## Configuration Failure Breakdowns
| Ablation Target | Global Score | Execution Ms | Context Util % | Recall % |
|---|---|---|---|---|
| semantic-only | 0.818 | 251ms | 60.0% | 75.0% |
| full | 0.818 | 352ms | 60.0% | 75.0% |
| no-memory | 0.545 | 0ms | 0.0% | 0.0% |
| no-reflection | 0.682 | 250ms | 60.0% | 0.0% |
| no-semantic | 0.682 | 253ms | 60.0% | 0.0% |
| no-planner | 0.545 | 246ms | 0.0% | 0.0% |
| no-tools | 0.682 | 249ms | 60.0% | 0.0% |
| hybrid-no-rerank | 0.682 | 249ms | 60.0% | 0.0% |