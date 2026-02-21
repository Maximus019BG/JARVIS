"""JARVIS TUI – Textual-based terminal user interface.

Dark grey / almost-black background with greenish-blue accents.
"""

from __future__ import annotations

import asyncio
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
    from core.chat_handler import ChatHandler

logger = get_logger(__name__)

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
"""


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
    """The JARVIS Textual TUI application."""

    TITLE = "JARVIS"
    SUB_TITLE = "AI-Powered Hardware Assistant"
    CSS = CSS

    BINDINGS = [
        Binding("ctrl+c", "quit", "Quit", show=True, priority=True),
        Binding("ctrl+l", "clear_chat", "Clear chat", show=True),
        Binding("ctrl+s", "show_status", "Status", show=True),
        Binding("escape", "focus_input", "Focus input", show=False),
    ]

    is_processing = reactive(False)

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

    # ── Layout ────────────────────────────────────────────────────

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)

        with Container(id="main-container"):
            # Sidebar
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
                yield Label("  /quit    – exit", classes="sidebar-item")

            # Chat area
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
            # Call the async router directly to avoid asyncio.run() inside
            # an already-running event loop (Textual's).
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
                response = await self.chat_handler.process_message(text)

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
            "| `/quit` | Exit JARVIS |\n\n"
            "*Tips:* Ask me to code, plan, design, or research. "
            "I'll use multiple AI agents for complex tasks."
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
