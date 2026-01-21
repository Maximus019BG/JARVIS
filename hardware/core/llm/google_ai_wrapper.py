"""Wrapper for Google AI (Gemini) using google-generativeai SDK.

Provides tool calling support with proper conversion between internal schema
and Gemini's function calling format.
"""

from __future__ import annotations

from typing import Any

from app_logging.logger import get_logger

logger = get_logger(__name__)

try:
    import google.generativeai as genai
    from google.generativeai.types import (
        FunctionDeclaration,
        Tool,
        content_types,
    )

    GOOGLE_AI_AVAILABLE = True
except ImportError:
    GOOGLE_AI_AVAILABLE = False
    genai = None  # type: ignore[assignment]
    FunctionDeclaration = None  # type: ignore[assignment, misc]
    Tool = None  # type: ignore[assignment, misc]


class GoogleAIError(Exception):
    """Raised when Google AI API encounters an error."""


class GoogleAIWrapper:
    """Wrapper for interacting with Google Gemini models.

    Supports tool calling / function calling with automatic schema conversion.
    """

    def __init__(
        self,
        api_key: str,
        model_name: str = "gemini-2.0-flash",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> None:
        if not GOOGLE_AI_AVAILABLE:
            raise ImportError(
                "google-generativeai is not installed. "
                "Install with: uv add google-generativeai"
            )

        self.model_name = model_name
        self.temperature = temperature
        self.max_tokens = max_tokens

        # Configure the SDK
        genai.configure(api_key=api_key)

        # Create the model
        self.model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=genai.types.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            ),
        )
        logger.info("GoogleAIWrapper initialized with model: %s", model_name)

    def _convert_to_gemini_tools(
        self, tools: list[dict[str, Any]]
    ) -> list[Any] | None:
        """Convert internal tool schemas to Gemini function declarations.

        Args:
            tools: List of tools in Ollama/OpenAI schema format

        Returns:
            List of Gemini Tool objects, or None if no tools
        """
        if not tools:
            return None

        function_declarations = []
        for tool in tools:
            func_def = tool.get("function", {})
            name = func_def.get("name", "")
            description = func_def.get("description", "")
            parameters = func_def.get("parameters", {})

            # Convert parameters to Gemini format
            gemini_params = self._convert_parameters(parameters)

            func_decl = FunctionDeclaration(
                name=name,
                description=description,
                parameters=gemini_params,
            )
            function_declarations.append(func_decl)

        return [Tool(function_declarations=function_declarations)]

    def _convert_parameters(self, params: dict[str, Any]) -> dict[str, Any] | None:
        """Convert JSON Schema parameters to Gemini format."""
        if not params or not params.get("properties"):
            return None

        # Gemini expects a specific format
        return {
            "type": "OBJECT",
            "properties": {
                name: self._convert_property(prop)
                for name, prop in params.get("properties", {}).items()
            },
            "required": params.get("required", []),
        }

    def _convert_property(self, prop: dict[str, Any]) -> dict[str, Any]:
        """Convert a single property to Gemini format."""
        type_mapping = {
            "string": "STRING",
            "number": "NUMBER",
            "integer": "INTEGER",
            "boolean": "BOOLEAN",
            "array": "ARRAY",
            "object": "OBJECT",
        }

        gemini_prop: dict[str, Any] = {
            "type": type_mapping.get(prop.get("type", "string"), "STRING"),
        }

        if "description" in prop:
            gemini_prop["description"] = prop["description"]
        if "enum" in prop:
            gemini_prop["enum"] = prop["enum"]

        return gemini_prop

    def _convert_history_to_gemini(
        self, history: list[dict[str, Any]]
    ) -> list[content_types.ContentType]:
        """Convert conversation history to Gemini format."""
        gemini_history = []

        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Map roles
            if role == "assistant":
                role = "model"
            elif role == "tool":
                # Tool responses need special handling
                continue  # Skip for now, handled separately

            if role in ("user", "model") and content:
                gemini_history.append({"role": role, "parts": [content]})

        return gemini_history

    def _parse_response(self, response: Any) -> dict[str, Any]:
        """Parse Gemini response to internal format."""
        result: dict[str, Any] = {"message": {}}

        if not response.candidates:
            result["message"]["content"] = ""
            return result

        candidate = response.candidates[0]
        content = candidate.content

        # Check for function calls
        tool_calls = []
        text_parts = []

        for part in content.parts:
            if hasattr(part, "function_call") and part.function_call:
                fc = part.function_call
                tool_calls.append(
                    {
                        "id": f"call_{fc.name}_{len(tool_calls)}",
                        "function": {
                            "name": fc.name,
                            "arguments": dict(fc.args) if fc.args else {},
                        },
                    }
                )
            elif hasattr(part, "text") and part.text:
                text_parts.append(part.text)

        result["message"]["content"] = "\n".join(text_parts)

        if tool_calls:
            # Convert arguments to JSON string for compatibility
            import json

            for tc in tool_calls:
                tc["function"]["arguments"] = json.dumps(tc["function"]["arguments"])
            result["message"]["tool_calls"] = tool_calls

        return result

    def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Send a message to the LLM with tool capabilities and get response.

        Args:
            message: User message
            tools: List of tool schemas in Ollama/OpenAI format
            conversation_history: Previous messages for context

        Returns:
            Dict containing response and tool calls if any
        """
        try:
            # Convert tools to Gemini format
            gemini_tools = self._convert_to_gemini_tools(tools)

            # Build history
            history = self._convert_history_to_gemini(conversation_history or [])

            # Create chat session
            chat = self.model.start_chat(history=history)

            # Send message with tools (synchronous)
            if gemini_tools:
                response = chat.send_message(
                    message,
                    tools=gemini_tools,
                )
            else:
                response = chat.send_message(message)

            return self._parse_response(response)

        except Exception as e:
            logger.exception("Error in Google AI chat")
            raise GoogleAIError(f"Google AI request failed: {e}") from e

    def continue_conversation(
        self,
        tool_results: list[dict[str, Any]],
        conversation_history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> str:
        """Continue conversation after tool execution.

        Args:
            tool_results: List of tool call results with call_id
            conversation_history: Full conversation history
            tools: Available tools

        Returns:
            Final response from LLM
        """
        try:
            # For Gemini, we need to format tool results as function responses
            from google.generativeai.types import protos

            # Build the function response parts
            function_response_parts = []
            for result in tool_results:
                # Extract function name from call_id (format: call_funcname_index)
                call_id = result.get("call_id", "")
                parts = call_id.split("_")
                func_name = parts[1] if len(parts) > 1 else "unknown"

                function_response_parts.append(
                    protos.Part(
                        function_response=protos.FunctionResponse(
                            name=func_name,
                            response={"result": result["content"]},
                        )
                    )
                )

            # Get history and create chat
            history = self._convert_history_to_gemini(conversation_history)
            gemini_tools = self._convert_to_gemini_tools(tools)

            chat = self.model.start_chat(history=history)

            # Send function responses (synchronous)
            response = chat.send_message(
                function_response_parts,
                tools=gemini_tools,
            )

            # Extract text from response
            if response.candidates:
                candidate = response.candidates[0]
                text_parts = [
                    part.text
                    for part in candidate.content.parts
                    if hasattr(part, "text") and part.text
                ]
                return "\n".join(text_parts)

            return ""

        except Exception as e:
            logger.exception("Error continuing Google AI conversation")
            raise GoogleAIError(f"Failed to continue conversation: {e}") from e
