"""Chat handler for managing user interactions and tool calls.

Supports:
- Multiple LLM providers (Google AI, Ollama)
- Tool calling with automatic execution
- Text-to-Speech output
- Conversation memory
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from core.base_tool import ToolError
from core.memory.conversation_memory import ConversationMemory
from core.tool_registry import ToolNotFoundError, ToolRegistry

if TYPE_CHECKING:
    from core.llm.provider_factory import LLMProvider
    from core.tts.engine import TTSEngine

logger = get_logger(__name__)


class ChatHandler:
    """Handles the chat interface and AI interactions.

    Supports:
    - Multiple LLM providers via dependency injection
    - Text-to-Speech for response output
    - Tool calling with the registered tool registry
    """

    def __init__(
        self,
        tool_registry: ToolRegistry,
        llm: LLMProvider | None = None,
        tts_engine: TTSEngine | None = None,
        enable_tts: bool = True,
    ) -> None:
        self.tool_registry = tool_registry
        self._llm = llm
        self._tts = tts_engine
        self._enable_tts = enable_tts
        self.memory = ConversationMemory()

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

    def start_chat(self) -> None:
        """Start the chat loop."""
        logger.info("Starting Hardware Control Chat")
        print("Welcome to Hardware Control Chat! Type 'quit' to exit.")

        # Announce startup with TTS
        self._speak_sync("Hardware Control Chat initialized. How can I help you?")

        while True:
            try:
                user_input = input("You: ")
            except EOFError:
                logger.info("EOF received; exiting chat")
                break
            except KeyboardInterrupt:
                logger.info("Chat interrupted by user")
                break

            if user_input.strip().lower() == "quit":
                logger.info("User quit the chat")
                self._speak_async("Goodbye!")
                break

            try:
                response = asyncio.run(self.process_message(user_input))
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
                response = "Error: An unexpected error occurred. Please try again."

            print(f"Assistant: {response}")

            # Speak the response
            self._speak_sync(response)

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
        """Process user message and return response using AI with tool calling."""
        start_time = time.time()
        try:
            tools = self.tool_registry.get_tool_schemas()

            self.memory.add_message("user", message)
            history = self.memory.get_history()

            llm_response = await self.llm.chat_with_tools(message, tools, history)
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
