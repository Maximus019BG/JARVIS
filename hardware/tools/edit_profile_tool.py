"""Tool to edit user profile."""

from __future__ import annotations

# Local application imports
from core.base_tool import BaseTool, ToolResult
from core.data_utils import load_profile, save_profile
from core.utils import is_valid_email


class EditProfileTool(BaseTool):
    """Tool for editing user profile."""

    @property
    def name(self) -> str:
        return "edit_profile"

    @property
    def description(self) -> str:
        return "Updates user profile information."

    def execute(self, name: str = "", email: str = "") -> ToolResult:
        if not name and not email:
            return ToolResult.fail(
                "Please provide name or email to update.",
                error_type="ValidationError",
            )

        # Load current profile
        current_profile = load_profile()

        # Validate email if provided
        if email and not is_valid_email(email):
            return ToolResult.fail(
                "Invalid email format. Please provide a valid email address.",
                error_type="ValidationError",
            )

        # Update profile
        updated_profile = current_profile.copy()
        if name:
            updated_profile["name"] = name
        if email:
            updated_profile["email"] = email

        # Save profile
        save_profile(updated_profile)

        return ToolResult.ok_result(
            f"Profile updated and saved: Name '{name or 'unchanged'}', Email '{email or 'unchanged'}'."
        )

    def schema_parameters(self) -> dict[str, object]:
        return {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "User's name"},
                "email": {"type": "string", "description": "User's email address"},
            },
            "required": [],
            "additionalProperties": False,
        }
