import hashlib
import json
import logging
import math
from typing import List, Tuple, Optional
import httpx

logger = logging.getLogger(__name__)

def generate_content_hash(text: str) -> str:
    """Generate deterministic hash for text"""
    normalized = " ".join(text.split()).strip()
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()

def normalize_vector(v: List[float]) -> Tuple[List[float], float]:
    """Calculate norm and normalize vector to unit length"""
    if not v:
        return [], 0.0
    sq_sum = sum(x * x for x in v)
    if sq_sum == 0:
        return v, 0.0
    norm = math.sqrt(sq_sum)
    normalized = [x / norm for x in v]
    return normalized, norm

class EmbeddingClient:
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "nomic-embed-text-v2-moe", timeout: float = 30.0, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        if self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

    def embed_text(self, text: str) -> List[float]:
        """Fetch embeddings from Ollama synchronously."""
        normalized = " ".join(text.split()).strip()
        if not normalized:
            return []
            
        payload = {
            "model": self.model,
            "prompt": normalized,
        }
        
        try:
            with httpx.Client(timeout=self.timeout) as client:
                r = client.post(
                    f"{self.base_url}/api/embeddings",
                    json=payload,
                    headers=self._headers(),
                )
                r.raise_for_status()
                data = r.json()
                return data.get("embedding", [])
        except Exception as e:
            logger.warning(f"Embedding failed: {e}")
            return []
