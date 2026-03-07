"""JARVIS TUI – Textual-based terminal user interface.

Dark grey / almost-black background with greenish-blue accents.
Supports split-pane view with blueprint engine grid on the left
and chat on the right when a blueprint is being edited.
"""

from __future__ import annotations

import asyncio
import re
from typing import TYPE_CHECKING, Any

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.css.query import NoMatches
from textual.reactive import reactive
from textual.widgets import (
    Footer,
    Header,
    Input,
    Label,
    Markdown,
    Static,
)

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from core.agents import OrchestratorAgent
    from core.blueprint.engine import BlueprintEngine
    from core.chat_handler import ChatHandler

logger = get_logger(__name__)

# ── Regex for natural-language "open <blueprint>" commands ────────────
_OPEN_BLUEPRINT_RE = re.compile(
    r'^(?:open|load|show|display|view)\s+'
    r'(?:the\s+)?'
    r'(?:blueprint\s+)?'
    r'(.+?)'
    r'(?:\s+blueprint)?$',
    re.IGNORECASE,
)

# ── Accent colour tokens ─────────────────────────────────────────────
# "Greenish-blue" ≈ teal / cyan-ish
ACCENT = "#3ec9b0"        # primary accent
ACCENT_DIM = "#2a8c7a"    # muted accent for borders / secondary
BG_DARK = "#111214"       # almost-black background
BG_SURFACE = "#1a1c1f"    # slightly lighter surface
BG_INPUT = "#1e2024"      # input area
TEXT_PRIMARY = "#d4d4d4"   # main text
TEXT_DIM = "#6b7280"       # dimmed / secondary text


# ── Custom CSS ────────────────────────────────────────────────────────
CSS = f"""
Screen {{
    background: {BG_DARK};
}}

#main-container {{
    width: 100%;
    height: 100%;
    background: {BG_DARK};
}}

/* ── Header ─────────────────────────────────────────────────────── */
Header {{
    background: {BG_SURFACE};
    color: {ACCENT};
    dock: top;
    height: 3;
}}

HeaderTitle {{
    color: {ACCENT};
    text-style: bold;
}}

/* ── Sidebar ────────────────────────────────────────────────────── */
#sidebar {{
    width: 28;
    background: {BG_SURFACE};
    border-right: solid {ACCENT_DIM};
    padding: 1 1;
    dock: left;
}}

#sidebar-title {{
    color: {ACCENT};
    text-style: bold;
    padding-bottom: 1;
    text-align: center;
}}

.sidebar-section {{
    color: {TEXT_DIM};
    padding: 0 0 0 0;
    margin: 1 0 0 0;
    text-style: bold;
}}

.sidebar-item {{
    color: {TEXT_PRIMARY};
    padding: 0 0 0 1;
}}

.sidebar-agent {{
    color: {ACCENT};
    padding: 0 0 0 1;
}}

/* ── Chat area ──────────────────────────────────────────────────── */
#chat-area {{
    width: 1fr;
    height: 1fr;
    background: {BG_DARK};
}}

#messages-scroll {{
    height: 1fr;
    background: {BG_DARK};
    padding: 1 2;
    scrollbar-color: {ACCENT_DIM};
    scrollbar-color-hover: {ACCENT};
    scrollbar-color-active: {ACCENT};
}}

/* ── Message bubbles ────────────────────────────────────────────── */
.message-row {{
    width: 100%;
    margin: 0 0 1 0;
    height: auto;
}}

.user-label {{
    color: {ACCENT};
    text-style: bold;
    margin: 0 0 0 0;
}}

.assistant-label {{
    color: {TEXT_DIM};
    text-style: bold;
    margin: 0 0 0 0;
}}

.message-body {{
    color: {TEXT_PRIMARY};
    margin: 0 0 0 2;
    width: 100%;
}}

.system-message {{
    color: {TEXT_DIM};
    text-style: italic;
    margin: 0 0 1 0;
    text-align: center;
}}

.error-message {{
    color: #e06c75;
    margin: 0 0 1 2;
}}

/* ── Input bar ──────────────────────────────────────────────────── */
#input-bar {{
    height: auto;
    dock: bottom;
    padding: 0 1;
    background: {BG_SURFACE};
    border-top: solid {ACCENT_DIM};
}}

#prompt-label {{
    color: {ACCENT};
    width: auto;
    padding: 1 1 1 1;
    text-style: bold;
}}

#user-input {{
    width: 1fr;
    background: {BG_INPUT};
    color: {TEXT_PRIMARY};
    border: tall {ACCENT_DIM};
    padding: 0 1;
    margin: 0 0 0 0;
}}

#user-input:focus {{
    border: tall {ACCENT};
}}

/* ── Status bar (above input) ───────────────────────────────────── */
#status-bar {{
    height: 1;
    dock: bottom;
    background: {BG_SURFACE};
    color: {TEXT_DIM};
    padding: 0 2;
}}

/* ── Footer ─────────────────────────────────────────────────────── */
Footer {{
    background: {BG_SURFACE};
    color: {TEXT_DIM};
}}

FooterKey {{
    background: {BG_SURFACE};
    color: {ACCENT_DIM};
}}

/* ── Thinking spinner ───────────────────────────────────────────── */
.thinking {{
    color: {ACCENT};
    text-style: italic;
    margin: 0 0 0 2;
}}

/* ── Scrollbar tweaks ───────────────────────────────────────────── */
Vertical > ScrollBar {{
    background: {BG_DARK};
}}
/* ── Blueprint Engine Pane (split view) ──────────────────────── */
#split-container {{
    width: 100%;
    height: 100%;
    background: {BG_DARK};
}}

#blueprint-pane {{
    width: 1fr;
    height: 100%;
    background: {BG_DARK};
    border-right: solid {ACCENT_DIM};
    display: none;
}}

#blueprint-pane.visible {{
    display: block;
}}

#chat-pane {{
    width: 1fr;
    height: 100%;
    background: {BG_DARK};
}}

/* When blueprint pane is visible, blueprint takes 2/3, chat takes 1/3 */
#split-container.split-active #chat-pane {{
    width: 1fr;
}}

#split-container.split-active #blueprint-pane {{
    width: 2fr;
    display: block;
}}

/* ── Blueprint Widget Styles ────────────────────────────────── */
#bp-toolbar {{
    height: 1;
    dock: top;
    background: {BG_SURFACE};
    color: {ACCENT};
    padding: 0 1;
}}

#bp-toolbar Label {{
    color: {ACCENT_DIM};
}}

#bp-viewport {{
    width: 100%;
    height: 1fr;
    background: {BG_DARK};
    color: {TEXT_DIM};
    overflow: hidden;
}}

#bp-status {{
    height: 1;
    dock: bottom;
    background: {BG_SURFACE};
    color: {TEXT_DIM};
    padding: 0 1;
}}

#bp-engine-widget {{
    width: 100%;
    height: 100%;
}}

#bp-header {{
    height: 1;
    dock: top;
    background: {BG_SURFACE};
    color: {ACCENT};
    text-style: bold;
    padding: 0 1;
    text-align: center;
}}

/* ── Code Engine Pane ──────────────────────────────────────────── */
#code-pane {{
    width: 1fr;
    height: 100%;
    background: {BG_DARK};
    border-right: solid {ACCENT_DIM};
    display: none;
}}

#code-pane.visible {{
    display: block;
}}

#split-container.code-active #chat-pane {{
    width: 1fr;
}}

#split-container.code-active #code-pane {{
    width: 2fr;
    display: block;
}}

#code-header {{
    height: 1;
    dock: top;
    background: {BG_SURFACE};
    color: {ACCENT};
    text-style: bold;
    padding: 0 1;
}}

#code-source-divider, #code-output-divider {{
    height: 1;
    background: {BG_SURFACE};
    padding: 0 1;
}}

#code-source-view {{
    height: 1fr;
    background: {BG_DARK};
    padding: 0 1;
    overflow-y: auto;
}}

#code-output-view {{
    height: 1fr;
    background: #0d0e10;
    padding: 0 1;
    overflow-y: auto;
}}

#code-status {{
    height: 1;
    dock: bottom;
    background: {BG_SURFACE};
    color: {TEXT_DIM};
    padding: 0 1;
}}

#code-engine-widget {{
    width: 100%;
    height: 100%;
}}"""


