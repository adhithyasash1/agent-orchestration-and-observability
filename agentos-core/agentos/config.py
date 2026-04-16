"""Configuration loaded from environment variables with profile support.

Two profiles:
  - minimal: runs with zero external services. Mock LLM, SQLite, one builtin tool.
  - full:    enables Ollama LLM + optional feature flags.

All feature toggles are explicit fields so ablations are just env overrides.
"""
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENTOS_",
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
    )

    # Profile selection
    profile: str = Field(default="minimal", description="minimal | full")

    # LLM
    llm_backend: str = Field(default="mock", description="mock | ollama")
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    # Storage
    db_path: str = "./data/agentos.db"

    # Feature flags (ablations)
    enable_memory: bool = True
    enable_planner: bool = True
    enable_tools: bool = True
    enable_reflection: bool = True

    # Optional integrations
    enable_http_fetch: bool = True
    enable_tavily: bool = False
    tavily_api_key: str = ""

    # Agent loop
    max_steps: int = 4
    eval_pass_threshold: float = 0.6
    context_char_budget: int = 8000

    # API
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]

    def apply_profile(self) -> None:
        """Force dependency-heavy features off in minimal profile."""
        if self.profile == "minimal":
            self.enable_tavily = False

    def describe(self) -> dict:
        return {
            "profile": self.profile,
            "llm_backend": self.llm_backend,
            "flags": {
                "memory": self.enable_memory,
                "planner": self.enable_planner,
                "tools": self.enable_tools,
                "reflection": self.enable_reflection,
                "http_fetch": self.enable_http_fetch,
                "tavily": self.enable_tavily,
            },
        }


settings = Settings()
settings.apply_profile()
