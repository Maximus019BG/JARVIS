"""Tool to save user profile."""

from __future__ import annotations

# Local application imports
from core.base_tool import BaseTool, ToolResult
from core.data_utils import load_profile, save_profile
from core.utils import is_valid_email


class SaveProfileTool(BaseTool):
    """Tool for saving user profile."""

    @property
    def name(self) -> str:
        return "save_profile"

    @property
    def description(self) -> str:
        return "Saves user profile information."

    def execute(
        self,
        name: str = "",
        email: str = "",
        clear_name: bool = False,
        clear_email: bool = False,
    ) -> ToolResult:
        """Save user profile information.

        This tool merges with the existing saved profile.

        - Fields are only updated when explicitly provided (non-empty after trimming).
        - Fields can be explicitly wiped via the clear flags.
        """

        # Validate inputs
        normalized_name = name.strip() if name else ""
        normalized_email = email.strip() if email else ""

        if name and not normalized_name:
            return ToolResult.fail(
                "Name cannot be empty.", error_type="ValidationError"
            )
        if normalized_email and not is_valid_email(normalized_email):
            return ToolResult.fail(
                "Invalid email format. Please provide a valid email address.",
                error_type="ValidationError",
            )

        # Load existing profile and merge
        try:
            current_profile = load_profile() or {}
        except Exception:
            # Be conservative: if loading fails, treat as empty profile.
            current_profile = {}

        updated_profile = dict(current_profile)

        if clear_name:
            updated_profile["name"] = ""
        elif normalized_name:
            updated_profile["name"] = normalized_name

        if clear_email:
            updated_profile["email"] = ""
        elif normalized_email:
            updated_profile["email"] = normalized_email

        save_profile(updated_profile)

        return ToolResult.ok_result("Profile saved successfully.")

    def schema_parameters(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "User name (trimmed). Omit to keep existing.",
                },
                "email": {
                    "type": "string",
                    "description": "User email address (trimmed). Omit to keep existing.",
                },
                "clear_name": {
                    "type": "boolean",
                    "description": "If true, clears the stored name (overrides provided name).",
                },
                "clear_email": {
                    "type": "boolean",
                    "description": "If true, clears the stored email (overrides provided email).",
                },
            },
            "required": [],
            "additionalProperties": False,
        }
