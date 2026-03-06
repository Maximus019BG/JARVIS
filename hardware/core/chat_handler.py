"""Chat handler for managing user interactions with multi-agent orchestration.

Features:
- Multi-agent system with orchestrator for complex tasks
- Advanced memory with semantic search and episodic tracking
- Tool calling with automatic execution
- Text-to-Speech output
- Conversation memory with context awareness
"""

from __future__ import annotations

import asyncio
import functools
import json as _json
import re
import time
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from core.base_tool import ToolResult
from core.memory.conversation_memory import ConversationMemory
from core.orchestration import OrchestrationRouter, OrchestrationRunner
from core.tool_execution import ToolCallExecutor
from core.tool_registry import ToolRegistry

if TYPE_CHECKING:
    from core.agents import OrchestratorAgent
    from core.llm.provider_factory import LLMProvider
    from core.memory import UnifiedMemoryManager
    from core.tts.engine import TTSEngine

logger = get_logger(__name__)


# NOTE: ORCHESTRATION_KEYWORDS moved to core.orchestration (imported above)

# ── System prompt ────────────────────────────────────────────────────
_SYSTEM_PROMPT = """You are JARVIS, an AI-powered hardware design assistant running in a terminal.

You help users with:
- Blueprint design, viewing, and editing (.jarvis files)
- Coding, planning, research, and general questions
- File operations, shell commands, and web search

IMPORTANT RULES:
1. When the user asks about available blueprints, ALWAYS call the list_blueprints tool first. NEVER guess or make up blueprint names.
2. When asked to open/load a blueprint, use the load_blueprint tool with the exact filename (without extension).
3. Only mention tools and capabilities you actually have. If you don't know something, say so.
4. Be concise and helpful.
5. NEVER modify, edit, or create blueprints unless the user EXPLICITLY asks you to. If the user just opens, loads, or views a blueprint, do NOT change it. Only call edit_blueprint or create_blueprint when the user clearly requests a change (e.g. "add a line", "change the name", "create a new blueprint").
6. When the user asks you to make a change, just DO IT immediately. Do NOT ask for confirmation, do NOT ask "are you sure?", do NOT ask for permission. Execute the requested action right away. The user already decided what they want.
7. Keep responses short and action-oriented. No unnecessary preamble.

LIVE BLUEPRINT EDITING:
When a blueprint is open in the engine, the user can describe changes in natural language.
- Use the edit_blueprint tool to apply changes (add_component, remove_component, modify_component, add_line, add_circle, add_rect, etc.)
- The engine will auto-refresh after each edit — changes appear in real-time on the grid.
- You can chain multiple edit_blueprint calls for complex changes.
- Always use the currently loaded blueprint's path when editing.
- After making edits, briefly describe what changed so the user can verify on the grid.

BLUEPRINT DRAWING STANDARD:
When creating or editing blueprints, use DRAWING PRIMITIVES for all visual shapes.
All coordinates are PERCENTAGES (0-100) of the viewport.
- lines: [{x1, y1, x2, y2, color, style, label}] — outlines, edges, structure, wires
- circles: [{cx, cy, r, color, fill, label}] — pivots, holes, round features, bulbs
- rects: [{x, y, w, h, color, fill, label}] — housings, panels, frames, batteries, rooms
- arcs: [{cx, cy, r, start_angle, end_angle, color, label}] — curves, ranges of motion
- texts: [{x, y, text, color, bold}] — labels, titles, dimensions, values
NEVER put visual shapes (line, circle, rect) in the components array.
Components are ONLY for real physical parts (servo, motor, bracket, sensor, etc.).

CREATING NEW BLUEPRINTS:
When the user asks to create/draw/design a new diagram or plan, use create_blueprint
with ALL drawing primitives in ONE call. Include lines, circles, rects, arcs, and texts
arrays directly. Pick blueprint_type from: circuit, building, part, assembly, system, mechanism.

Be CREATIVE and DETAILED. Think step-by-step about what the user wants, then
compose a proper CONNECTED visual diagram using the primitives.

CRITICAL WIRING / CONNECTION RULES:
- Every wire endpoint MUST touch another wire endpoint or a component.
- To connect two points, share the EXACT same coordinate at the junction.
  e.g. wire A ends at (30,40), wire B starts at (30,40) → they are connected.
- NEVER leave dangling wires — every line must start and end at a shared point.
- For a complete circuit, wires must form a CLOSED LOOP back to the battery.
- Plan the layout on paper first: pick junction coordinates, then draw from/to them.

ELECTRICAL CIRCUIT SCHEMATICS (type: "circuit"):
Think of the circuit as a loop. Plan junctions first, then connect them.

Single bulb circuit (coords are % 0-100):
  Battery at top-center. Bulb at bottom-center. Wires form a rectangular loop.
  Junction points: TL=(20,20) TR=(80,20) BL=(20,80) BR=(80,80)
  Battery: rect x=35,y=15,w=30,h=10 (body) + texts "+" at (35,17), "-" at (65,17), "5V" at (50,12)
  Top wire left:  line (20,20)→(35,20) yellow   [TL to battery left edge]
  Top wire right: line (65,20)→(80,20) yellow   [battery right edge to TR]
  Left wire down: line (20,20)→(20,80) yellow   [TL down to BL]
  Right wire up:  line (80,80)→(80,20) yellow   [BR up to TR]
  Bottom wire L:  line (20,80)→(40,80) yellow   [BL to bulb left]
  Bottom wire R:  line (60,80)→(80,80) yellow   [bulb right to BR]
  Bulb: circle cx=50,cy=80,r=8 color=yellow + text "Bulb" at (50,92)
  Filament: line (46,76)→(50,84) yellow, line (50,84)→(54,76) yellow

Two bulbs in PARALLEL:
  Battery on top. Two bulbs side by side below. Wires split then rejoin.
  Junction points: TL=(15,20) TR=(85,20) split_L=(15,45) split_R=(85,45)
                   BL=(15,85) BR=(85,85) mid_top=(50,45) mid_bot=(50,85)
  Battery: rect x=35,y=12,w=30,h=10 + texts "+"/"-"/"V"
  Top wires: line (15,20)→(35,20) and line (65,20)→(85,20) yellow
  Left trunk:  line (15,20)→(15,45) yellow
  Right trunk: line (85,20)→(85,45) yellow
  Split left top:    line (15,45)→(15,85) yellow   [left branch down]
  Split right top:   line (85,45)→(85,85) yellow   [right branch down]
  Cross top:   line (15,45)→(50,45) yellow   [left to center junction]
  Cross top R: line (50,45)→(85,45) yellow   [center junction to right] (SHARED at 50,45)
  Bulb 1: circle cx=30,cy=65,r=7 yellow + wires: line (15,55)→(23,65), line (37,65)→(50,55) — connecting to left branch
  Bulb 2: circle cx=70,cy=65,r=7 yellow + wires: line (50,55)→(63,65), line (77,65)→(85,55) — connecting to right branch
  Bottom merge: line (15,85)→(50,85) yellow, line (50,85)→(85,85) yellow
  Label texts for each bulb and battery voltage.

Two bulbs in SERIES:
  Battery top-center, bulb1 on left side, bulb2 on right side, one single loop.
  Wire: battery+ → down left → bulb1 → across bottom → bulb2 → up right → battery-

FLOOR PLANS / ROOM LAYOUTS (type: "building"):
Walls are drawn as LINES forming a closed rectangle (4 lines for 4 walls).
Do NOT use a single rect for walls — use 4 separate lines so you can leave gaps.

Wall with door opening:
  Bottom wall from (10,80)→(40,80) then GAP then (48,80)→(90,80)
  Door arc: arc cx=48,cy=80,r=8,start_angle=0,end_angle=90 (shows door swing inward)
  The gap (40→48) is the door opening width.

Wall with window:
  Left wall from (10,10)→(10,35) then WINDOW then (10,50)→(10,80)
  Window = TWO short parallel lines:
    line (8,35)→(8,50) cyan + line (12,35)→(12,50) cyan
  The main wall has a gap between y=35 and y=50 where the window sits.

Example bedroom (10% margin on all sides):
  Walls (4 lines, white, with gaps for door and window):
    Top wall:    line (10,10)→(90,10) white
    Right wall:  line (90,10)→(90,90) white
    Bottom wall: line (10,90)→(38,90) white + line (46,90)→(90,90) white  [door gap 38→46]
    Left wall:   line (10,10)→(10,35) white + line (10,55)→(10,90) white   [window gap 35→55]
  Door: arc cx=46,cy=90,r=8,start_angle=180,end_angle=270 color=cyan
  Window: line (8,35)→(8,55) cyan + line (12,35)→(12,55) cyan
  Bed: rect x=55,y=20,w=30,h=40 color=cyan label="Bed"
  Desk: rect x=15,y=20,w=20,h=12 color=cyan label="Desk"
  Wardrobe: rect x=15,y=65,w=18,h=20 color=cyan label="Wardrobe"
  Label texts: "Bedroom" at (50,5) bold white, "Door" near arc, "Window" near window lines

MECHANICAL / HARDWARE DIAGRAMS (type: "part" or "assembly"):
- Joints: circles at pivot points
- Links/arms: lines or rects connecting joints
- Fasteners: small circles for bolts/screws
- Housing: rects for enclosures
- Motion arcs: arcs showing range of movement

Always make diagrams visually clear with proper spacing, labels, and colors:
- Use color="red" for important/power/hot elements
- Use color="cyan" for structure/outlines/furniture
- Use color="yellow" for wires/connections/bulbs
- Use color="green" for annotations/values
- Use color="white" for walls/text labels
- Keep margins ~5-10% from edges
- ALWAYS add text labels for every significant element

CODING / SCRIPTING:
When the user asks you to write, create, or code a Python script/program:
- Use the run_script tool with a descriptive "name" and the full Python "code".
- The script is saved to data/code/<name>.py and executed automatically.
- The TUI will open a split-pane showing the source code and console output.
- Write COMPLETE, RUNNABLE scripts — include all imports and a proper entrypoint.
- Use print() to show output so it appears in the console.
- Keep scripts self-contained: no external files or user input required.
- If the user asks to "run" or "execute" an existing script, describe what it does.
- Add clear comments explaining what each section does.
"""


