import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# Flashrank instance globally cached
_ranker = None

def _get_ranker():
    global _ranker
    if _ranker is None:
        try:
            from flashrank import Ranker
            # Model options: ms-marco-TinyBERT-L-2-v2 (default, very fast), or ms-marco-MiniLM-L-12-v2
            _ranker = Ranker(model_name="ms-marco-TinyBERT-L-2-v2", cache_dir="./data/flashrank_cache")
        except ImportError:
            logger.warning("Flashrank not installed. Reranking will fallback to semantic/FTS scores.")
            return None
        except Exception as e:
            logger.error(f"Failed to load FlashRank: {e}")
            return None
    return _ranker

def rerank(query: str, candidates: List[Dict[str, Any]], top_n: int = 3) -> List[Dict[str, Any]]:
    """
    Reranks candidates using FlashRank.
    Falls back to sorting by existing 'utility_score' if flashrank fails or is unavailable.
    """
    if not candidates:
        return []
        
    if len(candidates) <= top_n:
        return sorted(candidates, key=lambda x: x.get('utility_score', 0.0), reverse=True)

    ranker = _get_ranker()
    if not ranker:
        # Fallback to existing scores
        return sorted(candidates, key=lambda x: x.get('utility_score', 0.0), reverse=True)[:top_n]

    # Map to FlashRank format
    passages = []
    for c in candidates:
        passages.append({
            "id": str(c.get("id")),
            "text": c.get("text", "")
        })

    try:
        from flashrank import RerankRequest
        req = RerankRequest(query=query, passages=passages)
        results = ranker.rerank(req)
        
        # Flashrank returns ordered list of dicts with 'id', 'text', 'score'
        # Re-map our original candidates back onto this ordered format.
        candidate_map = {str(c.get("id")): c for c in candidates}
        
        reranked_final = []
        for res in results:
            orig = candidate_map.get(str(res["id"]))
            if orig:
                # Optionally update utility score with reranker score
                orig["utility_score"] = float(res.get("score", orig.get("utility_score", 0.0)))
                reranked_final.append(orig)
                
        return reranked_final[:top_n]

    except Exception as e:
        logger.error(f"Reranking execution failed, falling back to basic sorting: {e}")
        return sorted(candidates, key=lambda x: x.get('utility_score', 0.0), reverse=True)[:top_n]
