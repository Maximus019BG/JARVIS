"""Chat handler for managing user interactions and tool calls."""

from __future__ import annotations

import json
import time
from typing import Any

from hardware.app_logging.logger import get_logger
from hardware.core.base_tool import ToolError
from hardware.core.llm.llama_wrapper import LlamaWrapper
from hardware.core.memory.conversation_memory import ConversationMemory
from hardware.core.tool_registry import ToolNotFoundError, ToolRegistry

logger = get_logger(__name__)


class ChatHandler:
    """Handles the chat interface and AI interactions."""

    def __init__(self, tool_registry: ToolRegistry, llm: Any | None = None) -> None:
        self.tool_registry = tool_registry
        self.llm = llm or LlamaWrapper()
        self.memory = ConversationMemory()

    def start_chat(self) -> None:
        """Start the chat loop."""

        logger.info("Starting Hardware Control Chat")
        print("Welcome to Hardware Control Chat! Type 'quit' to exit.")

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
                break

            try:
                response = self.process_message(user_input)
            except Exception:
                logger.exception("Unhandled error while processing message")
                response = "Error: unhandled exception while processing message."

            print(f"Assistant: {response}")

    def process_message(self, message: str) -> str:
        """Process user message and return response using AI with tool calling."""

        start_time = time.time()
        try:
            tools = self.tool_registry.get_tool_schemas()

            self.memory.add_message("user", message)
            history = self.memory.get_history()

            llm_response = self.llm.chat_with_tools(message, tools, history)
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

                final_response = self.llm.continue_conversation(
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
