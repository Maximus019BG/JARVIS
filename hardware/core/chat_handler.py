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
import json
import re
import time
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from core.base_tool import ToolError
from core.memory.conversation_memory import ConversationMemory
from core.tool_registry import ToolNotFoundError, ToolRegistry

if TYPE_CHECKING:
    from core.agents import OrchestratorAgent
    from core.llm.provider_factory import LLMProvider
    from core.memory import UnifiedMemoryManager
    from core.tts.engine import TTSEngine

logger = get_logger(__name__)


# Keywords that suggest complex tasks needing orchestration
ORCHESTRATION_KEYWORDS = [
    "create", "build", "implement", "develop", "design",
    "plan", "analyze", "research", "review", "improve",
    "refactor", "debug", "fix", "optimize", "write code",
    "make a", "help me", "can you", "i need", "i want",
    "blueprint", "architecture", "system", "project",
]


class ChatHandler:
    """Handles the chat interface with multi-agent orchestration.

    Features:
    - Intelligent routing to orchestrator for complex tasks
    - Direct LLM response for simple queries
    - Tool calling with the registered tool registry
    - Advanced memory integration
    - Text-to-Speech for response output
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
        
        # Session tracking
        self._session_started = False
        self._message_count = 0

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
        
        Complex tasks benefit from multi-agent orchestration.
        Simple questions can be answered directly.
        
        Args:
            message: User message.
            
        Returns:
            True if orchestrator should handle this.
        """
        if not self._orchestrator:
            return False
        
        message_lower = message.lower()
        
        # Check for orchestration keywords
        for keyword in ORCHESTRATION_KEYWORDS:
            if keyword in message_lower:
                return True
        
        # Long messages are often complex requests
        if len(message) > 200:
            return True
        
        # Messages with multiple sentences might be complex
        if message.count('.') >= 3 or message.count(',') >= 4:
            return True
        
        return False

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
        print("Type 'quit' to exit, 'status' for system status, or 'help' for commands.\n")

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
                session = self._memory_manager.end_session(
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
            print(f"✓ Memory system: Active")
            print(f"  - Semantic memories: {stats['semantic']['total_memories']}")
            print(f"  - Episodes: {stats['episodic']['total_episodes']}")
            print(f"  - Conversation: {stats['conversation']['message_count']} messages")
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
        """Process a message using the multi-agent orchestrator.
        
        Args:
            message: User message.
            
        Returns:
            Response from orchestrator.
        """
        if not self._orchestrator:
            return await self.process_message(message)
        
        start_time = time.time()
        
        try:
            # Add memory context
            context = {}
            if self._memory_manager:
                context["memory_context"] = self._memory_manager.get_context_for_prompt(500)
            
            # Orchestrate the task
            response = await self._orchestrator.orchestrate(message, context)
            
            # Record event
            if self._memory_manager:
                from core.memory import EventType
                self._memory_manager.record_event(
                    description=f"Orchestrated task: {message[:50]}...",
                    event_type=EventType.TASK_COMPLETE,
                    success=response.success,
                    importance=0.7,
                )
            
            elapsed = time.time() - start_time
            logger.info(f"Orchestration completed in {elapsed:.2f}s")
            
            # Add metadata to response
            meta = response.metadata
            if meta.get("subtasks_total"):
                footer = f"\n\n---\n📊 Completed {meta['subtasks_completed']}/{meta['subtasks_total']} subtasks"
                if meta.get("subtasks_failed"):
                    footer += f" ({meta['subtasks_failed']} failed)"
                return response.content + footer
            
            return response.content
            
        except Exception as e:
            logger.error(f"Orchestration failed: {e}")
            # Fall back to direct processing
            return await self.process_message(message)

    def _speak_sync(self, text: str) -> None:
        """Trigger TTS synchronously."""
        if not self._enable_tts or not self.tts:
            return

        try:
            # Use synchronous speak if available
            if hasattr(self.tts, 'speak_sync'):
                self.tts.speak_sync(text)
            else:
                # Fallback to async (not recommended in sync context)
                import asyncio
                asyncio.run(self.tts.speak(text))
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

    async def process_message(self, message: str) -> str:
        """Process user message and return response using AI with tool calling.
        
        Args:
            message: User message to process.
            
        Returns:
            AI response string.
        """
        start_time = time.time()
        try:
            tools = self.tool_registry.get_tool_schemas()

            self.memory.add_message("user", message)
            history = self.memory.get_history()
            
            # Enhance message with memory context if available
            enhanced_message = message
            if self._memory_manager:
                context = self._memory_manager.get_context_for_prompt(300)
                if context and len(context) > 20:
                    enhanced_message = f"[Context: {context}]\n\nUser: {message}"

            llm_response = await self.llm.chat_with_tools(enhanced_message, tools, history)
            assistant_message = llm_response.get("message", {})

            tool_calls = assistant_message.get("tool_calls")
            if tool_calls:
                self.memory.add_message(
                    "assistant",
                    assistant_message.get("content", ""),
                    tool_calls=tool_calls,
                )

                tool_results: list[dict[str, Any]] = []
                for tool_call in tool_calls:
                    result = self.execute_tool_call(tool_call)
                    tool_results.append(
                        {"content": result, "call_id": tool_call.get("id", "")}
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

    def execute_tool_call(self, tool_call: dict[str, Any]) -> str:
        """Execute a tool call from the LLM."""

        try:
            fn = tool_call.get("function") or {}
            function_name = fn.get("name")
            if not function_name:
                return "Error executing tool: missing function name"

            raw_args = fn.get("arguments", "{}")
            try:
                arguments = json.loads(raw_args) if raw_args else {}
            except json.JSONDecodeError:
                return f"Error executing tool {function_name}: invalid JSON arguments"

            if not isinstance(arguments, dict):
                return (
                    f"Error executing tool {function_name}: arguments must be an object"
                )

            tool = self.tool_registry.get_tool(function_name)
            return tool.execute(**arguments)
        except ToolNotFoundError:
            return f"Error executing tool {function_name}: unknown tool"
        except ToolError as exc:
            return f"Error executing tool {function_name}: {exc}"
        except TypeError as exc:
            # Most common failure: unexpected kwargs.
            return f"Error executing tool {function_name}: {exc}"
        except Exception as exc:
            logger.exception("Unexpected tool execution error")
            return f"Error executing tool {function_name}: {exc}"
