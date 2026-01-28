"""Tool to save user profile."""

from __future__ import annotations

# Local application imports
from core.base_tool import BaseTool, ToolResult
from core.data_utils import save_profile
from core.utils import is_valid_email


class SaveProfileTool(BaseTool):
    """Tool for saving user profile."""

    @property
    def name(self) -> str:
        return "save_profile"

    @property
    def description(self) -> str:
        return "Saves the user profile information."

    def execute(self, name: str = "", email: str = "") -> ToolResult:
        # Validate inputs
        if name and not name.strip():
            return ToolResult.fail("Name cannot be empty.", error_type="ValidationError")
        if email and not is_valid_email(email):
            return ToolResult.fail(
                "Invalid email format. Please provide a valid email address.",
                error_type="ValidationError",
            )

        # Save profile
        profile = {
            "name": name.strip() if name else "",
            "email": email.strip() if email else "",
        }
        save_profile(profile)

        return ToolResult.ok_result("Profile saved successfully.")

    def get_schema(self) -> dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "name": {"type": "string", "description": "User's name"},
            "email": {"type": "string", "description": "User's email address"},
        }
        schema["function"]["parameters"]["required"] = []
        return schema
