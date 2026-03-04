"""Tool to create new .jarvis blueprints.

Creates blueprints in the full .jarvis format with components, connections,
materials, sync/security metadata, and opens the blueprint engine for
interactive editing via the IMX500 camera gesture system.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from core.base_tool import BaseTool, ToolResult
from core.security import SecurityError, get_security_manager


def _generate_blueprint_id(name: str) -> str:
    """Generate a unique blueprint ID from the name."""
    slug = name.lower().replace(" ", "_").replace("-", "_")
    short_uuid = uuid.uuid4().hex[:6]
    return f"bp_{slug}_{short_uuid}"


def _compute_hash(data: dict[str, Any]) -> str:
    """Compute a SHA-256 content hash for change detection."""
    content_str = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(content_str.encode()).hexdigest()


class CreateBlueprintTool(BaseTool):
    """Tool for creating blueprints in .jarvis format.

    Creates a full .jarvis blueprint file with the proper schema including
    components, connections, materials, dimensions, sync/security metadata,
    and signals the TUI to open the blueprint engine for interactive editing.
    """

    @property
    def name(self) -> str:
        return "create_blueprint"

    @property
    def description(self) -> str:
        return (
            "Creates a new .jarvis blueprint with the given name and optional "
            "type (part, assembly, building, system, circuit, mechanism). "
            "Opens the blueprint engine grid for interactive drawing via the "
            "IMX500 camera gesture system."
        )

    def execute(
        self,
        blueprint_name: str = "",
        blueprint_type: str = "part",
        description: str = "",
        dimensions: dict[str, Any] | None = None,
        materials: list[dict[str, Any]] | None = None,
        components: list[dict[str, Any]] | None = None,
        connections: list[dict[str, Any]] | None = None,
        lines: list[dict[str, Any]] | None = None,
        circles: list[dict[str, Any]] | None = None,
        rects: list[dict[str, Any]] | None = None,
        arcs: list[dict[str, Any]] | None = None,
        texts: list[dict[str, Any]] | None = None,
        notes: list[str] | None = None,
        tags: list[str] | None = None,
    ) -> ToolResult:
        name = blueprint_name.strip()
        if not name:
            return ToolResult.fail(
                "Please specify a blueprint name to create.",
                error_type="ValidationError",
            )

        valid_types = {"part", "assembly", "building", "system", "circuit", "mechanism"}
        bp_type = blueprint_type.lower().strip()
        if bp_type not in valid_types:
            bp_type = "part"

        now = datetime.now().isoformat() + "Z"
        bp_id = _generate_blueprint_id(name)

        # Build the full .jarvis structure
        data: dict[str, Any] = {
            "jarvis_version": "1.0",
            "id": bp_id,
            "type": bp_type,
            "name": name,
            "description": description or f"New {bp_type} blueprint",
            "created": now,
            "author": "JARVIS Blueprint Agent",
            "version": 1,
            "hash": "",
            "sync": {
                "status": "local_only",
                "lastSyncedAt": None,
                "serverVersion": None,
                "conflictState": None,
                "workstationId": None,
                "deviceId": None,
            },
            "security": {
                "classification": "internal",
                "accessLevel": "read_write",
                "allowedDevices": [],
                "signatureRequired": True,
                "signature": None,
                "signedBy": None,
                "signedAt": None,
                "integrityVerified": False,
                "encryptionEnabled": False,
                "encryptionAlgorithm": None,
            },
            "dimensions": dimensions or {
                "length": 0,
                "width": 0,
                "height": 0,
                "unit": "mm",
            },
            "materials": materials or [],
            "components": components or [],
            "connections": connections or [],
            "lines": lines or [],
            "circles": circles or [],
            "rects": rects or [],
            "arcs": arcs or [],
            "texts": texts or [],
            "specifications": {},
            "manufacturing": {},
            "assembly_instructions": [],
            "notes": notes or [],
            "tags": tags or [],
            "revisions": [
                {
                    "version": "1.0",
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "changes": "Initial design",
                }
            ],
        }

        # Compute and set the content hash
        data["hash"] = _compute_hash(data)

        security = get_security_manager()
        safe_name = security.sanitize_filename(name)
        # Strip .jarvis suffix if the LLM included it in the name
        if safe_name.lower().endswith(".jarvis"):
            safe_name = safe_name[:-7]
        intended_path = Path("data") / "blueprints" / f"{safe_name}.jarvis"

        try:
            validated_path = security.validate_file_access(intended_path)
            validated_path.parent.mkdir(parents=True, exist_ok=True)
            validated_path.write_text(
                json.dumps(data, indent=2, default=str), encoding="utf-8"
            )

            return ToolResult.ok_result(
                f"Blueprint '{safe_name}' created successfully as .jarvis file. "
                f"Opening blueprint engine for interactive editing.",
                blueprint_path=str(validated_path),
                blueprint_id=bp_id,
                blueprint_name=name,
                open_engine=True,
            )
        except SecurityError as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{safe_name}': {exc}",
                error_type="AccessDenied",
            )
        except PermissionError as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{safe_name}': Permission denied - {exc}",
                error_type="AccessDenied",
            )
        except OSError as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{safe_name}': File system error - {exc}",
                error_type="OSError",
            )
        except (TypeError, ValueError) as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{safe_name}': Invalid data format - {exc}",
                error_type="ValidationError",
            )
        except Exception as exc:
            return ToolResult.fail(
                f"Failed to create blueprint '{safe_name}': Unexpected error - {exc}",
                error_type="Exception",
            )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "blueprint_name": {
                    "type": "string",
                    "description": "The name of the blueprint to create",
                },
                "blueprint_type": {
                    "type": "string",
                    "enum": [
                        "part", "assembly", "building",
                        "system", "circuit", "mechanism",
                    ],
                    "description": "Type of blueprint (default: part)",
                },
                "description": {
                    "type": "string",
                    "description": "Description of the blueprint",
                },
                "dimensions": {
                    "type": "object",
                    "description": "Overall dimensions with length, width, height, unit",
                },
                "materials": {
                    "type": "array",
                    "description": "List of materials used in the blueprint",
                    "items": {"type": "object"},
                },
                "components": {
                    "type": "array",
                    "description": "List of components in the blueprint",
                    "items": {"type": "object"},
                },
                "connections": {
                    "type": "array",
                    "description": "List of connections between components",
                    "items": {"type": "object"},
                },
                "lines": {
                    "type": "array",
                    "description": "Drawing lines (percentage coords 0-100): [{x1, y1, x2, y2, color, style, label}]",
                    "items": {"type": "object"},
                },
                "circles": {
                    "type": "array",
                    "description": "Drawing circles (percentage coords 0-100): [{cx, cy, r, color, fill, label}]",
                    "items": {"type": "object"},
                },
                "rects": {
                    "type": "array",
                    "description": "Drawing rectangles (percentage coords 0-100): [{x, y, w, h, color, fill, label}]",
                    "items": {"type": "object"},
                },
                "arcs": {
                    "type": "array",
                    "description": "Drawing arcs (percentage coords 0-100): [{cx, cy, r, start_angle, end_angle, color, label}]",
                    "items": {"type": "object"},
                },
                "texts": {
                    "type": "array",
                    "description": "Drawing text labels (percentage coords 0-100): [{x, y, text, color, bold}]",
                    "items": {"type": "object"},
                },
                "notes": {
                    "type": "array",
                    "description": "Design notes",
                    "items": {"type": "string"},
                },
                "tags": {
                    "type": "array",
                    "description": "Searchable tags",
                    "items": {"type": "string"},
                },
            },
            "required": ["blueprint_name"],
        }
