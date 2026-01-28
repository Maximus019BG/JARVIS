"""Web search tool for retrieving information from the internet.

Provides web search capabilities with:
- Query-based searching
- Result parsing and extraction
- Rate limiting
"""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError, ToolResult

logger = get_logger(__name__)


class WebSearchTool(BaseTool):
    """Tool for searching the web.

    Uses DuckDuckGo search by default (no API key required).
    Can be extended to support other search providers.
    """

    def __init__(self, max_results: int = 5) -> None:
        self.max_results = max_results
        self._search_available = self._check_search_available()

    def _check_search_available(self) -> bool:
        """Check if search library is available."""
        try:
            from duckduckgo_search import DDGS  # noqa: F401

            return True
        except ImportError:
            logger.warning(
                "duckduckgo-search not installed. "
                "Install with: pip install duckduckgo-search"
            )
            return False

    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return (
            "Search the web for information. Returns relevant search results "
            "with titles, URLs, and snippets. Use this to find current information "
            "or research topics."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5)",
                    "default": 5,
                },
                "region": {
                    "type": "string",
                    "description": "Region for search results (e.g., 'us-en', 'uk-en')",
                    "default": "wt-wt",
                },
            },
            "required": ["query"],
        }

    def execute(
        self,
        query: str = "",
        max_results: int | None = None,
        region: str = "wt-wt",
    ) -> ToolResult:
        """Execute web search.

        Args:
            query: Search query.
            max_results: Maximum results to return.
            region: Search region.

        Returns:
            Formatted search results.
        """
        if not query.strip():
            return ToolResult.fail("Please provide a search query.", error_type="ValidationError")

        if not self._search_available:
            return ToolResult.fail(
                "Web search is not available. Install duckduckgo-search: pip install duckduckgo-search",
                error_type="DependencyMissing",
            )

        max_results = max_results or self.max_results

        try:
            from duckduckgo_search import DDGS

            with DDGS() as ddgs:
                results = list(ddgs.text(query, region=region, max_results=max_results))

            if not results:
                return ToolResult.ok_result(f"No results found for: {query}")

            # Format results
            formatted = [f"## Search Results for: {query}\n"]
            for i, result in enumerate(results, 1):
                formatted.append(f"### {i}. {result.get('title', 'No title')}")
                formatted.append(f"**URL:** {result.get('href', 'N/A')}")
                formatted.append(f"{result.get('body', 'No description')}\n")

            logger.info(f"Web search for '{query}' returned {len(results)} results")
            return ToolResult.ok_result("\n".join(formatted))

        except Exception as e:
            logger.error(f"Web search failed: {e}")
            raise ToolError(f"Search failed: {e}") from e


class FetchWebpageTool(BaseTool):
    """Tool for fetching and extracting content from web pages."""

    def __init__(self, timeout: int = 10) -> None:
        self.timeout = timeout

    @property
    def name(self) -> str:
        return "fetch_webpage"

    @property
    def description(self) -> str:
        return (
            "Fetch and extract the main content from a webpage. "
            "Returns the text content of the page."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL of the webpage to fetch",
                },
                "extract_links": {
                    "type": "boolean",
                    "description": "Whether to extract links from the page",
                    "default": False,
                },
            },
            "required": ["url"],
        }

    def execute(
        self,
        url: str = "",
        extract_links: bool = False,
    ) -> ToolResult:
        """Fetch webpage content.

        Args:
            url: URL to fetch.
            extract_links: Whether to include links.

        Returns:
            Page content as text.
        """
        if not url.strip():
            return ToolResult.fail("Please provide a URL.", error_type="ValidationError")

        try:
            import urllib.request
            from html.parser import HTMLParser

            # Simple HTML text extractor
            class TextExtractor(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.text = []
                    self.links = []
                    self._in_script = False
                    self._in_style = False

                def handle_starttag(self, tag, attrs):
                    if tag == "script":
                        self._in_script = True
                    elif tag == "style":
                        self._in_style = True
                    elif tag == "a":
                        for name, value in attrs:
                            if name == "href" and value:
                                self.links.append(value)

                def handle_endtag(self, tag):
                    if tag == "script":
                        self._in_script = False
                    elif tag == "style":
                        self._in_style = False

                def handle_data(self, data):
                    if not self._in_script and not self._in_style:
                        text = data.strip()
                        if text:
                            self.text.append(text)

            # Fetch the page
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "JARVIS/1.0 (Research Agent)"},
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                html = response.read().decode("utf-8", errors="ignore")

            # Parse HTML
            parser = TextExtractor()
            parser.feed(html)

            content = "\n".join(parser.text)

            # Truncate if too long
            if len(content) > 10000:
                content = content[:10000] + "\n\n[Content truncated...]"

            result = f"## Content from: {url}\n\n{content}"

            if extract_links and parser.links:
                result += "\n\n### Links found:\n"
                for link in parser.links[:20]:  # Limit links
                    result += f"- {link}\n"

            logger.info(f"Fetched webpage: {url}")
            return ToolResult.ok_result(result)

        except Exception as e:
            logger.error(f"Failed to fetch webpage: {e}")
            raise ToolError(f"Failed to fetch webpage: {e}") from e
