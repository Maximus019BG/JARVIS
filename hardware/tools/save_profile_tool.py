"""Tool to save user profile."""

import re
from typing import Dict

from core.base_tool import BaseTool
from core.data_utils import save_profile


def is_valid_email(email: str) -> bool:
    """Basic email validation."""
    return bool(re.match(r'^[^@]+@[^@]+\.[^@]+$', email))


class SaveProfileTool(BaseTool):
    """Tool for saving user profile."""

    @property
    def name(self) -> str:
        return "save_profile"

    @property
    def description(self) -> str:
        return "Saves the user profile information."

    def execute(self, name: str = "", email: str = "") -> str:
        # Validate inputs
        if name and not name.strip():
            return "Name cannot be empty."
        if email and not is_valid_email(email):
            return "Invalid email format. Please provide a valid email address."

        # Save profile
        profile = {"name": name.strip() if name else "", "email": email.strip() if email else ""}
        save_profile(profile)

        return "Profile saved successfully."

    def get_schema(self) -> Dict:
        schema = super().get_schema()
        schema["function"]["parameters"]["properties"] = {
            "name": {
                "type": "string",
                "description": "User's name"
            },
            "email": {
                "type": "string",
                "description": "User's email address"
            }
        }
        schema["function"]["parameters"]["required"] = []
        return schema