# ── Widgets ───────────────────────────────────────────────────────────

class MessageWidget(Static):
    """A single chat message (user or assistant)."""

    def __init__(
        self,
        role: str,
        content: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.role = role
        self.msg_content = content

    def compose(self) -> ComposeResult:
        if self.role == "system":
            yield Label(self.msg_content, classes="system-message")
            return

        label_class = "user-label" if self.role == "user" else "assistant-label"
        label_text = "You" if self.role == "user" else "JARVIS"

        yield Label(f"▎ {label_text}", classes=label_class)
        yield Markdown(self.msg_content, classes="message-body")


class ThinkingIndicator(Static):
    """Animated thinking indicator."""

    def compose(self) -> ComposeResult:
        yield Label("⟳ Thinking…", classes="thinking")


# ── Main TUI Application ─────────────────────────────────────────────

class JarvisTUI(App):
    """The JARVIS Textual TUI application.

    Supports two layouts:
    - Chat-only: Standard chat interface with sidebar
    - Split-pane: Blueprint engine grid on the LEFT, chat on the RIGHT
      Activated when creating/loading a blueprint.
    """

    TITLE = "JARVIS"
    SUB_TITLE = "Agentic Hardware Assistant"
    CSS = CSS

    BINDINGS = [
        Binding("ctrl+c", "quit", "Quit", show=True, priority=True),
        Binding("ctrl+l", "clear_chat", "Clear chat", show=True),
        Binding("ctrl+s", "show_status", "Status", show=True),
        Binding("ctrl+b", "toggle_blueprint", "Toggle Blueprint", show=True),
        Binding("ctrl+d", "toggle_code", "Toggle Code", show=True, priority=True),
        Binding("f5", "toggle_render_mode", "Pixel/Char", show=True),
        Binding("escape", "focus_input", "Focus input", show=False),
    ]

    is_processing = reactive(False)
    blueprint_active = reactive(False)
    code_active = reactive(False)

    def __init__(
        self,
        chat_handler: ChatHandler,
        orchestrator: OrchestratorAgent | None = None,
        agent_names: list[str] | None = None,
        tool_count: int = 0,
        memory_active: bool = False,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.chat_handler = chat_handler
        self.orchestrator = orchestrator
        self.agent_names = agent_names or []
        self.tool_count = tool_count
        self.memory_active = memory_active
        self._engine: BlueprintEngine | None = None
        self._engine_widget = None
        self._code_engine = None
        self._code_widget = None
        # Pending device registration (password collection phase)
        self._pending_registration: dict[str, Any] | None = None

    # ── Layout ────────────────────────────────────────────────────

    def compose(self) -> ComposeResult:
        from core.tui.blueprint_widget import BlueprintEngineWidget
        from core.tui.code_widget import CodeEngineWidget

        yield Header(show_clock=True)

        with Container(id="main-container"):
            # Sidebar (leftmost)
            with Vertical(id="sidebar"):
                yield Label("⬡ JARVIS", id="sidebar-title")

                yield Label("AGENTS", classes="sidebar-section")
                if self.agent_names:
                    for name in self.agent_names:
                        yield Label(f"  ● {name}", classes="sidebar-agent")
                else:
                    yield Label("  (none)", classes="sidebar-item")

                yield Label("SYSTEM", classes="sidebar-section")
                yield Label(f"  Tools: {self.tool_count}", classes="sidebar-item")
                mem_status = "active" if self.memory_active else "basic"
                yield Label(f"  Memory: {mem_status}", classes="sidebar-item")

                yield Label("COMMANDS", classes="sidebar-section")
                yield Label("  /status  – info", classes="sidebar-item")
                yield Label("  /clear   – reset", classes="sidebar-item")
                yield Label("  /help    – help", classes="sidebar-item")
                yield Label("  /blueprint – toggle", classes="sidebar-item")
                yield Label("  /code    – toggle", classes="sidebar-item")
                yield Label("  /view     – render", classes="sidebar-item")
                yield Label("  /quit    – exit", classes="sidebar-item")

            # Split container: blueprint pane (left) + code pane (left) + chat pane (right)
            with Horizontal(id="split-container"):
                # Blueprint engine pane (hidden by default)
                with Vertical(id="blueprint-pane"):
                    yield Label(
                        "⬡ Blueprint Engine", id="bp-header"
                    )
                    yield BlueprintEngineWidget(id="bp-engine-widget")

                # Code engine pane (hidden by default)
                with Vertical(id="code-pane"):
                    yield CodeEngineWidget(id="code-engine-widget")

                # Chat pane (always visible)
                with Vertical(id="chat-pane"):
                    with Vertical(id="chat-area"):
                        with VerticalScroll(id="messages-scroll"):
                            pass  # messages appended dynamically

                        yield Label("", id="status-bar")

                        with Horizontal(id="input-bar"):
                            yield Label("❯", id="prompt-label")
                            yield Input(
                                placeholder="Type a message…",
                                id="user-input",
                            )

        yield Footer()

    # ── Lifecycle ─────────────────────────────────────────────────

    def on_mount(self) -> None:
        """Called when the app is mounted and ready."""
        self._append_system("Welcome to JARVIS! Type a message to begin.")
        self._append_system(
            "I can help with coding, planning, designing, research, and more."
        )
        self.query_one("#user-input", Input).focus()

        # Start memory session
        if self.chat_handler._memory_manager:
            try:
                session = self.chat_handler._memory_manager.start_session(
                    name="chat_session",
                    goals=[
                        "Assist user with tasks",
                        "Remember important information",
                    ],
                )
                self.chat_handler._session_started = True
                logger.info("Started session: %s", session.id)
            except Exception as e:
                logger.warning("Failed to start memory session: %s", e)

    # ── Actions ───────────────────────────────────────────────────

    def action_quit(self) -> None:
        """Quit the application."""
        self._end_session()
        self.exit()

    def action_clear_chat(self) -> None:
        """Clear chat messages."""
        scroll = self.query_one("#messages-scroll", VerticalScroll)
        scroll.remove_children()
        self.chat_handler.memory.clear_history()
        if self.chat_handler._memory_manager:
            self.chat_handler._memory_manager.clear_working_memory()
        self._append_system("Chat cleared.")

    def action_toggle_blueprint(self) -> None:
        """Toggle the blueprint engine pane visibility."""
        if self.blueprint_active:
            self._close_blueprint_pane()
        else:
            self._open_blueprint_pane()

    def action_toggle_code(self) -> None:
        """Toggle the code engine pane visibility."""
        if self.code_active:
            self._close_code_pane()
        else:
            self._open_code_pane()

    def action_toggle_render_mode(self) -> None:
        """Toggle blueprint viewport between char and pixel render modes."""
        if not self.blueprint_active:
            self._append_system("Open the blueprint pane first (Ctrl+B or /blueprint).")
            return
        try:
            from core.tui.blueprint_widget import BlueprintViewport
            viewport = self.query_one("#bp-viewport", BlueprintViewport)
            mode = viewport.toggle_render_mode()
            self._append_system(f"Render mode: {mode}")
        except Exception as exc:
            logger.exception("Failed to toggle render mode")
            self._append_error(f"Render mode toggle failed: {exc}")

    def action_show_status(self) -> None:
        """Show system status as a chat message."""
        lines = ["**JARVIS System Status**\n"]

        if self.orchestrator:
            agents = self.orchestrator.get_registered_agents()
            lines.append(f"- **Agents:** {len(agents)} active")
            for a in agents:
                lines.append(f"  - {a}")
        else:
            lines.append("- Agents: not available")

        if self.chat_handler._memory_manager:
            stats = self.chat_handler._memory_manager.get_stats()
            lines.append("- **Memory:** active")
            lines.append(
                f"  - Semantic: {stats['semantic']['total_memories']}"
            )
            lines.append(
                f"  - Episodes: {stats['episodic']['total_episodes']}"
            )
            lines.append(
                f"  - Messages: {stats['conversation']['message_count']}"
            )
        else:
            lines.append(
                f"- Memory: {len(self.chat_handler.memory.history)} messages"
            )

        lines.append(f"- **Tools:** {self.tool_count} registered")
        self._append_assistant("\n".join(lines))

    def action_focus_input(self) -> None:
        self.query_one("#user-input", Input).focus()

    # ── Input handling ────────────────────────────────────────────

    @on(Input.Submitted, "#user-input")
    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle user pressing Enter."""
        text = event.value.strip()
        if not text:
            return

        event.input.clear()

        # ── Password collection for device registration ───────
        if self._pending_registration is not None:
            self._complete_registration(text)
            return

        # Slash commands
        if text.lower() in ("/quit", "quit"):
            self.action_quit()
            return
        if text.lower() in ("/status", "status"):
            self.action_show_status()
            return
        if text.lower() in ("/clear", "clear"):
            self.action_clear_chat()
            return
        if text.lower() in ("/help", "help"):
            self._show_help()
            return
        if text.lower() in ("/reflect", "reflect"):
            self._show_reflection()
            return
        if text.lower() in ("/blueprint",):
            self.action_toggle_blueprint()
            return
        if text.lower().startswith("/load"):
            parts = text.strip().split(None, 1)
            name = parts[1].strip() if len(parts) > 1 else ""
            self._load_blueprint_by_name(name)
            return
        if text.lower() in ("/view", "/pixel", "/render"):
            self.action_toggle_render_mode()
            return
        if text.lower() in ("/code",):
            self.action_toggle_code()
            return

        # Natural-language "open <blueprint>" shortcut
        open_match = _OPEN_BLUEPRINT_RE.match(text)
        if open_match:
            bp_query = open_match.group(1).strip()
            found = self._fuzzy_find_blueprint(bp_query)
            if found:
                self._append_user(text)
                self._load_blueprint_by_name(found)
                return
            # No match — fall through to the AI for a natural response

        self._append_user(text)
        self._send_message(text)

    # ── Async message processing ──────────────────────────────────

    @work(thread=False)
    async def _send_message(self, text: str) -> None:
        """Process user message asynchronously."""
        self.is_processing = True
        self._update_status("Processing…")

        # Add thinking indicator
        thinking = ThinkingIndicator()
        scroll = self.query_one("#messages-scroll", VerticalScroll)
        await scroll.mount(thinking)
        scroll.scroll_end(animate=False)

        try:
            self.chat_handler._message_count += 1

            # Record in episodic memory
            if self.chat_handler._memory_manager:
                self.chat_handler._memory_manager.record_conversation(
                    "user", text
                )

            # Route to orchestrator or direct LLM
            # When a blueprint is open, ALWAYS go direct so the LLM can
            # call edit_blueprint for drawing / component / reset changes.
            # Also bypass orchestrator when the user wants to CREATE a new
            # blueprint/circuit/plan — the create_blueprint tool handles that
            # and the orchestrator would just chat about it without drawing.
            _CREATE_DESIGN_RE = re.compile(
                r"\b(?:create|make|draw|design|sketch|build)\b.*"
                r"\b(?:schema(?:tic)?|circuit|electric|diagram|plan|layout"
                r"|blueprint|bedroom|room|floor|bulb|battery|wiring)\b",
                re.IGNORECASE,
            )
            # Detect coding/scripting requests so we route to the run_script tool
            _CODE_REQUEST_RE = re.compile(
                r"\b(?:write|create|make|code|script|program|build|generate)\b.*"
                r"\b(?:python|script|program|code|function|class|app|game"
                r"|calculator|sorter|converter|tool|utility|bot)\b"
                r"|\b(?:run|execute|open|launch)\b.*\b(?:script|code|program|python)\b"
                r"|\bpython\s+(?:script|program|code|that|which|to)\b"
                # Catch short follow-up requests when code pane is already open
                r"|\b(?:create|make|write|code|generate)\b.*\b(?:new|another|one|it|that|this)\b"
                r"|\b(?:new|another)\b.*\b(?:script|file|program|one)\b"
                # Catch "open/run it", "run <name>", "execute it"
                r"|\b(?:run|execute|open|launch)\b.*\b(?:it|that|this|the)\b"
                r"|\b(?:open|run|execute)\b\s+\w+\.py\b",
                re.IGNORECASE,
            )
            wants_create_design = bool(_CREATE_DESIGN_RE.search(text))
            wants_code = bool(_CODE_REQUEST_RE.search(text)) or self.code_active
            if self.blueprint_active or wants_create_design or wants_code:
                use_orchestrator = False
            else:
                # Call the async router directly to avoid asyncio.run()
                # inside an already-running event loop (Textual's).
                use_orchestrator = await (
                    self.chat_handler._orchestration_router
                    .should_use_orchestrator_async(
                        text, self.chat_handler._llm
                    )
                )
            if use_orchestrator:
                self._update_status("Multi-agent processing…")
                response = await self.chat_handler._process_with_orchestrator(text)
            else:
                # When a blueprint is open or user wants to create a design,
                # always include tool schemas so the LLM can call
                # edit_blueprint / create_blueprint.
                # Also pass the active blueprint path so the handler can
                # auto-inject it into edit_blueprint calls that omit it.
                bp_path: str | None = None
                if self.blueprint_active and self._engine is not None:
                    fp = self._engine.state.file_path
                    if fp:
                        bp_path = str(fp)
                # When code engine is open, prepend a context hint so the
                # LLM knows to use run_script instead of pasting code in chat.
                effective_text = text
                if self.code_active:
                    effective_text = (
                        "[Code engine is active — ALWAYS use the run_script tool. "
                        "To CREATE a new script: run_script(name=..., code=...). "
                        "To OPEN/RUN an existing script: run_script(name=...) without code. "
                        "Never paste code as plain text.]"
                        f"\n\nUser: {text}"
                    )
                response = await self.chat_handler.process_message(
                    effective_text,
                    force_tools=self.blueprint_active or wants_create_design or wants_code,
                    active_blueprint_path=bp_path,
                )

            # Record response in memory
            if self.chat_handler._memory_manager:
                self.chat_handler._memory_manager.record_conversation(
                    "assistant", response
                )

            # Remove thinking indicator and show response
            try:
                await thinking.remove()
            except Exception:
                pass

            self._append_assistant(response)

            # Check if any tool results signal to open/reload the blueprint engine
            for tr in getattr(self.chat_handler, "_last_tool_results", []):
                self._handle_tool_result_for_engine(tr)
                self._handle_password_prompt(tr)
            self.chat_handler._last_tool_results = []

            # If engine is already open, auto-refresh to pick up any
            # file-based edits (e.g. edit_blueprint wrote to disk).
            if self.blueprint_active and self._engine is not None:
                current_path = self._engine.state.file_path
                if current_path and current_path.exists():
                    self._load_blueprint_into_engine(str(current_path))

            # If no tool opened the engine, check whether the response itself
            # contains a .jarvis JSON block (e.g. from the Blueprint Agent via
            # the orchestrator path) and save + open it.
            if not self.blueprint_active:
                bp_data = self._extract_blueprint_json(response)
                if bp_data:
                    saved_path = self._save_extracted_blueprint(bp_data)
                    if saved_path:
                        self._open_blueprint_pane(blueprint_path=saved_path)

        except Exception as exc:
            logger.exception("Error processing message")
            try:
                await thinking.remove()
            except Exception:
                pass
            self._append_error(f"Error: {exc}")
        finally:
            self.is_processing = False
            self._update_status("")

    # ── Message helpers ───────────────────────────────────────────

    def _append_user(self, text: str) -> None:
        scroll = self.query_one("#messages-scroll", VerticalScroll)
        msg = MessageWidget("user", text, classes="message-row")
        scroll.mount(msg)
        scroll.scroll_end(animate=False)

    def _append_assistant(self, text: str) -> None:
        scroll = self.query_one("#messages-scroll", VerticalScroll)
        msg = MessageWidget("assistant", text, classes="message-row")
        scroll.mount(msg)
        scroll.scroll_end(animate=False)

    def _append_system(self, text: str) -> None:
        scroll = self.query_one("#messages-scroll", VerticalScroll)
        msg = MessageWidget("system", text, classes="message-row")
        scroll.mount(msg)
        scroll.scroll_end(animate=False)

    def _append_error(self, text: str) -> None:
        scroll = self.query_one("#messages-scroll", VerticalScroll)
        lbl = Label(text, classes="error-message")
        scroll.mount(lbl)
        scroll.scroll_end(animate=False)

    def _update_status(self, text: str) -> None:
        try:
            bar = self.query_one("#status-bar", Label)
            bar.update(text)
        except NoMatches:
            pass

    # ── Slash command handlers ────────────────────────────────────

    def _show_help(self) -> None:
        help_md = (
            "**JARVIS Commands**\n\n"
            "| Command | Description |\n"
            "|---------|-------------|\n"
            "| `/help` | Show this help |\n"
            "| `/status` | System status |\n"
            "| `/reflect` | Memory insights |\n"
            "| `/clear` | Clear conversation |\n"
            "| `/blueprint` | Toggle blueprint engine |\n"            "| `/load [name]` | Load a blueprint file |\\n"            "| `/view` | Toggle pixel/char render |\n"
            "| `/quit` | Exit JARVIS |\n\n"
            "*Tips:* Just say **\"open duck\"** (or any blueprint name) to "
            "search and load it instantly. The blueprint engine opens "
            "in split-pane view — grid on the left, chat on the right.\n\n"
            "*Editing:* Once the blueprint is open, just describe the "
            "changes you want (e.g. \"add a wing\", \"remove eye1\"). "
            "The AI will apply the edits and the engine will update "
            "in real-time.\n\n"
            "*Blueprint:* You can import other blueprints to combine "
            "them together \u2013 they\u2019ll be added as movable groups.\n\n"
            "*Render:* Press F5 or type `/view` to switch between "
            "character (braille) and pixel (half-block) rendering."
        )
        self._append_assistant(help_md)

    def _show_reflection(self) -> None:
        if not self.chat_handler._memory_manager:
            self._append_system("Memory system not available.")
            return

        reflection = self.chat_handler._memory_manager.reflect()
        insights = self.chat_handler._memory_manager.get_insights()
        if insights:
            reflection += "\n\n**Insights:**\n"
            for insight in insights:
                reflection += f"- {insight}\n"
        self._append_assistant(reflection)

    # ── Blueprint Engine Management ──────────────────────────────

    @staticmethod
    def _extract_blueprint_json(text: str) -> dict[str, Any] | None:
        """Try to extract a .jarvis JSON object from a text response.

        Looks for JSON blocks (fenced or bare) that contain ``jarvis_version``
        and ``name`` — the minimum markers for a valid .jarvis file.
        Returns the first matching dict or ``None``.
        """
        import json as _json
        import re as _re

        # Try fenced code blocks first (```json ... ``` or ``` ... ```)
        for m in _re.finditer(r"```(?:json)?\s*\n(.*?)```", text, _re.DOTALL):
            try:
                obj = _json.loads(m.group(1))
                if isinstance(obj, dict) and "name" in obj:
                    return obj
            except (ValueError, TypeError):
                continue

        # Fallback: look for the outermost { … } that is valid JSON
        depth = 0
        start = None
        for i, ch in enumerate(text):
            if ch == "{":
                if depth == 0:
                    start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and start is not None:
                    candidate = text[start : i + 1]
                    try:
                        obj = _json.loads(candidate)
                        if isinstance(obj, dict) and "name" in obj:
                            return obj
                    except (ValueError, TypeError):
                        pass
                    start = None

        return None

    def _save_extracted_blueprint(self, data: dict[str, Any]) -> str | None:
        """Save an extracted blueprint dict to disk and return the path.

        Adds missing .jarvis metadata and saves into ``data/blueprints/``.
        Returns the absolute path string on success, ``None`` on failure.
        """
        import json as _json
        from datetime import datetime
        from pathlib import Path

        name = data.get("name", "untitled").strip()
        if not name:
            return None

        data.setdefault("jarvis_version", "1.0")
        data.setdefault("type", "part")
        data.setdefault("created", datetime.now().isoformat())
        data.setdefault("description", "")
        data.setdefault("components", [])
        data.setdefault("connections", [])

        # Ensure every component has an id
        for i, comp in enumerate(data.get("components", [])):
            if isinstance(comp, dict) and "id" not in comp:
                comp["id"] = f"comp_{i:03d}"

        safe_name = (
            name.lower()
            .replace(" ", "_")
            .replace("-", "_")
        )
        # Strip .jarvis suffix to avoid double extensions
        if safe_name.endswith(".jarvis"):
            safe_name = safe_name[:-7]

        bp_dir = Path("data") / "blueprints"
        bp_dir.mkdir(parents=True, exist_ok=True)
        path = bp_dir / f"{safe_name}.jarvis"

        try:
            path.write_text(
                _json.dumps(data, indent=2, default=str), encoding="utf-8"
            )
            logger.info("Saved extracted blueprint to %s", path)
            return str(path.resolve())
        except Exception as exc:
            logger.error("Failed to save extracted blueprint: %s", exc)
            return None

    def _open_blueprint_pane(self, blueprint_path: str | None = None) -> None:
        """Open the blueprint engine pane in split view.

        Args:
            blueprint_path: Optional path to load a blueprint.
                If *None*, auto-loads the most recently modified .jarvis file.
        """
        try:
            bp_pane = self.query_one("#blueprint-pane", Vertical)
            split = self.query_one("#split-container", Horizontal)
        except NoMatches:
            return

        bp_pane.add_class("visible")
        split.add_class("split-active")
        self.blueprint_active = True

        # Initialize engine if needed
        if self._engine is None:
            from core.blueprint.engine import BlueprintEngine
            self._engine = BlueprintEngine()

        # Set engine on widget
        try:
            from core.tui.blueprint_widget import BlueprintEngineWidget
            widget = self.query_one("#bp-engine-widget", BlueprintEngineWidget)
            widget.engine = self._engine
            self._engine_widget = widget
        except NoMatches:
            pass

        if blueprint_path:
            self._load_blueprint_into_engine(blueprint_path)
        elif self._engine and self._engine.state.blueprint is None:
            # Auto-load most recently modified .jarvis file
            auto = self._find_latest_blueprint()
            if auto:
                self._load_blueprint_into_engine(auto)

        self._append_system(
            "Blueprint engine opened. Grid on the left, chat on the right. "
            "Use Ctrl+B or /blueprint to toggle.  "
            "Press F5 or type /view to switch char↔pixel rendering."
        )

    def _close_blueprint_pane(self) -> None:
        """Close the blueprint engine pane."""
        try:
            bp_pane = self.query_one("#blueprint-pane", Vertical)
            split = self.query_one("#split-container", Horizontal)
        except NoMatches:
            return

        bp_pane.remove_class("visible")
        split.remove_class("split-active")
        self.blueprint_active = False
        self._append_system("Blueprint engine closed.")

    # ── Code engine pane ──────────────────────────────────────────

    def _open_code_pane(
        self,
        script_name: str = "",
        source: str = "",
        output: str = "",
        ok: bool | None = None,
    ) -> None:
        """Open the code engine pane in split view."""
        try:
            code_pane = self.query_one("#code-pane", Vertical)
            split = self.query_one("#split-container", Horizontal)
        except NoMatches:
            return

        # Close blueprint pane if open to avoid clutter
        if self.blueprint_active:
            self._close_blueprint_pane()

        code_pane.add_class("visible")
        split.add_class("code-active")
        self.code_active = True

        # Initialise engine + widget references
        if self._code_engine is None:
            from core.code.engine import CodeEngine
            self._code_engine = CodeEngine()

        try:
            from core.tui.code_widget import CodeEngineWidget
            widget = self.query_one("#code-engine-widget", CodeEngineWidget)
            widget.engine = self._code_engine
            self._code_widget = widget
        except NoMatches:
            pass

        if source and self._code_widget:
            self._code_widget.show_script(script_name, source, output, ok)

        self._append_system(
            "Code engine opened. Source + output view on the left, chat on the right. "
            "Use Ctrl+D or /code to toggle."
        )

    def _close_code_pane(self) -> None:
        """Close the code engine pane."""
        try:
            code_pane = self.query_one("#code-pane", Vertical)
            split = self.query_one("#split-container", Horizontal)
        except NoMatches:
            return

        code_pane.remove_class("visible")
        split.remove_class("code-active")
        self.code_active = False
        self._append_system("Code engine closed.")

    def _find_latest_blueprint(self) -> str | None:
        """Return the path of the most recently modified .jarvis file, or None."""
        from pathlib import Path as _Path
        bp_dir = _Path("data/blueprints")
        if not bp_dir.is_dir():
            return None
        # Filter out double-extension files like .jarvis.jarvis
        jarvis_files = [
            p for p in bp_dir.glob("*.jarvis")
            if not p.stem.endswith(".jarvis")
        ]
        jarvis_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return str(jarvis_files[0]) if jarvis_files else None

    def _fuzzy_find_blueprint(self, query: str) -> str | None:
        """Fuzzy-search local blueprints by name.

        Returns the best matching blueprint *stem* (no extension) or None.
        Matches against file stems and the "name" field inside each .jarvis file.
        """
        import json as _json
        from pathlib import Path as _Path

        bp_dir = _Path("data/blueprints")
        if not bp_dir.is_dir():
            return None

        query_lower = query.lower().strip()
        if not query_lower:
            return None

        candidates: list[tuple[int, str]] = []  # (score, stem)

        for fp in bp_dir.glob("*.jarvis"):
            if fp.stem.endswith(".jarvis"):
                continue  # skip double-extension files
            stem = fp.stem
            stem_lower = stem.lower()

            # Also read the display name from inside the file
            display_name = stem
            try:
                data = _json.loads(fp.read_text(encoding="utf-8"))
                display_name = data.get("name", stem)
            except Exception:
                pass
            display_lower = display_name.lower()

            # Score: exact match > starts-with > contains > display name match
            if query_lower == stem_lower or query_lower == display_lower:
                candidates.append((100, stem))
            elif stem_lower.startswith(query_lower) or display_lower.startswith(query_lower):
                candidates.append((80, stem))
            elif query_lower in stem_lower or query_lower in display_lower:
                candidates.append((60, stem))
            # Simple character-level fuzzy: check if all query chars appear in order
            elif self._chars_in_order(query_lower, stem_lower) or self._chars_in_order(query_lower, display_lower):
                candidates.append((30, stem))

        if not candidates:
            return None

        # Return the best match
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]

    @staticmethod
    def _chars_in_order(query: str, target: str) -> bool:
        """Check if all characters of query appear in target in order."""
        it = iter(target)
        return all(c in it for c in query)

    def _load_blueprint_by_name(self, name: str) -> None:
        """Slash command handler: /load [name] or natural-language open.

        Opens the blueprint pane and loads the named file. If no name given,
        loads the most recently modified blueprint.  Supports fuzzy matching.
        """
        from pathlib import Path as _Path
        if name:
            # Try exact path, then data/blueprints/<name>, then <name>.jarvis
            candidates = [
                _Path(name),
                _Path("data/blueprints") / name,
                _Path("data/blueprints") / f"{name}.jarvis",
            ]
            bp_path = None
            for c in candidates:
                if c.exists():
                    bp_path = str(c)
                    break

            # If exact match failed, try fuzzy search
            if not bp_path:
                fuzzy_match = self._fuzzy_find_blueprint(name)
                if fuzzy_match:
                    candidate = _Path("data/blueprints") / f"{fuzzy_match}.jarvis"
                    if candidate.exists():
                        bp_path = str(candidate)
                        self._append_system(f"Matched: {fuzzy_match}")

            if not bp_path:
                # List available blueprints as suggestions
                bp_dir = _Path("data/blueprints")
                available = sorted(
                    f.stem for f in bp_dir.glob("*.jarvis")
                    if f.is_file() and not f.stem.endswith(".jarvis")
                ) if bp_dir.is_dir() else []
                if available:
                    self._append_error(
                        f"Blueprint '{name}' not found. "
                        f"Available: {', '.join(available)}"
                    )
                else:
                    self._append_error(f"Blueprint '{name}' not found.")
                return
        else:
            bp_path = self._find_latest_blueprint()
            if not bp_path:
                self._append_error("No .jarvis files found in data/blueprints/")
                return

        if not self.blueprint_active:
            self._open_blueprint_pane(blueprint_path=bp_path)
        else:
            self._load_blueprint_into_engine(bp_path)

    @work(thread=False)
    async def _load_blueprint_into_engine(self, path: str) -> None:
        """Load a blueprint file into the engine asynchronously."""
        if self._engine_widget is not None:
            success = await self._engine_widget.load_blueprint(path)
            if success:
                self._append_system(
                    f"Blueprint loaded into engine: {path}"
                )
            else:
                self._append_error(
                    f"Failed to load blueprint: {path}"
                )

    @work(thread=False)
    async def _create_blueprint_in_engine(
        self, name: str, bp_type: str = "part"
    ) -> None:
        """Create a new blueprint in the engine asynchronously."""
        if self._engine_widget is not None:
            success = await self._engine_widget.new_blueprint(name, bp_type)
            if success:
                self._append_system(
                    f"New blueprint '{name}' created in engine."
                )

    # ── Device registration password flow ───────────────────────

    def _handle_password_prompt(self, result: Any) -> None:
        """Detect a password_required tool result and switch input to masked mode."""
        from tools.register_device_tool import PASSWORD_REQUIRED

        if not hasattr(result, "error_type"):
            return
        if result.error_type != PASSWORD_REQUIRED:
            return

        meta = result.error_details or {}
        self._pending_registration = {
            "email": meta.get("email", ""),
            "device_name": meta.get("device_name"),
            "workstation_name": meta.get("workstation_name"),
        }

        inp = self.query_one("#user-input", Input)
        inp.password = True
        inp.placeholder = "Enter password (hidden)…"
        inp.focus()

    @work(thread=True)
    def _complete_registration(self, password: str) -> None:
        """Run the actual registration with the collected password, then restore input.

        Runs in a background thread so the blocking HTTP calls don't freeze the
        TUI.  All DOM mutations are dispatched back to the event-loop thread via
        ``call_from_thread``.
        """
        from tools.register_device_tool import RegisterDeviceTool

        reg = self._pending_registration or {}
        self._pending_registration = None

        # Restore normal input immediately (must go through the event loop)
        def _restore_input() -> None:
            inp = self.query_one("#user-input", Input)
            inp.password = False
            inp.placeholder = "Type a message…"

        self.app.call_from_thread(_restore_input)

        if not password:
            self.app.call_from_thread(self._append_assistant, "Registration cancelled — no password entered.")
            return

        self.app.call_from_thread(self._append_assistant, "Registering device…")

        tool = RegisterDeviceTool()
        result = tool.execute(
            email=reg.get("email", ""),
            password=password,
            device_name=reg.get("device_name"),
            workstation_name=reg.get("workstation_name"),
        )

        self.app.call_from_thread(self._append_assistant, result.content)

    def _handle_tool_result_for_engine(self, result: Any) -> None:
        """Check if a tool result signals to open the blueprint or code engine.

        Called after tool execution to detect create/load/edit blueprint results
        and run_script results. Opens the appropriate pane if needed.
        """
        if not hasattr(result, "error_details") or not result.error_details:
            return

        meta = result.error_details
        if not isinstance(meta, dict):
            return

        # Blueprint engine signals
        if meta.get("open_engine"):
            bp_path = meta.get("blueprint_path")
            bp_name = meta.get("blueprint_name", "")

            if not self.blueprint_active:
                self._open_blueprint_pane(blueprint_path=bp_path)
            elif bp_path:
                # Engine already open — reload file (handles edits)
                self._load_blueprint_into_engine(bp_path)

        # Code engine signals
        if meta.get("open_code_engine"):
            script_name = meta.get("script_name", "script")
            source = meta.get("source", "")
            output = meta.get("output", "")
            execution_ok = meta.get("execution_ok")
            if not self.code_active:
                self._open_code_pane(
                    script_name=f"{script_name}.py",
                    source=source,
                    output=output,
                    ok=execution_ok,
                )
            elif self._code_widget:
                self._code_widget.show_script(
                    f"{script_name}.py", source, output, execution_ok,
                )

    # ── Session cleanup ───────────────────────────────────────────

    def _end_session(self) -> None:
        if (
            self.chat_handler._memory_manager
            and self.chat_handler._session_started
        ):
            try:
                self.chat_handler._memory_manager.end_session(
                    summary=(
                        f"Chat session with "
                        f"{self.chat_handler._message_count} messages"
                    ),
                    outcomes=["Session completed normally"],
                )
            except Exception as e:
                logger.warning("Failed to end session: %s", e)

    # ── Watch reactive ────────────────────────────────────────────

    def watch_is_processing(self, processing: bool) -> None:
        """Disable / enable input while processing."""
        try:
            inp = self.query_one("#user-input", Input)
            inp.disabled = processing
            if not processing:
                inp.focus()
        except NoMatches:
            pass
