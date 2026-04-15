"""Tool to configure LLM settings."""

from __future__ import annotations

from core.base_tool import BaseTool, ToolResult
from core.data_utils import load_llm_config, save_llm_config


class ConfigureLLMTool(BaseTool):
    """Tool for configuring LLM API settings."""

    AVAILABLE_MODELS = [
        "kimi-k2.5",              # Latest multimodal model (recommended)
        "kimi-k2-turbo-preview",  # Fast turbo model
        "kimi-k2-thinking",       # Reasoning/thinking model
        "moonshot-v1-auto",       # Auto-select context length
        "moonshot-v1-8k",         # Legacy 8K context
        "moonshot-v1-32k",        # Legacy 32K context
        "moonshot-v1-128k",       # Legacy 128K context
    ]

    @property
    def name(self) -> str:
        return "configure_llm"

    @property
    def description(self) -> str:
        return (
            "Configure LLM API settings (API key, model, base URL). "
            "Changes take effect on next restart."
        )

    def execute(
        self,
        api_key: str = "",
        model: str = "",
        base_url: str = "",
    ) -> ToolResult:
        """Configure LLM settings.

        Only updates fields explicitly provided (non-empty).
        """
        api_key = api_key.strip() if api_key else ""
        model = model.strip() if model else ""
        base_url = base_url.strip() if base_url else ""

        if not api_key and not model and not base_url:
            # Show current config (masked API key)
            current = load_llm_config()
            if len(current["api_key"]) > 4:
                masked_key = "***" + current["api_key"][-4:]
            else:
                masked_key = "(not set)"
            return ToolResult.ok_result(
                f"Current LLM config: model={current['model']}, "
                f"api_key={masked_key}, base_url={current['base_url']}"
            )

        # Validate model if provided
        if model and model not in self.AVAILABLE_MODELS:
            return ToolResult.fail(
                f"Invalid model. Available: {', '.join(self.AVAILABLE_MODELS)}",
                error_type="ValidationError",
            )

        # Validate URL if provided
        if base_url and not base_url.startswith(("http://", "https://")):
            return ToolResult.fail(
                "Base URL must start with http:// or https://",
                error_type="ValidationError",
            )

        # Load and update
        current = load_llm_config()
        if api_key:
            current["api_key"] = api_key
        if model:
            current["model"] = model
        if base_url:
            current["base_url"] = base_url

        save_llm_config(current)

        updates = []
        if api_key:
            updates.append("api_key=***")
        if model:
            updates.append(f"model={model}")
        if base_url:
            updates.append(f"base_url={base_url}")

        return ToolResult.ok_result(
            f"LLM config updated: {', '.join(updates)}. Restart to apply changes."
        )

    def schema_parameters(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "api_key": {
                    "type": "string",
                    "description": (
                        "Moonshot API key. "
                        "Get from https://platform.moonshot.cn/console/api-keys"
                    ),
                },
                "model": {
                    "type": "string",
                    "enum": self.AVAILABLE_MODELS,
                    "description": (
                        "Model to use: moonshot-v1-8k (8K), "
                        "moonshot-v1-32k (32K), moonshot-v1-128k (128K)"
                    ),
                },
                "base_url": {
                    "type": "string",
                    "description": (
                        "Custom API base URL (for proxies). "
                        "Default: https://api.moonshot.cn/v1"
                    ),
                },
            },
            "required": [],
            "additionalProperties": False,
        }
