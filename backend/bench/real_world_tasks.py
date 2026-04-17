import asyncio
import json
import sys
import time
from pathlib import Path
from datetime import datetime

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

import httpx
from agentos.config import Settings
from agentos.llm import build_llm
from agentos.llm.ollama import OllamaLLM
from agentos.memory.store import MemoryStore
from agentos.runtime import TraceStore, run_agent
from agentos.tools.registry import build_default_registry

MODELS = [
    "gemma4:31b-cloud",
    "glm-5.1:cloud",
    "qwen3.5:4b"  # Local fallback to avoid requiring 3 cloud models if unavailable
]

HN_PROMPT = """You are an AI research assistant. 
1. Use the official Hacker News API (https://hacker-news.firebaseio.com/v0/topstories.json) to retrieve the top 3 articles.
2. Fetch the JSON payload for those top 3 articles using: https://hacker-news.firebaseio.com/v0/item/{id}.json
3. Provide a 2-sentence summary and the core theme for each of the 3 articles.
Focus on technical insights and key debates. Work efficiently."""

def hybrid_score(output_text: str) -> float:
    """Rule-based scoring validation against real-world prompt constraints"""
    score = 0.0
    output_lower = output_text.lower()
    
    # 1. Did it fetch articles?
    if "1." in output_text or "title" in output_lower or "theme" in output_lower:
        score += 0.2
        
    # 2. Did it summarize themes?
    if "technical" in output_lower or "debate" in output_lower or "theme" in output_lower:
        score += 0.3
        
    # 3. Did it respect the count target?
    if output_text.count("1.") and output_text.count("2.") and output_text.count("3."):
        score += 0.5
        
    return min(1.0, score)


async def evaluate_models():
    settings = Settings(
        profile="full",
        llm_backend="ollama",
        max_steps=12,  # Boost steps since it requires recursive looping Network fetches
        db_path=str(PROJECT_ROOT / "data" / "agentos.db")
    )
    
    traces = TraceStore(settings.db_path, config=settings)
    memory = MemoryStore(settings.db_path)
    tools = build_default_registry(settings)
    
    results = []
    
    print("\n=============================================")
    print("🌍 RUNNING REAL-WORLD TASKS EVALUATION")
    print("=============================================")
    
    for model in MODELS:
        print(f"\n▶ EVALUATING MODEL: {model}")
        settings.ollama_model = model
        llm = OllamaLLM(
            model=settings.ollama_model, 
            base_url=settings.ollama_base_url,
            api_key=settings.ollama_api_key
        )
        
        memory.clear()  # Ensure pristine boundary limits per model test
        start_time = time.perf_counter()
        
        try:
            result = await run_agent(
                HN_PROMPT,
                llm=llm,
                tools=tools,
                memory=memory,
                traces=traces,
                config=settings,
            )
            
            latency = time.perf_counter() - start_time
            score = hybrid_score(result.answer)
            
            # Record explicit trace properties back
            res_dict = {
                "model": model,
                "score": score,
                "latency_s": round(latency, 1),
                "steps": result.steps,
                "status": result.status
            }
            results.append(res_dict)
            
            print(f"| Status: {result.status} | Steps: {result.steps} | Score: {score:.2f} | Latency: {latency:.1f}s")
            print(f"| Final Answer Snippet:\n  {result.answer[:200]}...")
            
        except Exception as e:
            print(f"| Crash! {type(e).__name__}: {str(e)}")
            results.append({
                "model": model,
                "score": 0.0,
                "latency_s": round(time.perf_counter() - start_time, 1),
                "steps": 0,
                "status": "crash"
            })
            
    print("\n=============================================")
    print("📊 MULTI-MODEL LEADERBOARD")
    print("=============================================")
    for r in sorted(results, key=lambda x: x["score"], reverse=True):
        print(f"[{r['score']:.2f}] {r['model']:<18} | Latency: {r['latency_s']:.1f}s | Steps: {r['steps']} | Status: {r['status']}")


if __name__ == "__main__":
    asyncio.run(evaluate_models())
