from __future__ import annotations

import asyncio
import json
from typing import Any

from ..core import tool
from ..sanitizer import sanitize_output

try:
    from tradingview_screener import Query, col

    _TRADINGVIEW_AVAILABLE = True
except ImportError:
    Query = None
    col = None
    _TRADINGVIEW_AVAILABLE = False

_DEFAULT_COLUMNS = ["name", "close", "volume", "market_cap_basic"]
_FILTER_OPERATIONS = {
    "gt",
    "gte",
    "lt",
    "lte",
    "eq",
    "neq",
    "between",
    "in",
    "not_in",
    "like",
}


@tool(
    name="tradingview_screen",
    description=(
        "Query TradingView market data with a bounded screener query. "
        "Useful for stocks, crypto, forex, and other public market screens. "
        "Treat results as a public-data integration, not a guaranteed feed."
    ),
    args_schema={
        "type": "object",
        "properties": {
            "columns": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Columns to return. Defaults to name, close, volume, market_cap_basic.",
            },
            "markets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional TradingView markets such as america, crypto, forex, futures, or italy.",
            },
            "tickers": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional tickers in exchange:symbol format, such as NASDAQ:NVDA.",
            },
            "indexes": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional TradingView index identifiers such as SYML:SP;SPX.",
            },
            "filters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "op": {
                            "type": "string",
                            "enum": sorted(_FILTER_OPERATIONS),
                        },
                        "value": {},
                        "value2": {},
                        "compare_to_field": {"type": "string"},
                        "compare_to_field2": {"type": "string"},
                    },
                    "required": ["field", "op"],
                    "additionalProperties": False,
                },
                "description": "Flat AND filters. Supports comparisons, between, in/not_in, and like.",
            },
            "sort_by": {
                "type": "string",
                "description": "Optional column to sort by.",
            },
            "ascending": {
                "type": "boolean",
                "description": "Sort ascending when true. Defaults to false.",
            },
            "nulls_first": {
                "type": "boolean",
                "description": "Place null values first when sorting.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum rows to return. Default 25, max 200.",
            },
            "offset": {
                "type": "integer",
                "description": "Result offset for pagination. Default 0.",
            },
        },
        "additionalProperties": False,
    },
    profiles=["full"],
    requires_internet=True,
    timeout=45,
    retry_budget=1,
)
@sanitize_output
async def _tradingview_screen(args: dict, ctx: dict) -> dict:
    if not _TRADINGVIEW_AVAILABLE or Query is None or col is None:
        return {"status": "error", "error": "tradingview-screener package is not installed"}

    columns = list((args or {}).get("columns") or _DEFAULT_COLUMNS)
    markets = list((args or {}).get("markets") or [])
    tickers = list((args or {}).get("tickers") or [])
    indexes = list((args or {}).get("indexes") or [])
    filters = list((args or {}).get("filters") or [])
    sort_by = ((args or {}).get("sort_by") or "").strip()
    ascending = bool((args or {}).get("ascending", False))
    nulls_first = bool((args or {}).get("nulls_first", False))
    limit = int((args or {}).get("limit") or 25)
    offset = int((args or {}).get("offset") or 0)

    if not columns:
        return {"status": "error", "error": "At least one column is required"}
    if limit < 1 or limit > 200:
        return {"status": "error", "error": "limit must be between 1 and 200"}
    if offset < 0:
        return {"status": "error", "error": "offset must be 0 or greater"}

    def _run_query() -> dict[str, Any]:
        query = Query().select(*columns).limit(limit).offset(offset)

        if tickers:
            query = query.set_tickers(*tickers)
        if markets:
            query = query.set_markets(*markets)
        if indexes:
            query = query.set_index(*indexes)

        if filters:
            query = query.where(*[_build_filter(filter_spec) for filter_spec in filters])

        if sort_by:
            query = query.order_by(sort_by, ascending=ascending, nulls_first=nulls_first)

        total_count, frame = query.get_scanner_data()
        records = json.loads(frame.to_json(orient="records"))
        return {
            "status": "ok",
            "output": {
                "total_count": int(total_count),
                "returned_count": len(records),
                "columns": columns,
                "query": query.query,
                "rows": records,
            },
        }

    return await asyncio.to_thread(_run_query)


def _build_filter(filter_spec: dict[str, Any]) -> Any:
    field_name = str(filter_spec.get("field") or "").strip()
    op = str(filter_spec.get("op") or "").strip()
    if not field_name:
        raise ValueError("Each filter requires a field")
    if op not in _FILTER_OPERATIONS:
        raise ValueError(f"Unsupported filter operation: {op}")

    column = col(field_name)
    primary = _filter_value(filter_spec.get("value"), filter_spec.get("compare_to_field"))
    secondary = _filter_value(filter_spec.get("value2"), filter_spec.get("compare_to_field2"))

    if op == "gt":
        return column > primary
    if op == "gte":
        return column >= primary
    if op == "lt":
        return column < primary
    if op == "lte":
        return column <= primary
    if op == "eq":
        return column == primary
    if op == "neq":
        return column != primary
    if op == "between":
        if primary is None or secondary is None:
            raise ValueError("between filters require value/value2 or compare_to_field/compare_to_field2")
        return column.between(primary, secondary)
    if op == "in":
        if not isinstance(primary, list):
            raise ValueError("in filters require an array value")
        return column.isin(primary)
    if op == "not_in":
        if not isinstance(primary, list):
            raise ValueError("not_in filters require an array value")
        return column.not_in(primary)
    if op == "like":
        if not isinstance(primary, str):
            raise ValueError("like filters require a string value")
        return column.like(primary)
    raise ValueError(f"Unsupported filter operation: {op}")


def _filter_value(value: Any, compare_to_field: str | None) -> Any:
    if compare_to_field:
        return str(compare_to_field)
    return value
