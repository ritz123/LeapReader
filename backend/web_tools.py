"""
Shared internet-access tools for LeapReader AI features.

Used by the chat router (FR-10) and the review agent (FR-8).

Tools:
  web_search(query)  → (text: str, sources: list[dict])
  fetch_url(url)     → text: str
"""

import ipaddress
import re
import urllib.parse

import requests
from ddgs import DDGS

MAX_PAGE_CHARS = 8_000
MAX_SEARCH_RESULTS = 5

# Ollama tool definitions (JSON Schema)
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information about any topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch and read the text content of a web page by URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The full http/https URL to fetch"}
                },
                "required": ["url"],
            },
        },
    },
]

# Subset containing only web_search (for callers that don't want fetch_url)
SEARCH_ONLY_TOOLS = [TOOL_DEFINITIONS[0]]


SEARCH_TIMEOUT = 10  # seconds per DuckDuckGo request


def web_search(query: str) -> tuple[str, list[dict]]:
    """
    Search DuckDuckGo and return (formatted_text, sources).
    sources is a list of {query, title, url} dicts.
    """
    try:
        with DDGS(timeout=SEARCH_TIMEOUT) as ddgs:
            results = list(ddgs.text(query, max_results=MAX_SEARCH_RESULTS))
        if not results:
            return "No results found.", []
        lines: list[str] = []
        sources: list[dict] = []
        for r in results:
            title = r.get("title", "")
            href = r.get("href", "")
            body = r.get("body", "")
            lines.append(f"Title: {title}\nURL: {href}\nSnippet: {body}\n")
            sources.append({"query": query, "title": title, "url": href})
        return "\n".join(lines), sources
    except Exception as e:
        return f"Search error: {e}", []


def fetch_url(url: str) -> str:
    """
    Fetch the text content of an http/https URL.
    Blocks private/loopback addresses (SSRF guard).
    Returns up to MAX_PAGE_CHARS of stripped text.
    """
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return "Blocked: only http/https URLs are allowed."
        host = parsed.hostname or ""
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return "Blocked: private/loopback addresses are not allowed."
        except ValueError:
            if host.lower() in ("localhost", "127.0.0.1", "::1"):
                return "Blocked: localhost is not allowed."

        resp = requests.get(
            url,
            timeout=10,
            headers={"User-Agent": "LeapReader/1.0"},
            allow_redirects=True,
        )
        resp.raise_for_status()
        text = resp.text
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:MAX_PAGE_CHARS]
    except Exception as e:
        return f"Fetch error: {e}"


def dispatch(tool_name: str, args: dict) -> str:
    """Dispatch a tool call by name and return its string result."""
    if tool_name == "web_search":
        text, _ = web_search(args.get("query", ""))
        return text
    if tool_name == "fetch_url":
        return fetch_url(args.get("url", ""))
    return f"Unknown tool: {tool_name}"
