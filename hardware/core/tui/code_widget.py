"""Code Engine Widget – TUI pane showing script source + console output.

Layout (inside a Vertical):
    ┌─────────── Code Engine ───────────┐
    │ ▸ script_name.py                  │  ← header
    ├───────────────────────────────────┤
    │  1│ import math                   │  ← source view (scrollable)
    │  2│ print(math.pi)               │
    │ ...                               │
    ├───────────── Output ──────────────┤
    │ 3.141592653589793                 │  ← output view (scrollable)
    │                                   │
    └───────────────────────────────────┘
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.containers import Vertical, VerticalScroll
from textual.reactive import reactive
from textual.widgets import Label, Static

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from core.code.engine import CodeEngine

logger = get_logger(__name__)

# ── Theme tokens (matching app.py) ───────────────────────────────────
ACCENT = "#3ec9b0"
ACCENT_DIM = "#2a8c7a"
BG_DARK = "#111214"
BG_SURFACE = "#1a1c1f"
TEXT_PRIMARY = "#d4d4d4"
TEXT_DIM = "#6b7280"

# Rich markup helpers
_C_LINENO = "dim cyan"
_C_CODE = "white"
_C_KEYWORD = "bold magenta"
_C_STRING = "green"
_C_COMMENT = "dim green"
_C_OUTPUT = "bright_white"
_C_ERROR = "bold red"
_C_OK = "bold green"
_C_RUNNING = "bold yellow"


def _syntax_highlight_line(line: str) -> str:
    """Minimal syntax highlighting using Rich markup.

    Not a full parser — just enough to look nice in the terminal.
    """
    import re as _re

    # Preserve leading whitespace
    stripped = line.lstrip()
    indent = line[: len(line) - len(stripped)]

    # Comments
    if stripped.startswith("#"):
        return f"[{_C_COMMENT}]{line}[/]"

    # Keyword highlighting
    _KEYWORDS = (
        r"\b(def|class|return|import|from|if|elif|else|for|while|with|as|try"
        r"|except|finally|raise|yield|async|await|pass|break|continue"
        r"|and|or|not|in|is|None|True|False|lambda|global|nonlocal|del"
        r"|assert|print)\b"
    )

    def _kw_repl(m: _re.Match) -> str:
        return f"[{_C_KEYWORD}]{m.group()}[/]"

    result = _re.sub(_KEYWORDS, _kw_repl, stripped)

    # String literals (simple — single and double quotes)
    def _str_repl(m: _re.Match) -> str:
        return f"[{_C_STRING}]{m.group()}[/]"

    result = _re.sub(r'("""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|"[^"]*"|\'[^\']*\')', _str_repl, result)

    return f"{indent}{result}"


def _render_source(source: str) -> str:
    """Render source code with line numbers and syntax highlighting."""
    lines = source.split("\n")
    width = len(str(len(lines)))
    rendered: list[str] = []
    for i, line in enumerate(lines, 1):
        lineno = f"[{_C_LINENO}]{i:>{width}}│[/] "
        highlighted = _syntax_highlight_line(line)
        rendered.append(f"{lineno}{highlighted}")
    return "\n".join(rendered)


def _render_output(output: str, ok: bool | None = None) -> str:
    """Render execution output with status colouring."""
    if not output:
        return f"[{TEXT_DIM}](no output)[/]"

    colour = _C_OUTPUT
    if ok is False:
        colour = _C_ERROR
    elif ok is True:
        colour = _C_OK

    # Colourize each line
    lines = output.split("\n")
    return "\n".join(f"[{colour}]{line}[/]" for line in lines)


class SourceView(Static):
    """Scrollable source code display."""

    DEFAULT_CSS = """
    SourceView {
        width: 100%;
        height: 1fr;
        overflow-y: auto;
        padding: 0 1;
    }
    """

    source_text = reactive("", layout=True)

    def watch_source_text(self, value: str) -> None:
        self.update(value)


class OutputView(Static):
    """Scrollable output display."""

    DEFAULT_CSS = """
    OutputView {
        width: 100%;
        height: 1fr;
        overflow-y: auto;
        padding: 0 1;
    }
    """

    output_text = reactive("", layout=True)

    def watch_output_text(self, value: str) -> None:
        self.update(value)


class CodeEngineWidget(Static):
    """Composite widget: header + source view + divider + output view."""

    DEFAULT_CSS = """
    CodeEngineWidget {
        width: 100%;
        height: 100%;
        layout: vertical;
    }
    """

    script_name = reactive("", layout=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._engine: CodeEngine | None = None
        self._source_view: SourceView | None = None
        self._output_view: OutputView | None = None
        self._header_label: Label | None = None
        self._status_label: Label | None = None

    @property
    def engine(self) -> CodeEngine | None:
        return self._engine

    @engine.setter
    def engine(self, eng: CodeEngine) -> None:
        self._engine = eng

    def compose(self) -> ComposeResult:
        yield Label("▸ (no script)", id="code-header")
        yield Label(
            f"[{ACCENT_DIM}]{'─' * 60}  Source  {'─' * 60}[/]",
            id="code-source-divider",
        )
        yield SourceView(id="code-source-view")
        yield Label(
            f"[{ACCENT_DIM}]{'─' * 60}  Output  {'─' * 60}[/]",
            id="code-output-divider",
        )
        yield OutputView(id="code-output-view")
        yield Label("", id="code-status")

    def on_mount(self) -> None:
        self._header_label = self.query_one("#code-header", Label)
        self._source_view = self.query_one("#code-source-view", SourceView)
        self._output_view = self.query_one("#code-output-view", OutputView)
        self._status_label = self.query_one("#code-status", Label)

    # ── Public API ────────────────────────────────────────────────

    def show_script(
        self,
        name: str,
        source: str,
        output: str = "",
        ok: bool | None = None,
    ) -> None:
        """Display a script's source and output."""
        self.script_name = name
        if self._header_label:
            self._header_label.update(f"[bold {ACCENT}]▸ {name}[/]")
        if self._source_view:
            self._source_view.source_text = _render_source(source)
        if self._output_view:
            self._output_view.output_text = _render_output(output, ok)
        if self._status_label:
            if ok is None:
                self._status_label.update(f"[{TEXT_DIM}]Saved[/]")
            elif ok:
                self._status_label.update(f"[{_C_OK}]✓ Execution succeeded[/]")
            else:
                self._status_label.update(f"[{_C_ERROR}]✗ Execution failed[/]")

    def show_running(self) -> None:
        """Indicate that a script is being executed."""
        if self._status_label:
            self._status_label.update(f"[{_C_RUNNING}]⟳ Running…[/]")
        if self._output_view:
            self._output_view.output_text = f"[{_C_RUNNING}]Running…[/]"

    async def load_and_run(self, path: str) -> bool:
        """Load a script from disk, display it, run it, display output."""
        if self._engine is None:
            from core.code.engine import CodeEngine
            self._engine = CodeEngine()
        if not self._engine.load_script(path):
            return False
        st = self._engine.state
        self.show_script(st.file_name, st.source)
        self.show_running()
        result = await self._engine.run_script()
        self.show_script(
            st.file_name, st.source, result.combined_output, result.ok,
        )
        return True
