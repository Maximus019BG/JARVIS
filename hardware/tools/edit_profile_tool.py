"""Tool to edit user profile."""

import re
from typing import Dict

from core.base_tool import BaseTool
from core.data_utils import load_profile, save_profile


def is_valid_email(email: str) -> bool:
    """Basic email validation."""
    return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", email))


class EditProfileTool(BaseTool):
    """Tool for editing user profile."""

    @property
    def name(self) -> str:
        return "edit_profile"

    @property
    def description(self) -> str:
        return "Updates user profile information."

    def execute(self, name: str = "", email: str = "") -> str:
        if not name and not email:
            return "Please provide name or email to update."

        # Load current profile
        current_profile = load_profile()

        # Validate email if provided
        if email and not is_valid_email(email):
            return "Invalid email format. Please provide a valid email address."

        # Update profile
        updated_profile = current_profile.copy()
        if name:
            updated_profile["name"] = name
        if email:
            updated_profile["email"] = email

        # Save profile
        save_profile(updated_profile)

        return f"Profile updated and saved: Name '{name or 'unchanged'}', Email '{email or 'unchanged'}'."

    def get_schema(self) -> Dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "name": {"type": "string", "description": "User's name"},
            "email": {"type": "string", "description": "User's email address"},
        }
        schema["function"]["parameters"]["required"] = []
        return schema
