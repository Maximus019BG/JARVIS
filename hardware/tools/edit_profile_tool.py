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
        return "Updates user profile information (merge, no implicit wiping)."

    def execute(self, name: str = "", email: str = "") -> ToolResult:
        """Edit user profile fields.

        Only updates fields explicitly provided (non-empty after trimming).
        """

        normalized_name = name.strip() if name else ""
        normalized_email = email.strip() if email else ""

        if name and not normalized_name and email and not normalized_email:
            # Both provided but only whitespace -> treat as not provided.
            return ToolResult.fail(
                "Please provide name or email to update.",
                error_type="ValidationError",
            )

        if not normalized_name and not normalized_email:
            return ToolResult.fail(
                "Please provide name or email to update.",
                error_type="ValidationError",
            )

        # Load current profile
        current_profile = load_profile()

        # Validate email if provided
        if normalized_email and not is_valid_email(normalized_email):
            return ToolResult.fail(
                "Invalid email format. Please provide a valid email address.",
                error_type="ValidationError",
            )

        # Update profile
        updated_profile = current_profile.copy()
        if normalized_name:
            updated_profile["name"] = normalized_name
        if normalized_email:
            updated_profile["email"] = normalized_email

        # Save profile
        save_profile(updated_profile)

        return ToolResult.ok_result(
            "Profile updated and saved: "
            f"name={normalized_name or 'unchanged'}, "
            f"email={normalized_email or 'unchanged'}."
        )

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
            },
            "required": [],
            "additionalProperties": False,
        }
