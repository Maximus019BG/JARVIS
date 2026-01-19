"""Chat handler for managing user interactions and tool calls."""

import json
import logging
import time
from typing import Any, Dict, List

from .llm.llama_wrapper import LlamaWrapper
from .memory.conversation_memory import ConversationMemory
from .tool_registry import ToolRegistry

try:
    from ..app_logging.logger import logger
except ImportError:
    import logging
    logger = logging.getLogger("hardware_app")


class ChatHandler:
    """Handles the chat interface and AI interactions."""

    def __init__(self, tool_registry: ToolRegistry, llm=None):
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
                if user_input.lower() == 'quit':
                    logger.info("User quit the chat")
                    break
                logger.info(f"Processing user message: {user_input[:50]}...")
                response = self.process_message(user_input)
                print(f"Assistant: {response}")
            except KeyboardInterrupt:
                logger.info("Chat interrupted by user")
                break
            except Exception as e:
                logger.error(f"Error in chat loop: {e}")
                print(f"Error: {e}")

    def process_message(self, message: str) -> str:
        """Process user message and return response using AI with tool calling."""
        start_time = time.time()
        logger.debug(f"Processing message: {message}")

        try:
            # Get tool schemas
            tools = self.tool_registry.get_tool_schemas()
            logger.debug(f"Available tools: {[t['function']['name'] for t in tools]}")

            # Add user message to memory
            self.memory.add_message("user", message)

            # Get conversation history
            history = self.memory.get_history()

            # Call LLM with tools
            llm_start = time.time()
            logger.debug("Calling LLM with tools")
            llm_response = self.llm.chat_with_tools(message, tools, history)
            llm_time = time.time() - llm_start
            logger.debug(f"LLM call took {llm_time:.2f}s")

            # Handle response
            assistant_message = llm_response["message"]
            if "tool_calls" in assistant_message:
                logger.info(f"LLM requested {len(assistant_message['tool_calls'])} tool calls")
                # Add assistant message with tool calls to memory
                self.memory.add_message("assistant", assistant_message.get("content", ""), tool_calls=assistant_message["tool_calls"])

                # Execute tool calls
                tool_results = []
                tool_start = time.time()
                for tool_call in assistant_message["tool_calls"]:
                    logger.debug(f"Executing tool: {tool_call['function']['name']}")
                    result = self.execute_tool_call(tool_call)
                    tool_results.append({
                        "content": result,
                        "call_id": tool_call["id"]
                    })
                tool_time = time.time() - tool_start
                logger.debug(f"Tool execution took {tool_time:.2f}s")

                # Get final response after tool execution
                logger.debug("Getting final response after tool execution")
                final_response = self.llm.continue_conversation(tool_results, self.memory.get_history(), tools)
                self.memory.add_message("assistant", final_response)
                return final_response
            else:
                # No tool call, direct response
                content = assistant_message["content"]
                logger.debug("Direct response from LLM")
                self.memory.add_message("assistant", content)
                return content
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            return f"Error processing message: {e}"
        finally:
            total_time = time.time() - start_time
            logger.info(f"Message processing completed in {total_time:.2f}s")

    def execute_tool_call(self, tool_call: Dict[str, Any]) -> str:
        """Execute a tool call from the LLM."""
        function_name = tool_call["function"]["name"]
        arguments = json.loads(tool_call["function"]["arguments"])

        try:
            tool = self.tool_registry.get_tool(function_name)
            result = tool.execute(**arguments)
            return result
        except Exception as e:
            return f"Error executing tool {function_name}: {e}"