class ChatHandler:
    """Handles the chat interface with multi-agent orchestration.

    Features:
    - Intelligent routing to orchestrator for complex tasks
    - Direct LLM response for simple queries
    - Tool calling with the registered tool registry
    - Advanced memory integration
    - Text-to-Speech for response output
    - Response caching for improved performance
    """

    def __init__(
        self,
        tool_registry: ToolRegistry,
        llm: LLMProvider | None = None,
        tts_engine: TTSEngine | None = None,
        enable_tts: bool = True,
        orchestrator: OrchestratorAgent | None = None,
        memory_manager: UnifiedMemoryManager | None = None,
    ) -> None:
        self.tool_registry = tool_registry
        self._llm = llm
        self._tts = tts_engine
        self._enable_tts = enable_tts
        self._orchestrator = orchestrator
        self._memory_manager = memory_manager

        # Use advanced memory if available, otherwise basic
        if memory_manager:
            self.memory = memory_manager.conversation
        else:
            self.memory = ConversationMemory()

        # Extracted helpers
        self._tool_executor = ToolCallExecutor(self.tool_registry, logger)
        self._orchestration_router = OrchestrationRouter(self._orchestrator)
        self._orchestration_runner: OrchestrationRunner | None = (
            OrchestrationRunner(self._orchestrator, self._memory_manager, logger)
            if self._orchestrator
            else None
        )

        # Session tracking
        self._session_started = False
        self._message_count = 0

        # Track last tool results for engine integration
        self._last_tool_results: list[ToolResult] = []

        # Cache for tool schemas (frequently accessed, rarely changes)
        self._tool_schema_cache: list[dict[str, Any]] | None = None
        self._tool_schema_cache_version = 0

        # Whether to ensure a system prompt is present in history
        self._system_prompt_injected = False

    @property
    def llm(self) -> LLMProvider:
        """Lazy-load LLM provider."""
        if self._llm is None:
            from core.llm.provider_factory import LLMProviderFactory

            self._llm = LLMProviderFactory.create_with_fallback()
        return self._llm

    @property
    def tts(self) -> TTSEngine | None:
        """Lazy-load TTS engine."""
        if self._tts is None and self._enable_tts:
            try:
                from core.tts.engine import TTSEngineFactory

                self._tts = TTSEngineFactory.create_with_fallback()
            except Exception as e:
                logger.warning("Failed to initialize TTS: %s", e)
                self._enable_tts = False
        return self._tts

    def _should_use_orchestrator(self, message: str) -> bool:
        """Determine if a message should be handled by the orchestrator.

        Uses a rules-first score; if uncertain, attempts a cheap LLM classification.
        """

        # Avoid initializing an LLM unless we actually need the classifier.
        llm = self._llm
        return asyncio.run(
            self._orchestration_router.should_use_orchestrator_async(message, llm)
        )

    def start_chat(self) -> None:
        """Start the interactive chat loop."""
        logger.info("Starting JARVIS Chat")

        # Start a memory session
        if self._memory_manager:
            try:
                session = self._memory_manager.start_session(
                    name="chat_session",
                    goals=["Assist user with tasks", "Remember important information"],
                )
                self._session_started = True
                logger.info(f"Started session: {session.id}")
            except Exception as e:
                logger.warning(f"Failed to start memory session: {e}")

        print("Welcome to JARVIS! I'm your AI assistant.")
        print("I can help with coding, planning, designing, research, and more.")
        print(
            "Type 'quit' to exit, 'status' for system status, or 'help' for commands.\n"
        )
        print(
            "Tip: type '/mic' to record audio (if AUDIO_INPUT_ENABLED=true).\n"
        )

        # Announce startup with TTS
        self._speak_sync("JARVIS initialized. How can I help you?")

        while True:
            try:
                user_input = input("You: ").strip()
            except EOFError:
                logger.info("EOF received; exiting chat")
                break
            except KeyboardInterrupt:
                logger.info("Chat interrupted by user")
                print("\n")
                break

            if user_input.lower() in ("/mic", "/audio"):
                user_input = self._capture_audio_or_explain()
                if not user_input:
                    continue

            if not user_input:
                continue

            # Handle special commands
            if user_input.lower() == "quit":
                self._handle_quit()
                break
            elif user_input.lower() == "status":
                self._show_status()
                continue
            elif user_input.lower() == "help":
                self._show_help()
                continue
            elif user_input.lower() == "reflect":
                self._show_reflection()
                continue
            elif user_input.lower() == "clear":
                self._clear_context()
                continue

            # Process the message
            try:
                self._message_count += 1

                # Record in episodic memory
                if self._memory_manager:
                    self._memory_manager.record_conversation("user", user_input)

                # Process with orchestrator or direct LLM
                if self._should_use_orchestrator(user_input):
                    print("🤖 [Using multi-agent system...]")
                    response = asyncio.run(self._process_with_orchestrator(user_input))
                else:
                    response = asyncio.run(self.process_message(user_input))

                # Record response
                if self._memory_manager:
                    self._memory_manager.record_conversation("assistant", response)

            except (ValueError, KeyError) as exc:
                logger.warning("Data error while processing message: %s", exc)
                response = f"Error: Invalid data format - {exc}"
            except ConnectionError as exc:
                logger.error("Connection error while processing message: %s", exc)
                response = "Error: Unable to connect to AI service. Please check your connection."
            except (TimeoutError, OSError) as exc:
                logger.error("Timeout or OS error while processing message: %s", exc)
                response = "Error: Request timed out. Please try again."
            except Exception as exc:
                logger.exception("Unexpected error while processing message")
                response = f"Error: An unexpected error occurred - {exc}"

            print(f"\nAssistant: {response}\n")

            # Speak the response (truncate for TTS)
            tts_text = response[:500] if len(response) > 500 else response
            self._speak_sync(tts_text)

    def _handle_quit(self) -> None:
        """Handle quit command and cleanup."""
        logger.info("User quit the chat")

        # End memory session
        if self._memory_manager and self._session_started:
            try:
                self._memory_manager.end_session(
                    summary=f"Chat session with {self._message_count} messages",
                    outcomes=["Session completed normally"],
                )
                logger.info("Session ended")
            except Exception as e:
                logger.warning(f"Failed to end session: {e}")

        print("\nGoodbye! Your conversation has been saved.")
        self._speak_sync("Goodbye!")

    def _show_status(self) -> None:
        """Show system status."""
        print("\n" + "=" * 40)
        print("JARVIS System Status")
        print("=" * 40)

        # Agent status
        if self._orchestrator:
            agents = self._orchestrator.get_registered_agents()
            print(f"✓ Agents: {len(agents)} active")
            for agent in agents:
                print(f"  - {agent}")
        else:
            print("✗ Agent system: Not available")

        # Memory status
        if self._memory_manager:
            stats = self._memory_manager.get_stats()
            print("✓ Memory system: Active")
            print(f"  - Semantic memories: {stats['semantic']['total_memories']}")
            print(f"  - Episodes: {stats['episodic']['total_episodes']}")
            print(
                f"  - Conversation: {stats['conversation']['message_count']} messages"
            )
        else:
            print(f"  Basic memory: {len(self.memory.history)} messages")

        # Tools
        tools = self.tool_registry.get_all_tools()
        print(f"✓ Tools: {len(tools)} registered")

        print("=" * 40 + "\n")

    def _show_help(self) -> None:
        """Show help information."""
        print("\n" + "=" * 40)
        print("JARVIS Commands")
        print("=" * 40)
        print("  help     - Show this help message")
        print("  status   - Show system status")
        print("  reflect  - Show memory insights")
        print("  clear    - Clear conversation context")
        print("  quit     - Exit JARVIS")
        print("  /mic     - Record audio and transcribe (if enabled)")
        print("")
        print("Tips:")
        print("  - Ask me to code, plan, design, or research")
        print("  - I'll use multiple AI agents for complex tasks")
        print("  - I remember our conversation and learn")
        print("=" * 40 + "\n")

    def _show_reflection(self) -> None:
        """Show memory reflection and insights."""
        if not self._memory_manager:
            print("Memory system not available.")
            return

        print("\n" + self._memory_manager.reflect())

        insights = self._memory_manager.get_insights()
        if insights:
            print("\n## Insights")
            for insight in insights:
                print(f"- {insight}")
        print("")

    def _clear_context(self) -> None:
        """Clear conversation context."""
        self.memory.clear_history()
        if self._memory_manager:
            self._memory_manager.clear_working_memory()
        print("Context cleared.\n")

    async def _process_with_orchestrator(self, message: str) -> str:
        """Process a message using the multi-agent orchestrator."""
        if not self._orchestrator or not self._orchestration_runner:
            return await self.process_message(message)

        return await self._orchestration_runner.run(
            message,
            fallback_coro=lambda: self.process_message(message),
        )

    def _speak_sync(self, text: str) -> None:
        """Trigger TTS synchronously using thread pool executor.

        This method runs the async TTS in a thread pool to avoid blocking
        the event loop when called from synchronous code.
        """
        if not self._enable_tts or not self.tts:
            return

        try:
            # Run async speak in thread pool to avoid blocking
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(self.tts.speak(text))
            finally:
                loop.close()
        except Exception as e:
            logger.debug("TTS failed: %s", e)

    async def speak(self, text: str) -> None:
        """Speak text using TTS engine.

        Args:
            text: Text to speak.
        """
        if self.tts and self._enable_tts:
            try:
                await self.tts.speak(text)
            except Exception as e:
                logger.warning("TTS speak failed: %s", e)

    def _get_cached_tool_schemas(self) -> list[dict[str, Any]]:
        """Get tool schemas with caching for improved performance.

        Performance improvement: Tool schemas are frequently accessed but rarely change.
        Caching them reduces repeated serialization overhead.

        Returns:
            List of tool schema dictionaries.
        """
        current_version = self.tool_registry.get_version()

        # Return cached schemas if version hasn't changed
        if (
            self._tool_schema_cache is not None
            and self._tool_schema_cache_version == current_version
        ):
            return self._tool_schema_cache

        # Refresh cache
        self._tool_schema_cache = self.tool_registry.get_tool_schemas()
        self._tool_schema_cache_version = current_version
        return self._tool_schema_cache

    def _build_system_prompt(self, tools: list[dict[str, Any]]) -> str:
        """Build the system prompt, appending available tool descriptions."""
        prompt = _SYSTEM_PROMPT
        if tools:
            tool_lines = []
            for t in tools:
                fn = t.get("function", {})
                name = fn.get("name", "?")
                desc = fn.get("description", "")
                params = fn.get("parameters", {}).get("properties", {})
                param_names = ", ".join(params.keys()) if params else "(none)"
                tool_lines.append(f"  - {name}({param_names}): {desc}")
            prompt += "\nAvailable tools:\n" + "\n".join(tool_lines) + "\n"
            prompt += (
                "\nWhen you need to use a tool, output a JSON block like:\n"
                '```tool_call\n{"name": "tool_name", "arguments": {"param": "value"}}\n```\n'
            )
        return prompt

    def _ensure_system_prompt(self, history: list[dict[str, Any]], tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Ensure the system prompt is the first message in history."""
        sys_prompt = self._build_system_prompt(tools)
        # Check if first message is already a system message
        if history and history[0].get("role") == "system":
            # Update it in case tools changed
            history[0] = {"role": "system", "content": sys_prompt}
        else:
            history.insert(0, {"role": "system", "content": sys_prompt})
        return history

    @staticmethod
    def _extract_text_tool_calls(text: str) -> list[dict[str, Any]] | None:
        """Parse tool call JSON blocks from plain text LLM output.

        Looks for fenced blocks like:
            ```tool_call
            {"name": "list_blueprints", "arguments": {}}
            ```
        or inline JSON with a "name" and "arguments" key.

        Handles common LLM variations:
        - "arguments", "parameters", "params", "input" as the args key
        - OpenAI wrapper format: {"function": {"name": ..., "arguments": ...}}
        - Arguments as a JSON string instead of a dict

        Returns a list of tool_call dicts (Ollama format) or None.
        """
        calls: list[dict[str, Any]] = []

        def _extract_args(obj: dict) -> dict:
            """Pull arguments from a parsed JSON obj, trying common key names."""
            for key in ("arguments", "parameters", "params", "input"):
                val = obj.get(key)
                if val is not None:
                    if isinstance(val, dict):
                        return val
                    if isinstance(val, str):
                        try:
                            parsed = _json.loads(val)
                            if isinstance(parsed, dict):
                                return parsed
                        except (ValueError, TypeError):
                            pass
                    return {}
            return {}

        def _normalise_obj(obj: dict) -> dict | None:
            """Normalise a parsed JSON dict into ``{"function": {"name": …, "arguments": …}}``."""
            # Direct format: {"name": "tool_name", "arguments": {...}}
            if "name" in obj:
                return {
                    "function": {
                        "name": obj["name"],
                        "arguments": _extract_args(obj),
                    }
                }
            # OpenAI wrapper: {"function": {"name": ..., "arguments": ...}}
            fn = obj.get("function")
            if isinstance(fn, dict) and "name" in fn:
                return {
                    "function": {
                        "name": fn["name"],
                        "arguments": _extract_args(fn),
                    }
                }
            return None

        # Pattern 1: fenced code blocks
        for m in re.finditer(
            r"```(?:tool_call|json)?\s*\n?(\{.*?\})\s*```", text, re.DOTALL
        ):
            try:
                obj = _json.loads(m.group(1))
                if isinstance(obj, dict):
                    normalised = _normalise_obj(obj)
                    if normalised:
                        calls.append(normalised)
            except (ValueError, TypeError):
                continue

        # Pattern 2: bare JSON with tool-call shape (fallback).
        # Use brace-counting instead of regex to handle nested objects
        # (e.g. {"name":"edit_blueprint","arguments":{"drawing":{"x1":10}}}).
        if not calls:
            # Match objects starting with "name" or "function" key
            for m in re.finditer(r'\{\s*"(?:name|function|id)"\s*:', text):
                start = m.start()
                depth = 0
                in_string = False
                escape_next = False
                end = None
                for i in range(start, len(text)):
                    c = text[i]
                    if escape_next:
                        escape_next = False
                        continue
                    if c == '\\' and in_string:
                        escape_next = True
                        continue
                    if c == '"':
                        in_string = not in_string
                        continue
                    if in_string:
                        continue
                    if c == '{':
                        depth += 1
                    elif c == '}':
                        depth -= 1
                        if depth == 0:
                            end = i + 1
                            break
                if end is None:
                    continue
                try:
                    obj = _json.loads(text[start:end])
                    if isinstance(obj, dict):
                        normalised = _normalise_obj(obj)
                        if normalised:
                            calls.append(normalised)
                except (ValueError, TypeError):
                    continue

        if calls:
            logger.debug(
                "Text extraction found %d call(s), first args keys: %s",
                len(calls),
                list(calls[0].get("function", {}).get("arguments", {}).keys())[:5],
            )

        return calls if calls else None

    # Heuristic patterns that suggest tool usage might be needed
    _TOOL_HINT_RE = re.compile(
        r"\b(?:file|read|write|save|load|create|blueprints?|execute|run|shell|search"
        r"|remember|recall|forget|memory|code|script|theme|profile|stats|sync"
        r"|send|update|resolve|conflict|web|fetch|summarize|extract|list|open"
        r"|show|display|available|import"
        # Blueprint / drawing editing verbs & nouns
        r"|add|remove|delete|modify|edit|change|move|draw|place|put|set|clear"
        r"|rename|resize|rotate|connect|disconnect|reset|restore|blank|wipe"
        r"|line|circle|rect(?:angle)?|arc|text|component|connection|dimension"
        r"|color|position|label|name"
        # Creative / domain-specific triggers
        r"|schema(?:tic)?|circuit|electric(?:al|ity)?|bulb|battery|wir(?:e|ing)"
        r"|plan|floor|bedroom|room|layout|diagram|design|sketch"
        # Coding / scripting triggers
        r"|program|script|function|class|calculator"
        r"|sorter|converter|utility|bot|fibonacci|hello.?world)\b",
        re.IGNORECASE,
    )

    @staticmethod
    def _message_needs_tools(message: str) -> bool:
        """Cheaply predict whether a message is likely to need tool calling.

        Short, simple questions (e.g. "what is python") skip sending tool
        schemas to the LLM, dramatically reducing inference time on small models.
        """
        return bool(ChatHandler._TOOL_HINT_RE.search(message))

    async def process_message(
        self, message: str, *, force_tools: bool = False,
        active_blueprint_path: str | None = None,
    ) -> str:
        """Process user message and return response using AI with tool calling.

        Performance improvements:
        - Cached tool schemas to reduce repeated serialization
        - Optimized context building
        - Skip tool schemas for simple questions (huge speedup on small models)

        Args:
            message: User message to process.
            force_tools: Always include tool schemas (e.g. blueprint is open).
            active_blueprint_path: Path of the currently open blueprint file.
                When set, ``blueprint_path`` is auto-injected into
                edit_blueprint / delete_blueprint tool calls that omit it.

        Returns:
            AI response string.
        """
        start_time = time.time()
        try:
            # Only send tool schemas when the message plausibly needs them
            if force_tools or self._message_needs_tools(message):
                tools = self._get_cached_tool_schemas()
            else:
                tools = []

            self.memory.add_message("user", message)
            history = self.memory.get_history()

            # Ensure system prompt is present with tool descriptions
            history = self._ensure_system_prompt(history, tools)

            # Enhance message with memory context if available
            enhanced_message = message
            if self._memory_manager:
                context = self._memory_manager.get_context_for_prompt(300)
                if context and len(context) > 20:
                    enhanced_message = f"[Context: {context}]\n\nUser: {message}"

            try:
                llm_response = await self.llm.chat_with_tools(
                    enhanced_message, tools, history
                )
            except Exception as llm_exc:
                # Groq may reject an invalid tool-call with a 400 error.
                # Retry once without tools so the user at least gets a text
                # response rather than an opaque crash.
                err_msg = str(llm_exc)
                if "400" in err_msg or "BadRequest" in type(llm_exc).__name__:
                    logger.warning(
                        "LLM tool-call rejected by provider, retrying without tools: %s",
                        err_msg[:200],
                    )
                    llm_response = await self.llm.chat_with_tools(
                        enhanced_message, [], history
                    )
                else:
                    raise
            assistant_message = llm_response.get("message", {})

            tool_calls = assistant_message.get("tool_calls")

            # If native tool calling didn't fire, check for text-based tool calls
            if not tool_calls and tools:
                content_text = assistant_message.get("content", "")
                text_calls = self._extract_text_tool_calls(content_text)
                if text_calls:
                    tool_calls = text_calls
                    logger.info(
                        "Parsed %d text-based tool call(s) from response",
                        len(text_calls),
                    )

            if tool_calls:
                # Auto-inject blueprint_path for blueprint tools when a
                # blueprint is currently open and the LLM omitted it.
                if active_blueprint_path:
                    _BP_TOOLS = {"edit_blueprint", "delete_blueprint"}
                    for tc in tool_calls:
                        fn = tc.get("function", {})
                        if fn.get("name") in _BP_TOOLS:
                            args = fn.get("arguments")
                            if isinstance(args, str):
                                try:
                                    args = _json.loads(args)
                                except (ValueError, TypeError):
                                    args = {}
                                fn["arguments"] = args
                            if isinstance(args, dict) and not args.get("blueprint_path"):
                                args["blueprint_path"] = active_blueprint_path
                                fn["arguments"] = args

                self.memory.add_message(
                    "assistant",
                    assistant_message.get("content", ""),
                    tool_calls=tool_calls,
                )

                tool_results: list[dict[str, Any]] = []
                self._last_tool_results = []
                for tool_call in tool_calls:
                    result = self.execute_tool_call(tool_call)
                    self._last_tool_results.append(result)
                    tool_results.append(
                        {
                            "tool_call_id": tool_call.get("id", ""),
                            "content": result.to_message_content(),
                            "raw": result.to_dict(),
                        }
                    )

                # Store tool results in memory so the conversation history
                # stays valid for APIs that require tool results after
                # assistant messages with tool_calls (e.g. Groq/OpenAI).
                for tr in tool_results:
                    self.memory.add_message(
                        "tool",
                        tr["content"],
                        tool_call_id=tr["tool_call_id"],
                    )

                final_response = await self.llm.continue_conversation(
                    tool_results,
                    self.memory.get_history(),
                    tools,
                )
                self.memory.add_message("assistant", final_response)
                return final_response

            content = assistant_message.get("content")
            if content is None:
                logger.warning("LLM response missing content")
                content = ""

            self.memory.add_message("assistant", content)
            return content
        except Exception as exc:
            logger.exception("Error processing message")
            return f"Error processing message: {exc}"
        finally:
            total_time = time.time() - start_time
            logger.info("Message processing completed in %.2fs", total_time)

    def _capture_audio_or_explain(self) -> str:
        """Capture audio (if enabled) and return transcript.

        Returns empty string if capture/transcription didn't produce usable text.
        """

        from config.config import get_config

        config = get_config()
        if not config.audio_input.enabled:
            print(
                "Audio input is disabled. Set AUDIO_INPUT_ENABLED=true in .env to enable.\n"
            )
            return ""

        try:
            from core.audio_input.audio_input_manager import AudioInputManager

            manager = AudioInputManager(config.audio_input)
        except Exception as exc:
            print(f"Audio input is enabled but failed to initialize: {exc}\n")
            return ""

        print(
            f"Recording (mode={config.audio_input.mode}, max={config.audio_input.max_record_seconds}s)..."
        )
        outcome = manager.capture_and_transcribe()
        if not outcome.ok:
            print(f"Audio input error: {outcome.error}\n")
            return ""

        text = (outcome.text or "").strip()
        if not text:
            print("(No speech recognized)\n")
            return ""

        print(f"Heard: {text}\n")
        return text

    def execute_tool_call(self, tool_call: dict[str, Any]) -> ToolResult:
        """Execute a tool call from the LLM."""

        return self._tool_executor.execute_tool_call(tool_call)
