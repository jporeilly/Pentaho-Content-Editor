"""Minimal GitBook MCP client — search a docs site to ground AI output.

GitBook exposes an MCP server per site at ``<site>/~gitbook/mcp`` that
speaks JSON-RPC 2.0 over Streamable HTTP. We only need its
``searchDocumentation`` tool, and it accepts stateless ``tools/call``
requests, so we skip the init/tools-list handshake. Mirrors the learner
app's src/chat/mcp.ts. Stdlib only (urllib) — no new dependency.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class McpError(Exception):
    pass


def _post(endpoint: str, query: str, limit: int, timeout: int) -> dict[str, Any]:
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "searchDocumentation", "arguments": {"query": query, "limit": limit}},
    }).encode()
    req = urllib.request.Request(
        endpoint, data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get("content-type", "")
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise McpError(f"MCP {e.code}: {e.read().decode(errors='replace')[:200]}")
    except urllib.error.URLError as e:
        raise McpError(f"Can't reach the docs MCP at {endpoint} ({e.reason})")

    if "text/event-stream" in ctype:
        # Find the first `data: {...}` JSON-RPC payload.
        for line in raw.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    try:
                        return json.loads(payload)
                    except ValueError:
                        continue
        raise McpError("MCP SSE stream had no JSON-RPC payload")
    try:
        return json.loads(raw)
    except ValueError:
        raise McpError("MCP returned a non-JSON response")


def _parse_title_link_content(text: str) -> dict[str, str] | None:
    """GitBook per-hit format: `Title: … / Link: … / Content: …`."""
    title = url = ""
    content_lines: list[str] = []
    mode = None
    for line in text.splitlines():
        low = line.strip()
        if low.lower().startswith("title:"):
            title = line.split(":", 1)[1].strip(); mode = "title"
        elif low.lower().startswith("link:"):
            url = line.split(":", 1)[1].strip(); mode = "link"
        elif low.lower().startswith("content:"):
            content_lines.append(line.split(":", 1)[1].strip()); mode = "content"
        elif mode == "content":
            content_lines.append(line)
    if not (title or content_lines):
        return None
    return {"title": title or "Untitled", "url": url, "snippet": " ".join(content_lines).strip()[:800]}


def search(endpoint: str, query: str, limit: int = 5, timeout: int = 15) -> list[dict[str, str]]:
    """Return up to `limit` doc hits ({title, url, snippet}) for a query."""
    parsed = _post(endpoint, query, limit, timeout)
    if parsed.get("error"):
        raise McpError(f"MCP error {parsed['error'].get('code')}: {parsed['error'].get('message')}")
    content = (parsed.get("result") or {}).get("content") or []

    # Path 1: a single text item holding JSON with a `results` array.
    for item in content:
        if item.get("type") == "text" and item.get("text"):
            try:
                blob = json.loads(item["text"])
            except ValueError:
                continue
            results = blob.get("results") if isinstance(blob, dict) else None
            if isinstance(results, list):
                return [{
                    "title": str(r.get("title") or r.get("name") or "Untitled"),
                    "url": str(r.get("url") or r.get("uri") or ""),
                    "snippet": str(r.get("snippet") or r.get("description") or r.get("text") or "")[:800],
                } for r in results[:limit]]

    # Path 2: each text item is a `Title:/Link:/Content:` hit.
    hits = []
    for item in content:
        if item.get("type") == "text" and item.get("text"):
            h = _parse_title_link_content(item["text"])
            if h:
                hits.append(h)
    if hits:
        return hits[:limit]

    # Fallback: dump raw text items as a single snippet.
    texts = [item["text"] for item in content if item.get("type") == "text" and item.get("text")]
    if texts:
        return [{"title": "Pentaho docs", "url": "", "snippet": "\n".join(texts)[:1500]}]
    return []


def as_context(hits: list[dict[str, str]]) -> str:
    """Format hits as a compact grounding block for an LLM prompt."""
    if not hits:
        return ""
    parts = []
    for h in hits:
        head = h["title"] + (f" ({h['url']})" if h.get("url") else "")
        parts.append(f"- {head}\n  {h['snippet']}")
    return "Relevant Pentaho documentation (ground your answer in this):\n" + "\n".join(parts)
