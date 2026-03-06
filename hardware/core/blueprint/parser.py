"""Parser and validator for .jarvis blueprint files.

Provides complete parsing, validation, and serialization of blueprint files.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator


class BlueprintType(str, Enum):
    """Types of blueprints that can be created."""

    PART = "part"  # Individual component/part
    ASSEMBLY = "assembly"  # Collection of parts
    BUILDING = "building"  # Structure/building design
    SYSTEM = "system"  # System architecture
    CIRCUIT = "circuit"  # Electrical circuit
    MECHANISM = "mechanism"  # Mechanical mechanism


class Dimension(BaseModel):
    """Dimension specification with length, width, height."""

    length: float = Field(ge=0, description="Length in specified unit")
    width: float = Field(ge=0, description="Width in specified unit")
    height: float = Field(default=0, ge=0, description="Height in specified unit")
    unit: str = Field(default="mm", description="Unit of measurement")

    @field_validator("unit")
    @classmethod
    def validate_unit(cls, v: str) -> str:
        """Validate unit is a known measurement unit."""
        valid_units = {"mm", "cm", "m", "in", "ft", "px"}
        if v.lower() not in valid_units:
            raise ValueError(f"Invalid unit: {v}. Must be one of {valid_units}")
        return v.lower()


class Material(BaseModel):
    """Material specification for a component."""

    name: str = Field(min_length=1, description="Material name")
    type: str = Field(default="generic", description="Material category")
    properties: dict[str, Any] = Field(
        default_factory=dict, description="Material properties"
    )


class ComponentSpec(BaseModel):
    """Specification for a blueprint component."""

    id: str = Field(min_length=1, description="Unique component ID")
    name: str = Field(min_length=1, description="Component name")
    type: str = Field(default="generic", description="Component type")
    quantity: int = Field(default=1, ge=1, description="Number of instances")
    dimensions: Dimension | None = Field(
        default=None, description="Component dimensions"
    )
    material: Material | None = Field(default=None, description="Component material")
    position: tuple[float, float, float] = Field(
        default=(0.0, 0.0, 0.0), description="Position (x, y, z)"
    )
    rotation: tuple[float, float, float] = Field(
        default=(0.0, 0.0, 0.0), description="Rotation in degrees (rx, ry, rz)"
    )
    specifications: dict[str, Any] = Field(
        default_factory=dict, description="Additional specifications"
    )
    children: list[str] = Field(
        default_factory=list, description="Child component IDs"
    )

    @field_validator("position", "rotation", mode="before")
    @classmethod
    def _coerce_xyz(cls, v: Any) -> tuple[float, float, float]:
        """Accept both tuple/list and {x, y, z} dict formats.

        Also pads 2-element lists/tuples with a 0.0 z-component so that
        LLMs generating 2D layouts (circuits, floor plans) don't break.
        """
        if isinstance(v, dict):
            return (
                float(v.get("x", 0.0)),
                float(v.get("y", 0.0)),
                float(v.get("z", 0.0)),
            )
        if isinstance(v, (list, tuple)) and len(v) == 2:
            return (float(v[0]), float(v[1]), 0.0)
        return v


class ConnectionType(str, Enum):
    """Types of connections between components."""

    BOLT = "bolt"
    WELD = "weld"
    GLUE = "glue"
    SNAP = "snap"
    PRESS_FIT = "press_fit"
    SOLDER = "solder"
    WIRE = "wire"
    SCREW = "screw"
    PIN = "pin"
    CUSTOM = "custom"


class Connection(BaseModel):
    """Connection specification between components."""

    from_id: str = Field(
        min_length=1,
        description="Source component ID",
        alias="from",
    )
    to_id: str = Field(
        min_length=1,
        description="Target component ID",
        alias="to",
    )
    type: str = Field(default="custom", description="Connection type")
    properties: dict[str, Any] = Field(
        default_factory=dict, description="Connection properties"
    )
    notes: str | None = Field(default=None, description="Additional notes")

    model_config = {"populate_by_name": True}


# ── Drawing Primitives (percentage-based coordinates 0–100) ─────────


class DrawingLine(BaseModel):
    """A line segment on the blueprint canvas.

    Coordinates are percentages (0–100) of the viewport so the
    drawing scales with window size.
    """

    id: str = Field(default="", description="Optional line ID")
    x1: float = Field(ge=0, le=100, description="Start X as percentage")
    y1: float = Field(ge=0, le=100, description="Start Y as percentage")
    x2: float = Field(ge=0, le=100, description="End X as percentage")
    y2: float = Field(ge=0, le=100, description="End Y as percentage")
    color: str = Field(default="cyan", description="Rich color name or hex")
    style: str = Field(
        default="solid",
        description="Line style: solid, dashed, dotted",
    )
    label: str = Field(default="", description="Optional label shown at midpoint")


class DrawingCircle(BaseModel):
    """A circle on the blueprint canvas (percentage coords)."""

    id: str = Field(default="", description="Optional circle ID")
    cx: float = Field(ge=0, le=100, description="Centre X %")
    cy: float = Field(ge=0, le=100, description="Centre Y %")
    r: float = Field(gt=0, le=50, description="Radius as % of width")
    color: str = Field(default="cyan", description="Color")
    fill: bool = Field(default=False, description="Whether to fill")
    label: str = Field(default="", description="Optional label")


class DrawingRect(BaseModel):
    """A rectangle on the blueprint canvas (percentage coords)."""

    id: str = Field(default="", description="Optional rect ID")
    x: float = Field(ge=0, le=100, description="Top-left X %")
    y: float = Field(ge=0, le=100, description="Top-left Y %")
    w: float = Field(gt=0, le=100, description="Width %")
    h: float = Field(gt=0, le=100, description="Height %")
    color: str = Field(default="cyan", description="Color")
    fill: bool = Field(default=False, description="Whether to fill")
    label: str = Field(default="", description="Optional label")


class DrawingArc(BaseModel):
    """An arc / curve on the blueprint canvas (percentage coords)."""

    id: str = Field(default="", description="Optional arc ID")
    cx: float = Field(ge=0, le=100, description="Centre X %")
    cy: float = Field(ge=0, le=100, description="Centre Y %")
    r: float = Field(gt=0, le=50, description="Radius %")
    start_angle: float = Field(default=0.0, description="Start angle degrees")
    end_angle: float = Field(default=180.0, description="End angle degrees")
    color: str = Field(default="cyan", description="Color")
    label: str = Field(default="", description="Optional label")


class DrawingText(BaseModel):
    """A text label placed on the blueprint canvas."""

    id: str = Field(default="", description="Optional text ID")
    x: float = Field(ge=0, le=100, description="X position %")
    y: float = Field(ge=0, le=100, description="Y position %")
    text: str = Field(min_length=1, description="The text to display")
    color: str = Field(default="white", description="Color")
    bold: bool = Field(default=False, description="Bold text")


class SyncMetadata(BaseModel):
    """Sync state metadata for cloud synchronization."""

    model_config = {"extra": "allow", "populate_by_name": True}

    synced: bool = Field(default=False, description="Whether synced to cloud")
    last_sync: str | None = Field(
        default=None,
        description="Last sync timestamp",
        alias="lastSyncedAt",
    )
    sync_version: int | None = Field(
        default=0,
        description="Sync version number",
        alias="serverVersion",
    )
    conflict_state: str | None = Field(
        default=None,
        description="Conflict state",
        alias="conflictState",
    )
    server_hash: str | None = Field(default=None, description="Server content hash")
    device_id: str | None = Field(
        default=None,
        description="Originating device ID",
        alias="deviceId",
    )


class SecurityMetadata(BaseModel):
    """Security and access control metadata."""

    model_config = {"extra": "allow", "populate_by_name": True}

    owner: str | None = Field(default=None, description="Blueprint owner")
    permissions: list[str] = Field(
        default_factory=lambda: ["read", "write"],
        description="Allowed permissions",
    )
    shared_with: list[str] = Field(
        default_factory=list, description="Users/groups with access"
    )
    signature: str | None = Field(default=None, description="Content signature")
    encryption_algorithm: str | None = Field(
        default=None,
        description="Encryption algorithm used",
        alias="encryptionAlgorithm",
    )


class Blueprint(BaseModel):
    """Complete .jarvis blueprint model.

    This is the main data structure for blueprint files, supporting
    complex assemblies with components, connections, and metadata.
    """

    model_config = {"extra": "allow", "populate_by_name": True}

    jarvis_version: str = Field(default="1.0", description="Schema version")
    type: BlueprintType = Field(
        default=BlueprintType.PART, description="Blueprint type"
    )
    name: str = Field(min_length=1, description="Blueprint name")
    description: str = Field(default="", description="Blueprint description")
    created: str = Field(
        default_factory=lambda: datetime.now().isoformat(),
        description="Creation timestamp",
    )
    modified: str = Field(
        default_factory=lambda: datetime.now().isoformat(),
        description="Last modified timestamp",
    )
    dimensions: Dimension | None = Field(
        default=None, description="Overall dimensions"
    )
    materials: list[Material] = Field(
        default_factory=list, description="Materials used"
    )
    components: list[ComponentSpec] = Field(
        default_factory=list, description="Component specifications"
    )
    connections: list[Connection] = Field(
        default_factory=list, description="Component connections"
    )
    specifications: dict[str, Any] = Field(
        default_factory=dict, description="Additional specifications"
    )
    notes: list[str] = Field(default_factory=list, description="Design notes")
    tags: list[str] = Field(default_factory=list, description="Searchable tags")

    # ── Drawing overlay ───────────────────────────────────────────
    # Coordinates are percentages (0–100) of the viewport so the
    # whole file is treated as a visual component with lines, shapes,
    # and labels rendered on top of the grid.
    lines: list[DrawingLine] = Field(
        default_factory=list,
        description="Lines to draw (percentage-based coordinates)",
    )
    circles: list[DrawingCircle] = Field(
        default_factory=list,
        description="Circles to draw (percentage-based coordinates)",
    )
    rects: list[DrawingRect] = Field(
        default_factory=list,
        description="Rectangles to draw (percentage-based coordinates)",
    )
    arcs: list[DrawingArc] = Field(
        default_factory=list,
        description="Arcs to draw (percentage-based coordinates)",
    )
    texts: list[DrawingText] = Field(
        default_factory=list,
        description="Text labels to draw (percentage-based coordinates)",
    )

    sync: SyncMetadata = Field(
        default_factory=SyncMetadata, description="Sync metadata"
    )
    security: SecurityMetadata = Field(
        default_factory=SecurityMetadata, description="Security metadata"
    )

    def get_component(self, component_id: str) -> ComponentSpec | None:
        """Get component by ID."""
        for comp in self.components:
            if comp.id == component_id:
                return comp
        return None

    def add_component(self, component: ComponentSpec) -> None:
        """Add a component to the blueprint."""
        if self.get_component(component.id):
            raise ValueError(f"Component with ID {component.id} already exists")
        self.components.append(component)
        self.modified = datetime.now().isoformat()

    def remove_component(self, component_id: str) -> bool:
        """Remove a component by ID. Returns True if removed."""
        for i, comp in enumerate(self.components):
            if comp.id == component_id:
                self.components.pop(i)
                # Also remove related connections
                self.connections = [
                    c
                    for c in self.connections
                    if c.from_id != component_id and c.to_id != component_id
                ]
                self.modified = datetime.now().isoformat()
                return True
        return False

    def compute_hash(self) -> str:
        """Compute content hash for change detection."""
        # Exclude mutable metadata from hash
        content = self.model_dump(exclude={"sync", "security", "modified"})
        content_str = json.dumps(content, sort_keys=True, default=str)
        return hashlib.sha256(content_str.encode()).hexdigest()[:16]


class BlueprintParseError(Exception):
    """Error parsing blueprint file."""


class BlueprintValidationError(Exception):
    """Error validating blueprint content."""


class BlueprintParser:
    """Parser for .jarvis blueprint files.

    Handles reading, writing, and validating blueprint files.

    Usage:
        parser = BlueprintParser()
        blueprint = parser.load("design.jarvis")
        parser.save(blueprint, "design_v2.jarvis")
    """

    VALID_EXTENSIONS = {".jarvis", ".json"}

    def __init__(self, strict: bool = True) -> None:
        """Initialize parser.

        Args:
            strict: If True, fail on validation errors. If False, attempt
                   to recover and continue.
        """
        self._strict = strict

    def load(self, path: str | Path) -> Blueprint:
        """Load blueprint from file.

        Args:
            path: Path to .jarvis file.

        Returns:
            Parsed Blueprint object.

        Raises:
            BlueprintParseError: If file cannot be parsed.
            BlueprintValidationError: If content is invalid (strict mode).
        """
        path = Path(path)

        if path.suffix.lower() not in self.VALID_EXTENSIONS:
            raise BlueprintParseError(
                f"Invalid file extension: {path.suffix}. "
                f"Expected: {self.VALID_EXTENSIONS}"
            )

        if not path.exists():
            raise BlueprintParseError(f"File not found: {path}")

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            raise BlueprintParseError(f"Invalid JSON in {path}: {e}") from e

        return self.parse(data)

    def parse(self, data: dict[str, Any]) -> Blueprint:
        """Parse blueprint from dictionary.

        Args:
            data: Dictionary representation of blueprint.

        Returns:
            Parsed Blueprint object.

        Raises:
            BlueprintValidationError: If content is invalid.
        """
        # ── Auto-fix corrupt blueprints before validation ────────
        from core.blueprint.fixer import fix_blueprint_dict

        fixes = fix_blueprint_dict(data)
        if fixes:
            import logging
            _log = logging.getLogger(__name__)
            _log.info(
                "Auto-fixed %d issue(s) in blueprint '%s': %s",
                len(fixes),
                data.get("name", "?"),
                "; ".join(fixes),
            )

        try:
            return Blueprint.model_validate(data)
        except Exception as e:
            if self._strict:
                raise BlueprintValidationError(f"Blueprint validation failed: {e}")
            # Non-strict: try to create with defaults
            return Blueprint(
                name=data.get("name", "Untitled"),
                description=data.get("description", ""),
                type=BlueprintType(data.get("type", "part")),
            )

    def save(self, blueprint: Blueprint, path: str | Path) -> None:
        """Save blueprint to file.

        Args:
            blueprint: Blueprint to save.
            path: Destination path.
        """
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        # Update modification time
        blueprint.modified = datetime.now().isoformat()

        data = blueprint.model_dump(mode="json", by_alias=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)

    def validate(self, blueprint: Blueprint) -> list[str]:
        """Validate blueprint and return list of issues.

        Args:
            blueprint: Blueprint to validate.

        Returns:
            List of validation issue messages (empty if valid).
        """
        issues: list[str] = []

        # Check for duplicate component IDs
        component_ids = [c.id for c in blueprint.components]
        if len(component_ids) != len(set(component_ids)):
            issues.append("Duplicate component IDs found")

        # Check connection references
        for conn in blueprint.connections:
            if conn.from_id not in component_ids:
                issues.append(f"Connection references unknown component: {conn.from_id}")
            if conn.to_id not in component_ids:
                issues.append(f"Connection references unknown component: {conn.to_id}")
            if conn.from_id == conn.to_id:
                issues.append(f"Self-referencing connection: {conn.from_id}")

        # Check child references
        for comp in blueprint.components:
            for child_id in comp.children:
                if child_id not in component_ids:
                    issues.append(
                        f"Component {comp.id} references unknown child: {child_id}"
                    )

        return issues

    def create_empty(self, name: str, bp_type: BlueprintType = BlueprintType.PART) -> Blueprint:
        """Create a new empty blueprint.

        Args:
            name: Blueprint name.
            bp_type: Blueprint type.

        Returns:
            New Blueprint instance.
        """
        return Blueprint(
            name=name,
            type=bp_type,
            description=f"New {bp_type.value} blueprint",
        )
