"""Base class for all AI agents.

Agents are specialized LLM wrappers with specific system prompts and behaviors.
They can be orchestrated together to accomplish complex tasks.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from config.config import get_config
from core.llm.provider_factory import LLMProviderFactory

if TYPE_CHECKING:
    from core.llm.provider_factory import LLMProvider

logger = get_logger(__name__)


class AgentRole(str, Enum):
    """Defines the role/specialty of an agent."""

    ORCHESTRATOR = "orchestrator"
    CODER = "coder"
    PLANNER = "planner"
    BLUEPRINT = "blueprint"
    CRITIC = "critic"
    RESEARCHER = "researcher"
    MEMORY = "memory"


@dataclass
class AgentMessage:
    """A message in an agent conversation."""

    role: str  # "user", "assistant", "system"
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentResponse:
    """Response from an agent."""

    content: str
    agent_role: AgentRole
    success: bool = True
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    """Abstract base class for all agents.

    Each agent has a specific role and system prompt that defines its behavior.
    Agents use Ollama LLMs to generate responses.
    """

    def __init__(
        self,
        model_name: str | None = None,
        temperature: float = 0.7,
    ):
        """Initialize the agent.

        Args:
            model_name: Ollama model to use. Defaults to config value.
            temperature: Creativity level (0.0-1.0).
        """
        self.model_name = model_name
        self.temperature = temperature
        self._llm: LLMProvider | None = None
        self._conversation_history: list[dict[str, Any]] = []

        # Load conversation history limits from config
        config = get_config()
        self._max_history_size = getattr(config, "conversation_max_messages", 50)
        self._recent_messages_count = getattr(
            config, "conversation_recent_messages", 10
        )

    @property
    def llm(self) -> LLMProvider:
        """Lazy-load the LLM provider."""
        if self._llm is None:
            from config.config import AIConfig

            config = AIConfig()
            if self.model_name:
                config.ollama_model = self.model_name
            self._llm = LLMProviderFactory.create(config)
        return self._llm

    @property
    @abstractmethod
    def role(self) -> AgentRole:
        """The role of this agent."""

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """The system prompt that defines this agent's behavior."""

    @property
    def name(self) -> str:
        """Human-readable name for the agent."""
        return f"{self.role.value.title()} Agent"

    def _build_messages(
        self,
        user_input: str,
        context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Build the message list for the LLM.

        Args:
            user_input: The user's input/task.
            context: Optional context from other agents or previous work.

        Returns:
            List of messages for the LLM.
        """
        messages = [{"role": "system", "content": self.system_prompt}]

        # Add conversation history
        messages.extend(self._conversation_history)

        # Add context if provided
        if context:
            context_str = "\n".join(f"- {k}: {v}" for k, v in context.items())
            messages.append(
                {
                    "role": "user",
                    "content": f"Context from previous work:\n{context_str}",
                }
            )

        # Add current user input
        messages.append({"role": "user", "content": user_input})

        return messages

    def _prune_conversation_history(self) -> None:
        """Prune conversation history to prevent unbounded growth.

        Performance improvement: Keeps conversation history bounded to prevent
        memory issues and reduce token usage in subsequent requests.

        Strategy:
        1. Keep the most recent N messages (configurable)
        2. Summarize older messages if they exist
        3. Replace older messages with a summary to preserve context
        """
        if len(self._conversation_history) <= self._max_history_size:
            return

        # Calculate how many messages to keep as recent
        recent_count = min(self._recent_messages_count, self._max_history_size)

        # Get older messages that need to be summarized
        older_messages = self._conversation_history[:-recent_count]

        if older_messages:
            # Create a summary of older messages
            summary_parts = []
            for msg in older_messages:
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                # Truncate long content for summary
                if len(content) > 100:
                    content = content[:97] + "..."
                summary_parts.append(f"{role}: {content}")

            summary = (
                "[Previous conversation summary: " + " | ".join(summary_parts) + "]"
            )

            # Replace older messages with a single summary message
            self._conversation_history = [
                {"role": "system", "content": summary}
            ] + self._conversation_history[-recent_count:]

            logger.debug(
                f"[{self.name}] Pruned conversation history: "
                f"{len(older_messages)} messages summarized"
            )

    async def process(
        self,
        task: str,
        context: dict[str, Any] | None = None,
    ) -> AgentResponse:
        """Process a task and return a response.

        Args:
            task: The task or input to process.
            context: Optional context from other agents.

        Returns:
            AgentResponse with the result.
        """
        try:
            messages = self._build_messages(task, context)

            # Call the LLM
            response = await self.llm.chat_with_tools(
                message=task,
                tools=[],
                conversation_history=messages[:-1],  # Exclude last message
            )

            content = response.get("message", {}).get("content", "")

            # Store in history
            self._conversation_history.append({"role": "user", "content": task})
            self._conversation_history.append({"role": "assistant", "content": content})

            # Prune conversation history to prevent unbounded growth
            self._prune_conversation_history()

            logger.info(f"[{self.name}] Processed task successfully")

            return AgentResponse(
                content=content,
                agent_role=self.role,
                success=True,
                metadata={"model": self.model_name},
            )

        except Exception as e:
            logger.error(f"[{self.name}] Error processing task: {e}")
            return AgentResponse(
                content="",
                agent_role=self.role,
                success=False,
                error=str(e),
            )

    def clear_history(self) -> None:
        """Clear the conversation history."""
        self._conversation_history = []

    def get_history(self) -> list[dict[str, Any]]:
        """Get the conversation history."""
        return self._conversation_history.copy()

    def get_history_size(self) -> int:
        """Get the current size of the conversation history."""
        return len(self._conversation_history)

    def set_history_limit(self, max_size: int, recent_count: int) -> None:
        """Set the conversation history limits.

        Args:
            max_size: Maximum number of messages to keep in history.
            recent_count: Number of recent messages to keep without summarizing.
        """
        self._max_history_size = max_size
        self._recent_messages_count = recent_count
        logger.info(
            f"[{self.name}] History limits updated: max={max_size}, recent={recent_count}"
        )
