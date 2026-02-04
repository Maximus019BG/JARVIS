# Blueprint Engine Implementation Plan

## Executive Summary

This plan outlines the implementation of a **Blueprint Engine** that renders, manipulates, and updates `.jarvis` blueprints using **hand gesture detection** and the existing **BlueprintAgent** infrastructure. The engine provides a visual interface for hardware blueprints controllable via MediaPipe hand tracking on Raspberry Pi with IMX500 camera.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BLUEPRINT ENGINE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐ │
│  │  Vision Layer   │───▶│  Gesture Engine  │───▶│  Command Interpreter   │ │
│  │  (IMX500 + MP)  │    │  (Recognition)   │    │  (Gesture → Action)    │ │
│  └─────────────────┘    └──────────────────┘    └───────────┬────────────┘ │
│                                                              │              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────▼────────────┐ │
│  │ Blueprint Store │◀──▶│ Blueprint Engine │◀───│  Blueprint Controller  │ │
│  │ (.jarvis files) │    │   (Core Logic)   │    │  (CRUD + Transforms)   │ │
│  └─────────────────┘    └────────┬─────────┘    └────────────────────────┘ │
│                                  │                                          │
│  ┌─────────────────┐    ┌────────▼─────────┐    ┌────────────────────────┐ │
│  │ Render Pipeline │◀───│ Scene Graph      │───▶│  Display Adapter       │ │
│  │ (2D/3D Views)   │    │ (Component Tree) │    │  (Framebuffer/Preview) │ │
│  └─────────────────┘    └──────────────────┘    └────────────────────────┘ │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           INTEGRATION LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐ │
│  │ BlueprintAgent  │◀──▶│  Tool Registry   │◀──▶│  ChatHandler           │ │
│  │ (AI Design)     │    │  (Blueprint+)    │    │  (User Commands)       │ │
│  └─────────────────┘    └──────────────────┘    └────────────────────────┘ │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐ │
│  │ SyncManager     │◀──▶│ SecurityManager  │◀──▶│  OfflineQueue          │ │
│  │ (Server Sync)   │    │ (Auth/Signing)   │    │  (Resilience)          │ │
│  └─────────────────┘    └──────────────────┘    └────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Blueprint Engine

### 1.1 Directory Structure

```
hardware/
├── core/
│   ├── blueprint/                    # NEW: Blueprint Engine Core
│   │   ├── __init__.py
│   │   ├── engine.py                 # Main BlueprintEngine class
│   │   ├── parser.py                 # .jarvis file parser & validator
│   │   ├── scene_graph.py            # Component hierarchy/tree
│   │   ├── transforms.py             # Geometric transformations
│   │   ├── renderer.py               # 2D/3D rendering pipeline
│   │   ├── selection.py              # Component selection state
│   │   ├── history.py                # Undo/redo stack
│   │   │
│   │   ├── drawing/                  # NEW: Drawing & Creation Tools
│   │   │   ├── __init__.py
│   │   │   ├── canvas.py             # Drawing canvas with layers
│   │   │   ├── tools.py              # Drawing tool definitions
│   │   │   ├── primitives.py         # Lines, curves, shapes
│   │   │   ├── grid.py               # Grid & snap-to-grid system
│   │   │   ├── constraints.py        # Geometric constraints
│   │   │   └── component_library.py  # Pre-built component palette
│   │   │
│   │   └── geometry/                 # NEW: Geometry utilities
│   │       ├── __init__.py
│   │       ├── curves.py             # Bezier, arc, spline curves
│   │       ├── intersections.py      # Line/curve intersections
│   │       └── snapping.py           # Snap algorithms
│   │
│   ├── vision/                       # From hand detection plan
│   │   ├── __init__.py
│   │   ├── camera_capture.py
│   │   ├── hand_detector.py
│   │   ├── gesture_recognizer.py
│   │   └── gesture_events.py
│   │
│   └── blueprint_gesture/            # NEW: Gesture-Blueprint Bridge
│       ├── __init__.py
│       ├── gesture_commands.py       # Gesture → Engine command mapping
│       ├── spatial_mapping.py        # Hand position → Blueprint coords
│       └── interaction_modes.py      # Selection, Pan, Zoom, Edit modes
│
├── tools/
│   ├── blueprint_render_tool.py      # NEW: Render blueprint to display
│   ├── blueprint_edit_tool.py        # NEW: Edit component properties
│   ├── blueprint_transform_tool.py   # NEW: Move/rotate/scale components
│   ├── blueprint_export_tool.py      # NEW: Export to STL/SVG/PNG
│   └── gesture_mode_tool.py          # NEW: Switch gesture interaction modes
```

### 1.2 Blueprint Parser & Validator

**File**: `core/blueprint/parser.py`

```python
"""Parser and validator for .jarvis blueprint files."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, validator


class Dimension(BaseModel):
    """Dimension specification."""
    length: float
    width: float
    height: float
    unit: str = "mm"


class Material(BaseModel):
    """Material specification."""
    name: str
    type: str
    properties: dict[str, Any] = Field(default_factory=dict)


class ComponentSpec(BaseModel):
    """Component specification."""
    id: str
    name: str
    quantity: int = 1
    specifications: dict[str, Any] = Field(default_factory=dict)


class Connection(BaseModel):
    """Connection between components."""
    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    type: str
    fastener: str | None = None
    quantity: int = 1
    notes: str | None = None


class SyncMetadata(BaseModel):
    """Sync state metadata."""
    status: str = "local_only"
    lastSyncedAt: datetime | None = None
    serverVersion: int | None = None
    conflictState: str | None = None
    workstationId: str | None = None
    deviceId: str | None = None


class SecurityMetadata(BaseModel):
    """Security and access control."""
    classification: str = "internal"
    accessLevel: str = "read_write"
    allowedDevices: list[str] = Field(default_factory=list)
    signatureRequired: bool = True
    signature: str | None = None
    signedBy: str | None = None
    signedAt: datetime | None = None
    integrityVerified: bool = False
    encryptionEnabled: bool = False
    encryptionAlgorithm: str | None = None


class Blueprint(BaseModel):
    """Complete .jarvis blueprint model."""
    
    # Required fields
    jarvis_version: str
    id: str
    type: str  # part, assembly, building, system, circuit, mechanism
    name: str
    description: str
    
    # Metadata
    created: datetime
    author: str
    version: int = 1
    hash: str | None = None
    
    # Sync & Security
    sync: SyncMetadata = Field(default_factory=SyncMetadata)
    security: SecurityMetadata = Field(default_factory=SecurityMetadata)
    
    # Design data
    dimensions: Dimension | None = None
    materials: list[Material] = Field(default_factory=list)
    components: list[ComponentSpec] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    specifications: dict[str, Any] = Field(default_factory=dict)
    
    # Manufacturing
    manufacturing: dict[str, Any] = Field(default_factory=dict)
    assembly_instructions: list[dict[str, Any]] = Field(default_factory=list)
    
    # Documentation
    notes: list[str] = Field(default_factory=list)
    revisions: list[dict[str, Any]] = Field(default_factory=list)
    
    def calculate_hash(self) -> str:
        """Calculate SHA-256 hash of blueprint data."""
        data = self.dict(exclude={"hash", "sync", "security"})
        data_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(data_str.encode()).hexdigest()
    
    def verify_integrity(self) -> bool:
        """Verify hash matches content."""
        if not self.hash:
            return False
        return self.hash == self.calculate_hash()


class BlueprintParser:
    """Parser for .jarvis files."""
    
    @staticmethod
    def parse_file(path: Path) -> Blueprint:
        """Parse a .jarvis file."""
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return Blueprint(**data)
    
    @staticmethod
    def parse_string(content: str) -> Blueprint:
        """Parse blueprint from JSON string."""
        data = json.loads(content)
        return Blueprint(**data)
    
    @staticmethod
    def save(blueprint: Blueprint, path: Path) -> None:
        """Save blueprint to file."""
        # Update hash before saving
        blueprint.hash = blueprint.calculate_hash()
        
        with open(path, "w", encoding="utf-8") as f:
            json.dump(blueprint.dict(by_alias=True), f, indent=2, default=str)
```

### 1.3 Scene Graph (Component Hierarchy)

**File**: `core/blueprint/scene_graph.py`

```python
"""Scene graph for blueprint component hierarchy."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator
import uuid


@dataclass
class Transform:
    """3D transformation."""
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)  # Euler angles
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)
    
    def translate(self, dx: float, dy: float, dz: float) -> None:
        x, y, z = self.position
        self.position = (x + dx, y + dy, z + dz)
    
    def rotate(self, rx: float, ry: float, rz: float) -> None:
        x, y, z = self.rotation
        self.rotation = ((x + rx) % 360, (y + ry) % 360, (z + rz) % 360)
    
    def scale_by(self, sx: float, sy: float, sz: float) -> None:
        x, y, z = self.scale
        self.scale = (x * sx, y * sy, z * sz)


@dataclass
class BoundingBox:
    """Axis-aligned bounding box."""
    min_point: tuple[float, float, float]
    max_point: tuple[float, float, float]
    
    @property
    def center(self) -> tuple[float, float, float]:
        return tuple((a + b) / 2 for a, b in zip(self.min_point, self.max_point))
    
    @property
    def size(self) -> tuple[float, float, float]:
        return tuple(b - a for a, b in zip(self.min_point, self.max_point))
    
    def contains_point(self, point: tuple[float, float, float]) -> bool:
        return all(
            self.min_point[i] <= point[i] <= self.max_point[i]
            for i in range(3)
        )


@dataclass
class SceneNode:
    """Node in the scene graph."""
    
    id: str
    name: str
    component_id: str | None = None  # Reference to blueprint component
    transform: Transform = field(default_factory=Transform)
    bounds: BoundingBox | None = None
    visible: bool = True
    locked: bool = False
    selected: bool = False
    
    parent: SceneNode | None = field(default=None, repr=False)
    children: list[SceneNode] = field(default_factory=list)
    
    metadata: dict[str, Any] = field(default_factory=dict)
    
    def add_child(self, node: SceneNode) -> None:
        node.parent = self
        self.children.append(node)
    
    def remove_child(self, node: SceneNode) -> None:
        if node in self.children:
            node.parent = None
            self.children.remove(node)
    
    def get_world_transform(self) -> Transform:
        """Get transform in world coordinates."""
        if self.parent is None:
            return self.transform
        
        parent_transform = self.parent.get_world_transform()
        # Combine transforms (simplified - real impl needs matrix math)
        return Transform(
            position=tuple(
                p + l for p, l in zip(parent_transform.position, self.transform.position)
            ),
            rotation=tuple(
                (p + l) % 360 for p, l in zip(parent_transform.rotation, self.transform.rotation)
            ),
            scale=tuple(
                p * l for p, l in zip(parent_transform.scale, self.transform.scale)
            ),
        )
    
    def traverse(self) -> Iterator[SceneNode]:
        """Depth-first traversal."""
        yield self
        for child in self.children:
            yield from child.traverse()


class SceneGraph:
    """Blueprint scene graph manager."""
    
    def __init__(self) -> None:
        self.root = SceneNode(id="root", name="Root")
        self._node_index: dict[str, SceneNode] = {"root": self.root}
    
    def add_node(
        self,
        name: str,
        parent_id: str = "root",
        component_id: str | None = None,
        transform: Transform | None = None,
    ) -> SceneNode:
        """Add a node to the scene graph."""
        node_id = str(uuid.uuid4())[:8]
        node = SceneNode(
            id=node_id,
            name=name,
            component_id=component_id,
            transform=transform or Transform(),
        )
        
        parent = self._node_index.get(parent_id, self.root)
        parent.add_child(node)
        self._node_index[node_id] = node
        
        return node
    
    def get_node(self, node_id: str) -> SceneNode | None:
        return self._node_index.get(node_id)
    
    def find_by_component(self, component_id: str) -> SceneNode | None:
        for node in self.root.traverse():
            if node.component_id == component_id:
                return node
        return None
    
    def get_selected(self) -> list[SceneNode]:
        return [n for n in self.root.traverse() if n.selected]
    
    def select_node(self, node_id: str, multi: bool = False) -> None:
        if not multi:
            for node in self.root.traverse():
                node.selected = False
        
        node = self.get_node(node_id)
        if node:
            node.selected = True
    
    def clear_selection(self) -> None:
        for node in self.root.traverse():
            node.selected = False
```

### 1.4 Blueprint Engine Core

**File**: `core/blueprint/engine.py`

```python
"""Core Blueprint Engine - manages blueprint state, rendering, and interactions."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any, Callable

from app_logging.logger import get_logger
from core.blueprint.parser import Blueprint, BlueprintParser
from core.blueprint.scene_graph import SceneGraph, SceneNode, Transform
from core.blueprint.history import CommandHistory, Command

logger = get_logger(__name__)


class InteractionMode(str, Enum):
    """Current interaction mode."""
    VIEW = "view"           # Pan, zoom, orbit
    SELECT = "select"       # Select components
    TRANSFORM = "transform" # Move, rotate, scale
    EDIT = "edit"          # Edit component properties
    MEASURE = "measure"    # Measure distances
    ANNOTATE = "annotate"  # Add notes/annotations
    
    # Drawing modes
    DRAW_LINE = "draw_line"           # Straight line tool
    DRAW_CURVE = "draw_curve"         # Bezier/arc curve tool
    DRAW_RECT = "draw_rect"           # Rectangle tool
    DRAW_CIRCLE = "draw_circle"       # Circle/ellipse tool
    DRAW_POLYGON = "draw_polygon"     # Polygon tool
    DRAW_FREEHAND = "draw_freehand"   # Freehand sketch
    COMPONENT = "component"           # Place component from library


class ViewMode(str, Enum):
    """Rendering view mode."""
    TOP = "top"           # 2D top-down
    FRONT = "front"       # 2D front view
    SIDE = "side"         # 2D side view
    ISO = "isometric"     # 3D isometric
    PERSPECTIVE = "perspective"  # 3D perspective
    EXPLODED = "exploded" # Exploded assembly view


@dataclass
class ViewState:
    """Current view state."""
    mode: ViewMode = ViewMode.ISO
    zoom: float = 1.0
    pan_offset: tuple[float, float] = (0.0, 0.0)
    rotation: tuple[float, float, float] = (30.0, -45.0, 0.0)  # For 3D views


@dataclass
class EngineState:
    """Complete engine state."""
    blueprint: Blueprint | None = None
    blueprint_path: Path | None = None
    scene: SceneGraph = field(default_factory=SceneGraph)
    view: ViewState = field(default_factory=ViewState)
    interaction_mode: InteractionMode = InteractionMode.VIEW
    modified: bool = False


class BlueprintEngine:
    """Main Blueprint Engine class.
    
    Manages:
    - Blueprint loading/saving
    - Scene graph construction
    - View state
    - Interaction modes
    - Command history (undo/redo)
    - Event callbacks
    """
    
    def __init__(self) -> None:
        self._state = EngineState()
        self._history = CommandHistory()
        self._callbacks: dict[str, list[Callable]] = {}
        
        # Rendering hook (injected by display adapter)
        self._render_callback: Callable[[EngineState], None] | None = None
    
    @property
    def state(self) -> EngineState:
        return self._state
    
    @property
    def blueprint(self) -> Blueprint | None:
        return self._state.blueprint
    
    @property
    def scene(self) -> SceneGraph:
        return self._state.scene
    
    # --- Event System ---
    
    def on(self, event: str, callback: Callable) -> None:
        """Register event callback."""
        if event not in self._callbacks:
            self._callbacks[event] = []
        self._callbacks[event].append(callback)
    
    def emit(self, event: str, **kwargs: Any) -> None:
        """Emit event to callbacks."""
        for callback in self._callbacks.get(event, []):
            try:
                callback(**kwargs)
            except Exception as e:
                logger.error(f"Event callback error: {e}")
    
    # --- Blueprint Operations ---
    
    def load_blueprint(self, path: Path | str) -> Blueprint:
        """Load a blueprint file and build scene graph."""
        path = Path(path)
        blueprint = BlueprintParser.parse_file(path)
        
        self._state.blueprint = blueprint
        self._state.blueprint_path = path
        self._state.modified = False
        
        # Build scene graph from components
        self._build_scene_graph(blueprint)
        
        self.emit("blueprint_loaded", blueprint=blueprint, path=path)
        self._request_render()
        
        return blueprint
    
    def save_blueprint(self, path: Path | str | None = None) -> None:
        """Save current blueprint."""
        if not self._state.blueprint:
            raise ValueError("No blueprint loaded")
        
        path = Path(path) if path else self._state.blueprint_path
        if not path:
            raise ValueError("No save path specified")
        
        BlueprintParser.save(self._state.blueprint, path)
        self._state.blueprint_path = path
        self._state.modified = False
        
        self.emit("blueprint_saved", path=path)
    
    def new_blueprint(
        self,
        name: str,
        blueprint_type: str,
        description: str = "",
    ) -> Blueprint:
        """Create a new empty blueprint."""
        from datetime import datetime
        
        blueprint = Blueprint(
            jarvis_version="1.0",
            id=f"bp_{name.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}",
            type=blueprint_type,
            name=name,
            description=description,
            created=datetime.now(),
            author="JARVIS Blueprint Engine",
        )
        
        self._state.blueprint = blueprint
        self._state.blueprint_path = None
        self._state.modified = True
        self._state.scene = SceneGraph()
        
        self.emit("blueprint_created", blueprint=blueprint)
        self._request_render()
        
        return blueprint
    
    def _build_scene_graph(self, blueprint: Blueprint) -> None:
        """Build scene graph from blueprint components."""
        self._state.scene = SceneGraph()
        
        # Add components as scene nodes
        for component in blueprint.components:
            # Calculate position based on component specs
            dims = component.specifications.get("dimensions", {})
            
            self._state.scene.add_node(
                name=component.name,
                component_id=component.id,
                transform=Transform(
                    position=(0.0, 0.0, 0.0),  # Would be calculated from layout
                    scale=(
                        dims.get("length", 1.0) / 100,
                        dims.get("width", 1.0) / 100,
                        dims.get("height", 1.0) / 100,
                    ),
                ),
            )
    
    # --- View Operations ---
    
    def set_view_mode(self, mode: ViewMode) -> None:
        """Change view mode."""
        self._state.view.mode = mode
        self.emit("view_changed", view=self._state.view)
        self._request_render()
    
    def zoom(self, factor: float) -> None:
        """Zoom view by factor."""
        self._state.view.zoom *= factor
        self._state.view.zoom = max(0.1, min(10.0, self._state.view.zoom))
        self.emit("view_changed", view=self._state.view)
        self._request_render()
    
    def pan(self, dx: float, dy: float) -> None:
        """Pan view."""
        x, y = self._state.view.pan_offset
        self._state.view.pan_offset = (x + dx, y + dy)
        self.emit("view_changed", view=self._state.view)
        self._request_render()
    
    def rotate_view(self, rx: float, ry: float) -> None:
        """Rotate 3D view."""
        x, y, z = self._state.view.rotation
        self._state.view.rotation = ((x + rx) % 360, (y + ry) % 360, z)
        self.emit("view_changed", view=self._state.view)
        self._request_render()
    
    def reset_view(self) -> None:
        """Reset view to default."""
        self._state.view = ViewState()
        self.emit("view_changed", view=self._state.view)
        self._request_render()
    
    # --- Interaction Mode ---
    
    def set_interaction_mode(self, mode: InteractionMode) -> None:
        """Change interaction mode."""
        self._state.interaction_mode = mode
        self.emit("mode_changed", mode=mode)
    
    # --- Selection ---
    
    def select_component(self, component_id: str, multi: bool = False) -> None:
        """Select a component by ID."""
        node = self._state.scene.find_by_component(component_id)
        if node:
            self._state.scene.select_node(node.id, multi=multi)
            self.emit("selection_changed", selected=self._state.scene.get_selected())
            self._request_render()
    
    def clear_selection(self) -> None:
        """Clear all selections."""
        self._state.scene.clear_selection()
        self.emit("selection_changed", selected=[])
        self._request_render()
    
    def get_selected_components(self) -> list[str]:
        """Get IDs of selected components."""
        return [
            n.component_id for n in self._state.scene.get_selected()
            if n.component_id
        ]
    
    # --- Transform Operations ---
    
    def translate_selected(self, dx: float, dy: float, dz: float) -> None:
        """Move selected components."""
        for node in self._state.scene.get_selected():
            node.transform.translate(dx, dy, dz)
        
        self._state.modified = True
        self.emit("components_transformed", nodes=self._state.scene.get_selected())
        self._request_render()
    
    def rotate_selected(self, rx: float, ry: float, rz: float) -> None:
        """Rotate selected components."""
        for node in self._state.scene.get_selected():
            node.transform.rotate(rx, ry, rz)
        
        self._state.modified = True
        self.emit("components_transformed", nodes=self._state.scene.get_selected())
        self._request_render()
    
    def scale_selected(self, sx: float, sy: float, sz: float) -> None:
        """Scale selected components."""
        for node in self._state.scene.get_selected():
            node.transform.scale_by(sx, sy, sz)
        
        self._state.modified = True
        self.emit("components_transformed", nodes=self._state.scene.get_selected())
        self._request_render()
    
    # --- Component Operations ---
    
    def add_component(
        self,
        component_id: str,
        name: str,
        specifications: dict[str, Any],
    ) -> None:
        """Add a new component to the blueprint."""
        if not self._state.blueprint:
            raise ValueError("No blueprint loaded")
        
        from core.blueprint.parser import ComponentSpec
        
        component = ComponentSpec(
            id=component_id,
            name=name,
            specifications=specifications,
        )
        
        self._state.blueprint.components.append(component)
        self._state.scene.add_node(name=name, component_id=component_id)
        self._state.modified = True
        
        self.emit("component_added", component=component)
        self._request_render()
    
    def remove_selected_components(self) -> None:
        """Remove selected components."""
        if not self._state.blueprint:
            return
        
        selected_ids = self.get_selected_components()
        
        # Remove from blueprint
        self._state.blueprint.components = [
            c for c in self._state.blueprint.components
            if c.id not in selected_ids
        ]
        
        # Remove from scene graph
        for node in self._state.scene.get_selected():
            if node.parent:
                node.parent.remove_child(node)
        
        self._state.modified = True
        self.emit("components_removed", component_ids=selected_ids)
        self._request_render()
    
    # --- History (Undo/Redo) ---
    
    def undo(self) -> None:
        """Undo last command."""
        if self._history.undo():
            self._request_render()
            self.emit("history_changed", can_undo=self._history.can_undo, can_redo=self._history.can_redo)
    
    def redo(self) -> None:
        """Redo last undone command."""
        if self._history.redo():
            self._request_render()
            self.emit("history_changed", can_undo=self._history.can_undo, can_redo=self._history.can_redo)
    
    # --- Rendering ---
    
    def set_render_callback(self, callback: Callable[[EngineState], None]) -> None:
        """Set the rendering callback."""
        self._render_callback = callback
    
    def _request_render(self) -> None:
        """Request a re-render."""
        if self._render_callback:
            self._render_callback(self._state)
```

---

## Phase 1.5: Drawing & Creation System

This phase covers how users actually **create** blueprints by drawing components, lines, curves, and shapes with gesture control and snap-to-grid functionality.

### 1.5.1 Grid System & Snapping

**File**: `core/blueprint/drawing/grid.py`

```python
"""Grid system with snap-to-grid functionality."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

import math


class GridType(str, Enum):
    """Grid visualization types."""
    LINES = "lines"       # Standard line grid
    DOTS = "dots"         # Dot grid (less visual clutter)
    ISOMETRIC = "iso"     # Isometric grid for 3D-style drawing
    NONE = "none"         # No grid


class SnapMode(str, Enum):
    """Snap target types."""
    GRID = "grid"                 # Snap to grid intersections
    ENDPOINT = "endpoint"         # Snap to line/curve endpoints
    MIDPOINT = "midpoint"         # Snap to midpoints
    CENTER = "center"             # Snap to shape centers
    INTERSECTION = "intersection" # Snap to line intersections
    PERPENDICULAR = "perpendicular"  # Snap perpendicular to lines
    TANGENT = "tangent"           # Snap tangent to curves
    NEAREST = "nearest"           # Snap to nearest point on geometry


@dataclass
class GridConfig:
    """Grid configuration."""
    
    enabled: bool = True
    grid_type: GridType = GridType.LINES
    
    # Grid spacing
    major_spacing: float = 10.0     # Major grid lines (mm)
    minor_divisions: int = 5        # Minor divisions per major
    
    # Snapping
    snap_enabled: bool = True
    snap_modes: set[SnapMode] = field(default_factory=lambda: {
        SnapMode.GRID, 
        SnapMode.ENDPOINT, 
        SnapMode.INTERSECTION
    })
    snap_threshold: float = 5.0     # Pixels - distance to trigger snap
    
    # Visual
    major_color: tuple[int, int, int] = (80, 80, 80)
    minor_color: tuple[int, int, int] = (50, 50, 50)
    snap_indicator_color: tuple[int, int, int] = (0, 255, 0)
    
    # Units
    unit: str = "mm"


@dataclass
class SnapResult:
    """Result of a snap operation."""
    
    snapped: bool
    point: tuple[float, float]
    snap_type: SnapMode | None = None
    target_id: str | None = None  # ID of element snapped to
    
    @staticmethod
    def no_snap(point: tuple[float, float]) -> "SnapResult":
        return SnapResult(snapped=False, point=point)


class GridSystem:
    """Grid and snapping manager."""
    
    def __init__(self, config: GridConfig | None = None) -> None:
        self._config = config or GridConfig()
        self._snap_targets: list[dict] = []  # Cached snap targets
    
    @property
    def config(self) -> GridConfig:
        return self._config
    
    def set_spacing(self, major: float, minor_divisions: int = 5) -> None:
        """Set grid spacing."""
        self._config.major_spacing = major
        self._config.minor_divisions = minor_divisions
    
    def toggle_snap(self, enabled: bool | None = None) -> bool:
        """Toggle snap on/off."""
        if enabled is None:
            self._config.snap_enabled = not self._config.snap_enabled
        else:
            self._config.snap_enabled = enabled
        return self._config.snap_enabled
    
    def set_snap_modes(self, modes: set[SnapMode]) -> None:
        """Set active snap modes."""
        self._config.snap_modes = modes
    
    def snap_point(
        self,
        point: tuple[float, float],
        view_zoom: float = 1.0,
    ) -> SnapResult:
        """Snap a point to the nearest valid target.
        
        Args:
            point: Input point in world coordinates.
            view_zoom: Current view zoom for threshold scaling.
            
        Returns:
            SnapResult with snapped point and metadata.
        """
        if not self._config.snap_enabled:
            return SnapResult.no_snap(point)
        
        # Adjust threshold for zoom
        threshold = self._config.snap_threshold / view_zoom
        best_snap: SnapResult | None = None
        best_distance = float('inf')
        
        # 1) Grid snap
        if SnapMode.GRID in self._config.snap_modes:
            grid_snap = self._snap_to_grid(point)
            dist = self._distance(point, grid_snap)
            if dist < threshold and dist < best_distance:
                best_snap = SnapResult(
                    snapped=True,
                    point=grid_snap,
                    snap_type=SnapMode.GRID,
                )
                best_distance = dist
        
        # 2) Geometry snaps (endpoints, midpoints, etc.)
        for target in self._snap_targets:
            for mode in self._config.snap_modes:
                if mode == SnapMode.GRID:
                    continue
                
                snap_point = self._get_snap_point(target, mode, point)
                if snap_point:
                    dist = self._distance(point, snap_point)
                    if dist < threshold and dist < best_distance:
                        best_snap = SnapResult(
                            snapped=True,
                            point=snap_point,
                            snap_type=mode,
                            target_id=target.get("id"),
                        )
                        best_distance = dist
        
        return best_snap or SnapResult.no_snap(point)
    
    def _snap_to_grid(self, point: tuple[float, float]) -> tuple[float, float]:
        """Snap to nearest grid intersection."""
        spacing = self._config.major_spacing / self._config.minor_divisions
        
        x = round(point[0] / spacing) * spacing
        y = round(point[1] / spacing) * spacing
        
        return (x, y)
    
    def _get_snap_point(
        self,
        target: dict,
        mode: SnapMode,
        cursor: tuple[float, float],
    ) -> tuple[float, float] | None:
        """Get snap point for a specific target and mode."""
        
        if mode == SnapMode.ENDPOINT:
            # Return closest endpoint
            endpoints = target.get("endpoints", [])
            if not endpoints:
                return None
            return min(endpoints, key=lambda p: self._distance(cursor, p))
        
        if mode == SnapMode.MIDPOINT:
            midpoint = target.get("midpoint")
            return midpoint
        
        if mode == SnapMode.CENTER:
            center = target.get("center")
            return center
        
        if mode == SnapMode.INTERSECTION:
            # Would need to compute intersections with other geometry
            pass
        
        return None
    
    def register_snap_target(self, target: dict) -> None:
        """Register geometry as snap target."""
        self._snap_targets.append(target)
    
    def clear_snap_targets(self) -> None:
        """Clear all snap targets."""
        self._snap_targets.clear()
    
    def update_snap_targets_from_scene(self, scene) -> None:
        """Update snap targets from scene graph."""
        self.clear_snap_targets()
        
        for node in scene.root.traverse():
            if node.component_id:
                # Add component snap points
                bounds = node.bounds
                if bounds:
                    center = bounds.center[:2]
                    self.register_snap_target({
                        "id": node.component_id,
                        "center": center,
                        "endpoints": [
                            bounds.min_point[:2],
                            bounds.max_point[:2],
                        ],
                    })
    
    @staticmethod
    def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
        return math.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2)
```

### 1.5.2 Geometric Primitives

**File**: `core/blueprint/drawing/primitives.py`

```python
"""Geometric primitives for blueprint drawing."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterator
import math
import uuid


class PrimitiveType(str, Enum):
    """Types of drawable primitives."""
    LINE = "line"
    ARC = "arc"
    BEZIER = "bezier"
    POLYLINE = "polyline"
    RECTANGLE = "rectangle"
    CIRCLE = "circle"
    ELLIPSE = "ellipse"
    POLYGON = "polygon"
    FREEHAND = "freehand"
    TEXT = "text"
    DIMENSION = "dimension"


@dataclass
class Point2D:
    """2D point."""
    x: float
    y: float
    
    def __iter__(self):
        yield self.x
        yield self.y
    
    def distance_to(self, other: "Point2D") -> float:
        return math.sqrt((self.x - other.x)**2 + (self.y - other.y)**2)
    
    def midpoint(self, other: "Point2D") -> "Point2D":
        return Point2D((self.x + other.x) / 2, (self.y + other.y) / 2)
    
    def to_tuple(self) -> tuple[float, float]:
        return (self.x, self.y)


@dataclass 
class DrawStyle:
    """Visual style for primitives."""
    stroke_color: tuple[int, int, int] = (255, 255, 255)
    stroke_width: float = 1.0
    fill_color: tuple[int, int, int] | None = None
    line_style: str = "solid"  # solid, dashed, dotted
    opacity: float = 1.0


class Primitive(ABC):
    """Base class for all drawable primitives."""
    
    def __init__(self, style: DrawStyle | None = None):
        self.id = str(uuid.uuid4())[:8]
        self.style = style or DrawStyle()
        self.locked = False
        self.visible = True
        self.layer = "default"
    
    @property
    @abstractmethod
    def primitive_type(self) -> PrimitiveType:
        """Type of this primitive."""
    
    @abstractmethod
    def get_points(self) -> list[Point2D]:
        """Get key points (for snapping)."""
    
    @abstractmethod
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        """Get bounding box (min, max)."""
    
    @abstractmethod
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        """Check if point is on/in this primitive."""
    
    @abstractmethod
    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict."""
    
    def get_snap_targets(self) -> dict:
        """Get snap target data for this primitive."""
        points = self.get_points()
        return {
            "id": self.id,
            "endpoints": [p.to_tuple() for p in points],
            "midpoint": points[0].midpoint(points[-1]).to_tuple() if len(points) >= 2 else None,
        }


@dataclass
class Line(Primitive):
    """Straight line segment."""
    
    start: Point2D
    end: Point2D
    
    def __init__(self, start: Point2D, end: Point2D, style: DrawStyle | None = None):
        super().__init__(style)
        self.start = start
        self.end = end
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.LINE
    
    @property
    def length(self) -> float:
        return self.start.distance_to(self.end)
    
    @property
    def angle(self) -> float:
        """Angle in degrees from horizontal."""
        dx = self.end.x - self.start.x
        dy = self.end.y - self.start.y
        return math.degrees(math.atan2(dy, dx))
    
    def get_points(self) -> list[Point2D]:
        return [self.start, self.end]
    
    def get_midpoint(self) -> Point2D:
        return self.start.midpoint(self.end)
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        return (
            Point2D(min(self.start.x, self.end.x), min(self.start.y, self.end.y)),
            Point2D(max(self.start.x, self.end.x), max(self.start.y, self.end.y)),
        )
    
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        # Distance from point to line segment
        d = self._point_to_segment_distance(point)
        return d <= tolerance
    
    def _point_to_segment_distance(self, point: Point2D) -> float:
        """Calculate distance from point to line segment."""
        px, py = point.x, point.y
        x1, y1 = self.start.x, self.start.y
        x2, y2 = self.end.x, self.end.y
        
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return point.distance_to(self.start)
        
        t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        proj = Point2D(x1 + t * dx, y1 + t * dy)
        return point.distance_to(proj)
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "line",
            "id": self.id,
            "start": self.start.to_tuple(),
            "end": self.end.to_tuple(),
            "style": self.style.__dict__,
        }


@dataclass
class Arc(Primitive):
    """Circular arc."""
    
    center: Point2D
    radius: float
    start_angle: float  # Degrees
    end_angle: float    # Degrees
    
    def __init__(
        self,
        center: Point2D,
        radius: float,
        start_angle: float,
        end_angle: float,
        style: DrawStyle | None = None,
    ):
        super().__init__(style)
        self.center = center
        self.radius = radius
        self.start_angle = start_angle
        self.end_angle = end_angle
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.ARC
    
    def get_start_point(self) -> Point2D:
        rad = math.radians(self.start_angle)
        return Point2D(
            self.center.x + self.radius * math.cos(rad),
            self.center.y + self.radius * math.sin(rad),
        )
    
    def get_end_point(self) -> Point2D:
        rad = math.radians(self.end_angle)
        return Point2D(
            self.center.x + self.radius * math.cos(rad),
            self.center.y + self.radius * math.sin(rad),
        )
    
    def get_points(self) -> list[Point2D]:
        return [self.get_start_point(), self.center, self.get_end_point()]
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        # Simplified - actual implementation needs to check arc extent
        return (
            Point2D(self.center.x - self.radius, self.center.y - self.radius),
            Point2D(self.center.x + self.radius, self.center.y + self.radius),
        )
    
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        dist_to_center = point.distance_to(self.center)
        if abs(dist_to_center - self.radius) > tolerance:
            return False
        
        # Check if point is within arc angle range
        angle = math.degrees(math.atan2(
            point.y - self.center.y,
            point.x - self.center.x,
        ))
        return self._angle_in_range(angle)
    
    def _angle_in_range(self, angle: float) -> bool:
        """Check if angle is within arc range."""
        # Normalize angles to 0-360
        start = self.start_angle % 360
        end = self.end_angle % 360
        angle = angle % 360
        
        if start <= end:
            return start <= angle <= end
        else:
            return angle >= start or angle <= end
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "arc",
            "id": self.id,
            "center": self.center.to_tuple(),
            "radius": self.radius,
            "start_angle": self.start_angle,
            "end_angle": self.end_angle,
            "style": self.style.__dict__,
        }


@dataclass
class BezierCurve(Primitive):
    """Cubic Bezier curve."""
    
    p0: Point2D  # Start point
    p1: Point2D  # Control point 1
    p2: Point2D  # Control point 2
    p3: Point2D  # End point
    
    def __init__(
        self,
        p0: Point2D,
        p1: Point2D,
        p2: Point2D,
        p3: Point2D,
        style: DrawStyle | None = None,
    ):
        super().__init__(style)
        self.p0 = p0
        self.p1 = p1
        self.p2 = p2
        self.p3 = p3
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.BEZIER
    
    def evaluate(self, t: float) -> Point2D:
        """Evaluate curve at parameter t (0-1)."""
        t2 = t * t
        t3 = t2 * t
        mt = 1 - t
        mt2 = mt * mt
        mt3 = mt2 * mt
        
        x = mt3 * self.p0.x + 3 * mt2 * t * self.p1.x + 3 * mt * t2 * self.p2.x + t3 * self.p3.x
        y = mt3 * self.p0.y + 3 * mt2 * t * self.p1.y + 3 * mt * t2 * self.p2.y + t3 * self.p3.y
        
        return Point2D(x, y)
    
    def get_points(self) -> list[Point2D]:
        return [self.p0, self.p1, self.p2, self.p3]
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        # Sample curve for bounds (simplified)
        points = [self.evaluate(t / 20) for t in range(21)]
        xs = [p.x for p in points]
        ys = [p.y for p in points]
        return (Point2D(min(xs), min(ys)), Point2D(max(xs), max(ys)))
    
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        # Sample and check distance
        for i in range(50):
            t = i / 50
            curve_point = self.evaluate(t)
            if point.distance_to(curve_point) <= tolerance:
                return True
        return False
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "bezier",
            "id": self.id,
            "p0": self.p0.to_tuple(),
            "p1": self.p1.to_tuple(),
            "p2": self.p2.to_tuple(),
            "p3": self.p3.to_tuple(),
            "style": self.style.__dict__,
        }


@dataclass
class Rectangle(Primitive):
    """Rectangle shape."""
    
    origin: Point2D  # Top-left corner
    width: float
    height: float
    corner_radius: float = 0.0  # For rounded rectangles
    
    def __init__(
        self,
        origin: Point2D,
        width: float,
        height: float,
        corner_radius: float = 0.0,
        style: DrawStyle | None = None,
    ):
        super().__init__(style)
        self.origin = origin
        self.width = width
        self.height = height
        self.corner_radius = corner_radius
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.RECTANGLE
    
    @property
    def center(self) -> Point2D:
        return Point2D(
            self.origin.x + self.width / 2,
            self.origin.y + self.height / 2,
        )
    
    def get_corners(self) -> list[Point2D]:
        return [
            self.origin,
            Point2D(self.origin.x + self.width, self.origin.y),
            Point2D(self.origin.x + self.width, self.origin.y + self.height),
            Point2D(self.origin.x, self.origin.y + self.height),
        ]
    
    def get_points(self) -> list[Point2D]:
        return self.get_corners() + [self.center]
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        return (
            self.origin,
            Point2D(self.origin.x + self.width, self.origin.y + self.height),
        )
    
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        return (
            self.origin.x - tolerance <= point.x <= self.origin.x + self.width + tolerance and
            self.origin.y - tolerance <= point.y <= self.origin.y + self.height + tolerance
        )
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "rectangle",
            "id": self.id,
            "origin": self.origin.to_tuple(),
            "width": self.width,
            "height": self.height,
            "corner_radius": self.corner_radius,
            "style": self.style.__dict__,
        }


@dataclass
class Circle(Primitive):
    """Circle shape."""
    
    center: Point2D
    radius: float
    
    def __init__(self, center: Point2D, radius: float, style: DrawStyle | None = None):
        super().__init__(style)
        self.center = center
        self.radius = radius
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.CIRCLE
    
    def get_points(self) -> list[Point2D]:
        # Center + cardinal points
        return [
            self.center,
            Point2D(self.center.x + self.radius, self.center.y),
            Point2D(self.center.x, self.center.y + self.radius),
            Point2D(self.center.x - self.radius, self.center.y),
            Point2D(self.center.x, self.center.y - self.radius),
        ]
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        return (
            Point2D(self.center.x - self.radius, self.center.y - self.radius),
            Point2D(self.center.x + self.radius, self.center.y + self.radius),
        )
    
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        dist = point.distance_to(self.center)
        return dist <= self.radius + tolerance
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "circle",
            "id": self.id,
            "center": self.center.to_tuple(),
            "radius": self.radius,
            "style": self.style.__dict__,
        }


@dataclass
class Polyline(Primitive):
    """Connected series of line segments."""
    
    points: list[Point2D]
    closed: bool = False
    
    def __init__(
        self,
        points: list[Point2D],
        closed: bool = False,
        style: DrawStyle | None = None,
    ):
        super().__init__(style)
        self.points = points
        self.closed = closed
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.POLYLINE if not self.closed else PrimitiveType.POLYGON
    
    def get_points(self) -> list[Point2D]:
        return self.points
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        xs = [p.x for p in self.points]
        ys = [p.y for p in self.points]
        return (Point2D(min(xs), min(ys)), Point2D(max(xs), max(ys)))
    
    def contains_point(self, point: Point2D, tolerance: float = 2.0) -> bool:
        # Check each segment
        for i in range(len(self.points) - 1):
            segment = Line(self.points[i], self.points[i + 1])
            if segment.contains_point(point, tolerance):
                return True
        
        if self.closed and len(self.points) >= 2:
            closing = Line(self.points[-1], self.points[0])
            if closing.contains_point(point, tolerance):
                return True
        
        return False
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "polyline",
            "id": self.id,
            "points": [p.to_tuple() for p in self.points],
            "closed": self.closed,
            "style": self.style.__dict__,
        }


@dataclass
class Freehand(Primitive):
    """Freehand sketch path (smoothed)."""
    
    points: list[Point2D]
    smoothing: float = 0.5  # 0-1 smoothing factor
    
    def __init__(
        self,
        points: list[Point2D],
        smoothing: float = 0.5,
        style: DrawStyle | None = None,
    ):
        super().__init__(style)
        self.points = points
        self.smoothing = smoothing
    
    @property
    def primitive_type(self) -> PrimitiveType:
        return PrimitiveType.FREEHAND
    
    def get_smoothed_points(self) -> list[Point2D]:
        """Apply smoothing to raw points."""
        if len(self.points) < 3 or self.smoothing == 0:
            return self.points
        
        smoothed = [self.points[0]]
        
        for i in range(1, len(self.points) - 1):
            prev = self.points[i - 1]
            curr = self.points[i]
            next_p = self.points[i + 1]
            
            # Simple moving average
            x = curr.x + self.smoothing * ((prev.x + next_p.x) / 2 - curr.x)
            y = curr.y + self.smoothing * ((prev.y + next_p.y) / 2 - curr.y)
            
            smoothed.append(Point2D(x, y))
        
        smoothed.append(self.points[-1])
        return smoothed
    
    def get_points(self) -> list[Point2D]:
        return [self.points[0], self.points[-1]] if self.points else []
    
    def get_bounds(self) -> tuple[Point2D, Point2D]:
        xs = [p.x for p in self.points]
        ys = [p.y for p in self.points]
        return (Point2D(min(xs), min(ys)), Point2D(max(xs), max(ys)))
    
    def contains_point(self, point: Point2D, tolerance: float = 5.0) -> bool:
        for p in self.points:
            if point.distance_to(p) <= tolerance:
                return True
        return False
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "freehand",
            "id": self.id,
            "points": [p.to_tuple() for p in self.points],
            "smoothing": self.smoothing,
            "style": self.style.__dict__,
        }
```

### 1.5.3 Drawing Tools System

**File**: `core/blueprint/drawing/tools.py`

```python
"""Drawing tools for blueprint creation."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any, Callable

from core.blueprint.drawing.primitives import (
    Primitive, Line, Arc, BezierCurve, Rectangle, Circle, 
    Polyline, Freehand, Point2D, DrawStyle
)
from core.blueprint.drawing.grid import GridSystem, SnapResult

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine


class ToolState(str, Enum):
    """State of a drawing tool."""
    IDLE = "idle"           # Waiting for input
    DRAWING = "drawing"     # Actively drawing
    PREVIEW = "preview"     # Showing preview
    COMPLETE = "complete"   # Finished, ready to commit


@dataclass
class ToolContext:
    """Context passed to drawing tools."""
    grid: GridSystem
    current_style: DrawStyle
    view_zoom: float = 1.0
    constrain_angle: bool = False  # Shift-key style constraint
    constrain_square: bool = False # Square/circle constraint
    
    # Callbacks
    on_preview: Callable[[Primitive | None], None] | None = None
    on_commit: Callable[[Primitive], None] | None = None


class DrawingTool(ABC):
    """Base class for drawing tools."""
    
    def __init__(self, context: ToolContext):
        self._context = context
        self._state = ToolState.IDLE
        self._preview: Primitive | None = None
        self._points: list[Point2D] = []
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Tool name."""
    
    @property
    @abstractmethod
    def icon(self) -> str:
        """Tool icon (emoji or path)."""
    
    @property
    def state(self) -> ToolState:
        return self._state
    
    def on_start(self, point: tuple[float, float]) -> None:
        """Called when drawing starts (e.g., finger down)."""
        snapped = self._snap(point)
        self._points = [Point2D(*snapped.point)]
        self._state = ToolState.DRAWING
    
    def on_move(self, point: tuple[float, float]) -> None:
        """Called during drawing (e.g., finger move)."""
        if self._state != ToolState.DRAWING:
            return
        
        snapped = self._snap(point)
        self._update_preview(Point2D(*snapped.point))
    
    def on_end(self, point: tuple[float, float]) -> None:
        """Called when drawing ends (e.g., finger up)."""
        if self._state != ToolState.DRAWING:
            return
        
        snapped = self._snap(point)
        self._points.append(Point2D(*snapped.point))
        self._commit()
    
    def on_cancel(self) -> None:
        """Cancel current drawing."""
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None
        if self._context.on_preview:
            self._context.on_preview(None)
    
    def _snap(self, point: tuple[float, float]) -> SnapResult:
        """Snap point using grid system."""
        return self._context.grid.snap_point(point, self._context.view_zoom)
    
    @abstractmethod
    def _update_preview(self, current: Point2D) -> None:
        """Update preview primitive."""
    
    @abstractmethod
    def _commit(self) -> None:
        """Commit the drawing."""


class LineTool(DrawingTool):
    """Straight line drawing tool."""
    
    @property
    def name(self) -> str:
        return "Line"
    
    @property
    def icon(self) -> str:
        return "📏"
    
    def _update_preview(self, current: Point2D) -> None:
        if not self._points:
            return
        
        start = self._points[0]
        end = current
        
        # Constrain to 45-degree angles if enabled
        if self._context.constrain_angle:
            end = self._constrain_angle(start, end)
        
        self._preview = Line(start, end, self._context.current_style)
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def _constrain_angle(self, start: Point2D, end: Point2D) -> Point2D:
        """Constrain line to 45-degree increments."""
        dx = end.x - start.x
        dy = end.y - start.y
        
        # Determine dominant direction
        angle = math.atan2(dy, dx)
        # Snap to nearest 45 degrees
        snapped_angle = round(angle / (math.pi / 4)) * (math.pi / 4)
        
        length = math.sqrt(dx * dx + dy * dy)
        
        return Point2D(
            start.x + length * math.cos(snapped_angle),
            start.y + length * math.sin(snapped_angle),
        )
    
    def _commit(self) -> None:
        if len(self._points) >= 2 and self._preview:
            if self._context.on_commit:
                self._context.on_commit(self._preview)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


class ArcTool(DrawingTool):
    """Arc drawing tool (3-point arc)."""
    
    @property
    def name(self) -> str:
        return "Arc"
    
    @property
    def icon(self) -> str:
        return "⌒"
    
    def on_end(self, point: tuple[float, float]) -> None:
        """Arc needs 3 points: start, through, end."""
        snapped = self._snap(point)
        self._points.append(Point2D(*snapped.point))
        
        if len(self._points) == 3:
            self._commit()
        elif len(self._points) == 2:
            # Show preview arc using current position as through-point
            self._state = ToolState.DRAWING
    
    def _update_preview(self, current: Point2D) -> None:
        if len(self._points) == 1:
            # Just show line to current point
            self._preview = Line(self._points[0], current, self._context.current_style)
        elif len(self._points) == 2:
            # Show arc preview through current point
            arc = self._create_arc(self._points[0], current, self._points[1])
            if arc:
                self._preview = arc
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def _create_arc(
        self, 
        start: Point2D, 
        through: Point2D, 
        end: Point2D
    ) -> Arc | None:
        """Create arc through 3 points."""
        # Calculate circle through 3 points
        # Using circumcenter formula
        ax, ay = start.x, start.y
        bx, by = through.x, through.y
        cx, cy = end.x, end.y
        
        d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        if abs(d) < 1e-10:
            return None  # Points are collinear
        
        ux = ((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / d
        uy = ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / d
        
        center = Point2D(ux, uy)
        radius = center.distance_to(start)
        
        start_angle = math.degrees(math.atan2(ay - uy, ax - ux))
        end_angle = math.degrees(math.atan2(cy - uy, cx - ux))
        
        return Arc(center, radius, start_angle, end_angle, self._context.current_style)
    
    def _commit(self) -> None:
        if len(self._points) == 3:
            arc = self._create_arc(self._points[0], self._points[1], self._points[2])
            if arc and self._context.on_commit:
                self._context.on_commit(arc)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


class BezierTool(DrawingTool):
    """Bezier curve tool (click for control points)."""
    
    @property
    def name(self) -> str:
        return "Curve"
    
    @property
    def icon(self) -> str:
        return "〰️"
    
    def on_end(self, point: tuple[float, float]) -> None:
        """Need 4 points for cubic bezier."""
        snapped = self._snap(point)
        self._points.append(Point2D(*snapped.point))
        
        if len(self._points) == 4:
            self._commit()
    
    def _update_preview(self, current: Point2D) -> None:
        if len(self._points) == 1:
            # Line from start
            self._preview = Line(self._points[0], current, self._context.current_style)
        elif len(self._points) == 2:
            # Quadratic preview
            self._preview = BezierCurve(
                self._points[0], self._points[1], current, current,
                self._context.current_style
            )
        elif len(self._points) == 3:
            # Full cubic preview
            self._preview = BezierCurve(
                self._points[0], self._points[1], self._points[2], current,
                self._context.current_style
            )
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def _commit(self) -> None:
        if len(self._points) == 4:
            curve = BezierCurve(
                self._points[0], self._points[1], 
                self._points[2], self._points[3],
                self._context.current_style
            )
            if self._context.on_commit:
                self._context.on_commit(curve)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


class RectangleTool(DrawingTool):
    """Rectangle drawing tool."""
    
    @property
    def name(self) -> str:
        return "Rectangle"
    
    @property
    def icon(self) -> str:
        return "⬜"
    
    def _update_preview(self, current: Point2D) -> None:
        if not self._points:
            return
        
        start = self._points[0]
        width = current.x - start.x
        height = current.y - start.y
        
        # Constrain to square if enabled
        if self._context.constrain_square:
            size = max(abs(width), abs(height))
            width = size if width >= 0 else -size
            height = size if height >= 0 else -size
        
        # Handle negative dimensions
        origin = Point2D(
            min(start.x, start.x + width),
            min(start.y, start.y + height),
        )
        
        self._preview = Rectangle(
            origin, abs(width), abs(height),
            style=self._context.current_style,
        )
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def _commit(self) -> None:
        if self._preview and isinstance(self._preview, Rectangle):
            if self._preview.width > 0 and self._preview.height > 0:
                if self._context.on_commit:
                    self._context.on_commit(self._preview)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


class CircleTool(DrawingTool):
    """Circle drawing tool (center + radius)."""
    
    @property
    def name(self) -> str:
        return "Circle"
    
    @property
    def icon(self) -> str:
        return "⭕"
    
    def _update_preview(self, current: Point2D) -> None:
        if not self._points:
            return
        
        center = self._points[0]
        radius = center.distance_to(current)
        
        self._preview = Circle(center, radius, self._context.current_style)
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def _commit(self) -> None:
        if self._preview and isinstance(self._preview, Circle):
            if self._preview.radius > 0:
                if self._context.on_commit:
                    self._context.on_commit(self._preview)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


class PolylineTool(DrawingTool):
    """Multi-segment line tool (click to add points, double-click to finish)."""
    
    def __init__(self, context: ToolContext, closed: bool = False):
        super().__init__(context)
        self._closed = closed
    
    @property
    def name(self) -> str:
        return "Polygon" if self._closed else "Polyline"
    
    @property
    def icon(self) -> str:
        return "⬡" if self._closed else "📐"
    
    def on_start(self, point: tuple[float, float]) -> None:
        """Start or add point."""
        snapped = self._snap(point)
        new_point = Point2D(*snapped.point)
        
        if self._state == ToolState.IDLE:
            self._points = [new_point]
            self._state = ToolState.DRAWING
        else:
            # Check for double-click (close to last point)
            if self._points and new_point.distance_to(self._points[-1]) < 5:
                self._commit()
            else:
                self._points.append(new_point)
    
    def on_end(self, point: tuple[float, float]) -> None:
        # Polyline continues until explicit finish
        pass
    
    def _update_preview(self, current: Point2D) -> None:
        if not self._points:
            return
        
        preview_points = self._points + [current]
        self._preview = Polyline(preview_points, self._closed, self._context.current_style)
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def finish(self) -> None:
        """Explicitly finish the polyline."""
        self._commit()
    
    def _commit(self) -> None:
        if len(self._points) >= 2:
            shape = Polyline(self._points, self._closed, self._context.current_style)
            if self._context.on_commit:
                self._context.on_commit(shape)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


class FreehandTool(DrawingTool):
    """Freehand drawing tool."""
    
    @property
    def name(self) -> str:
        return "Freehand"
    
    @property
    def icon(self) -> str:
        return "✏️"
    
    def on_move(self, point: tuple[float, float]) -> None:
        if self._state != ToolState.DRAWING:
            return
        
        # Don't snap freehand - use raw points
        self._points.append(Point2D(*point))
        self._update_preview(self._points[-1])
    
    def _update_preview(self, current: Point2D) -> None:
        if len(self._points) < 2:
            return
        
        self._preview = Freehand(
            self._points.copy(),
            smoothing=0.5,
            style=self._context.current_style,
        )
        
        if self._context.on_preview:
            self._context.on_preview(self._preview)
    
    def _commit(self) -> None:
        if len(self._points) >= 3:
            shape = Freehand(
                self._points.copy(),
                smoothing=0.5,
                style=self._context.current_style,
            )
            if self._context.on_commit:
                self._context.on_commit(shape)
        
        self._state = ToolState.IDLE
        self._points.clear()
        self._preview = None


# Import math for angle calculations
import math


class ToolManager:
    """Manages available drawing tools."""
    
    TOOLS = {
        "line": LineTool,
        "arc": ArcTool,
        "curve": BezierTool,
        "rectangle": RectangleTool,
        "circle": CircleTool,
        "polyline": PolylineTool,
        "polygon": lambda ctx: PolylineTool(ctx, closed=True),
        "freehand": FreehandTool,
    }
    
    def __init__(self, context: ToolContext):
        self._context = context
        self._current_tool: DrawingTool | None = None
        self._tool_name: str = "line"
    
    @property
    def current_tool(self) -> DrawingTool | None:
        return self._current_tool
    
    @property
    def available_tools(self) -> list[str]:
        return list(self.TOOLS.keys())
    
    def select_tool(self, name: str) -> DrawingTool:
        """Select a drawing tool by name."""
        if name not in self.TOOLS:
            raise ValueError(f"Unknown tool: {name}")
        
        # Cancel any in-progress drawing
        if self._current_tool:
            self._current_tool.on_cancel()
        
        tool_class = self.TOOLS[name]
        self._current_tool = tool_class(self._context)
        self._tool_name = name
        
        return self._current_tool
    
    def cycle_tool(self) -> str:
        """Cycle to next tool."""
        tools = self.available_tools
        current_idx = tools.index(self._tool_name) if self._tool_name in tools else -1
        next_idx = (current_idx + 1) % len(tools)
        self.select_tool(tools[next_idx])
        return tools[next_idx]
```

### 1.5.4 Component Library

**File**: `core/blueprint/drawing/component_library.py`

```python
"""Pre-built component library for quick insertion."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any
import json


class ComponentCategory(str, Enum):
    """Component categories."""
    FASTENERS = "fasteners"
    STRUCTURAL = "structural"
    ELECTRONIC = "electronic"
    MECHANICAL = "mechanical"
    CONNECTORS = "connectors"
    CUSTOM = "custom"


@dataclass
class LibraryComponent:
    """A component in the library."""
    
    id: str
    name: str
    category: ComponentCategory
    description: str
    thumbnail: str | None = None  # Base64 or path
    
    # Component data (can be inserted into blueprint)
    specifications: dict[str, Any] = field(default_factory=dict)
    dimensions: dict[str, float] = field(default_factory=dict)
    material: str | None = None
    
    # Drawing data (primitives that make up the component)
    primitives: list[dict[str, Any]] = field(default_factory=list)
    
    # Snap/connection points
    connection_points: list[dict[str, Any]] = field(default_factory=list)
    
    # Metadata
    tags: list[str] = field(default_factory=list)
    author: str = "system"


# Built-in component definitions
BUILTIN_COMPONENTS = [
    LibraryComponent(
        id="m3_bolt",
        name="M3 Bolt",
        category=ComponentCategory.FASTENERS,
        description="M3 socket head cap screw",
        specifications={
            "thread": "M3",
            "head_type": "socket_cap",
            "head_diameter": 5.5,
            "head_height": 3.0,
        },
        dimensions={"length": 10, "diameter": 3},
        material="Stainless Steel",
        connection_points=[
            {"id": "head", "position": [0, 0], "type": "bolt_head"},
            {"id": "tip", "position": [0, 10], "type": "thread"},
        ],
        tags=["bolt", "screw", "m3", "fastener"],
    ),
    LibraryComponent(
        id="m3_nut",
        name="M3 Nut",
        category=ComponentCategory.FASTENERS,
        description="M3 hex nut",
        specifications={
            "thread": "M3",
            "width_across_flats": 5.5,
            "height": 2.4,
        },
        dimensions={"width": 5.5, "height": 2.4},
        material="Stainless Steel",
        connection_points=[
            {"id": "top", "position": [0, 0], "type": "thread"},
            {"id": "bottom", "position": [0, 2.4], "type": "thread"},
        ],
        tags=["nut", "m3", "fastener", "hex"],
    ),
    LibraryComponent(
        id="brass_insert_m3",
        name="M3 Brass Insert",
        category=ComponentCategory.FASTENERS,
        description="Heat-set brass insert for 3D prints",
        specifications={
            "thread": "M3",
            "outer_diameter": 4.5,
            "install_method": "heat_set",
        },
        dimensions={"length": 5, "outer_diameter": 4.5, "inner_diameter": 3},
        material="Brass",
        tags=["insert", "brass", "m3", "3d_print"],
    ),
    LibraryComponent(
        id="bearing_608",
        name="608 Bearing",
        category=ComponentCategory.MECHANICAL,
        description="Standard 608 skateboard bearing",
        specifications={
            "type": "ball_bearing",
            "inner_diameter": 8,
            "outer_diameter": 22,
            "width": 7,
        },
        dimensions={"inner_diameter": 8, "outer_diameter": 22, "width": 7},
        material="Steel",
        tags=["bearing", "608", "ball_bearing"],
    ),
    LibraryComponent(
        id="dc_motor_n20",
        name="N20 DC Motor",
        category=ComponentCategory.ELECTRONIC,
        description="N20 micro gear motor",
        specifications={
            "voltage": 6,
            "rpm": 100,
            "shaft_diameter": 3,
        },
        dimensions={"length": 25, "width": 12, "height": 10},
        material="Metal/Plastic",
        tags=["motor", "dc", "n20", "gear_motor"],
    ),
    LibraryComponent(
        id="raspberry_pi_mount",
        name="Raspberry Pi Mount",
        category=ComponentCategory.STRUCTURAL,
        description="Standard Raspberry Pi mounting holes",
        specifications={
            "hole_pattern": "rpi_standard",
            "hole_diameter": 2.7,
            "spacing_x": 58,
            "spacing_y": 49,
        },
        dimensions={"width": 85, "height": 56},
        connection_points=[
            {"id": "hole1", "position": [3.5, 3.5], "type": "m2.5_hole"},
            {"id": "hole2", "position": [61.5, 3.5], "type": "m2.5_hole"},
            {"id": "hole3", "position": [61.5, 52.5], "type": "m2.5_hole"},
            {"id": "hole4", "position": [3.5, 52.5], "type": "m2.5_hole"},
        ],
        tags=["raspberry_pi", "mount", "computer"],
    ),
]


class ComponentLibrary:
    """Component library manager."""
    
    def __init__(self, custom_library_path: Path | None = None):
        self._components: dict[str, LibraryComponent] = {}
        self._custom_path = custom_library_path or Path("data/component_library.json")
        
        # Load built-in components
        for comp in BUILTIN_COMPONENTS:
            self._components[comp.id] = comp
        
        # Load custom components
        self._load_custom()
    
    def _load_custom(self) -> None:
        """Load custom components from file."""
        if not self._custom_path.exists():
            return
        
        try:
            with open(self._custom_path, encoding="utf-8") as f:
                data = json.load(f)
            
            for item in data.get("components", []):
                comp = LibraryComponent(**item)
                self._components[comp.id] = comp
        except Exception:
            pass  # Ignore load errors
    
    def _save_custom(self) -> None:
        """Save custom components to file."""
        custom = [
            c.__dict__ for c in self._components.values()
            if c.author != "system"
        ]
        
        self._custom_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._custom_path, "w", encoding="utf-8") as f:
            json.dump({"components": custom}, f, indent=2)
    
    def get_all(self) -> list[LibraryComponent]:
        """Get all components."""
        return list(self._components.values())
    
    def get_by_category(self, category: ComponentCategory) -> list[LibraryComponent]:
        """Get components by category."""
        return [c for c in self._components.values() if c.category == category]
    
    def get_by_id(self, component_id: str) -> LibraryComponent | None:
        """Get component by ID."""
        return self._components.get(component_id)
    
    def search(self, query: str) -> list[LibraryComponent]:
        """Search components by name, description, or tags."""
        query = query.lower()
        results = []
        
        for comp in self._components.values():
            if (query in comp.name.lower() or
                query in comp.description.lower() or
                any(query in tag for tag in comp.tags)):
                results.append(comp)
        
        return results
    
    def add_custom(self, component: LibraryComponent) -> None:
        """Add a custom component."""
        component.author = "custom"
        self._components[component.id] = component
        self._save_custom()
    
    def remove_custom(self, component_id: str) -> bool:
        """Remove a custom component."""
        comp = self._components.get(component_id)
        if comp and comp.author != "system":
            del self._components[component_id]
            self._save_custom()
            return True
        return False
    
    def create_from_selection(
        self,
        primitives: list,
        name: str,
        category: ComponentCategory = ComponentCategory.CUSTOM,
    ) -> LibraryComponent:
        """Create a library component from selected primitives."""
        import uuid
        
        component = LibraryComponent(
            id=f"custom_{uuid.uuid4().hex[:8]}",
            name=name,
            category=category,
            description=f"Custom component: {name}",
            primitives=[p.to_dict() for p in primitives],
            author="custom",
        )
        
        self.add_custom(component)
        return component
```

### 1.5.5 Drawing Canvas (Layers)

**File**: `core/blueprint/drawing/canvas.py`

```python
"""Drawing canvas with layer management."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator
import uuid

from core.blueprint.drawing.primitives import Primitive, Point2D


@dataclass
class Layer:
    """A drawing layer."""
    
    id: str
    name: str
    visible: bool = True
    locked: bool = False
    opacity: float = 1.0
    color: tuple[int, int, int] = (255, 255, 255)  # Layer color tint
    
    primitives: list[Primitive] = field(default_factory=list)
    
    def add_primitive(self, primitive: Primitive) -> None:
        primitive.layer = self.id
        self.primitives.append(primitive)
    
    def remove_primitive(self, primitive_id: str) -> bool:
        for i, p in enumerate(self.primitives):
            if p.id == primitive_id:
                self.primitives.pop(i)
                return True
        return False
    
    def get_primitive(self, primitive_id: str) -> Primitive | None:
        for p in self.primitives:
            if p.id == primitive_id:
                return p
        return None


class DrawingCanvas:
    """Canvas for blueprint drawing with layers."""
    
    def __init__(self) -> None:
        self._layers: dict[str, Layer] = {}
        self._layer_order: list[str] = []
        self._active_layer_id: str | None = None
        
        # Create default layer
        self.add_layer("Main")
    
    @property
    def active_layer(self) -> Layer | None:
        if self._active_layer_id:
            return self._layers.get(self._active_layer_id)
        return None
    
    @property
    def layers(self) -> list[Layer]:
        """Get layers in draw order."""
        return [self._layers[lid] for lid in self._layer_order if lid in self._layers]
    
    def add_layer(self, name: str) -> Layer:
        """Add a new layer."""
        layer_id = str(uuid.uuid4())[:8]
        layer = Layer(id=layer_id, name=name)
        self._layers[layer_id] = layer
        self._layer_order.append(layer_id)
        
        if self._active_layer_id is None:
            self._active_layer_id = layer_id
        
        return layer
    
    def remove_layer(self, layer_id: str) -> bool:
        """Remove a layer."""
        if layer_id not in self._layers:
            return False
        
        del self._layers[layer_id]
        self._layer_order.remove(layer_id)
        
        if self._active_layer_id == layer_id:
            self._active_layer_id = self._layer_order[0] if self._layer_order else None
        
        return True
    
    def set_active_layer(self, layer_id: str) -> bool:
        """Set the active layer."""
        if layer_id in self._layers:
            self._active_layer_id = layer_id
            return True
        return False
    
    def move_layer(self, layer_id: str, direction: int) -> None:
        """Move layer up (1) or down (-1) in order."""
        if layer_id not in self._layer_order:
            return
        
        idx = self._layer_order.index(layer_id)
        new_idx = max(0, min(len(self._layer_order) - 1, idx + direction))
        
        self._layer_order.pop(idx)
        self._layer_order.insert(new_idx, layer_id)
    
    def add_primitive(self, primitive: Primitive) -> None:
        """Add primitive to active layer."""
        if self.active_layer and not self.active_layer.locked:
            self.active_layer.add_primitive(primitive)
    
    def get_all_primitives(self) -> Iterator[Primitive]:
        """Iterate all primitives in draw order."""
        for layer in self.layers:
            if layer.visible:
                yield from layer.primitives
    
    def find_at_point(
        self, 
        point: Point2D, 
        tolerance: float = 5.0,
    ) -> list[Primitive]:
        """Find primitives at a point."""
        results = []
        
        for layer in self.layers:
            if not layer.visible or layer.locked:
                continue
            
            for prim in layer.primitives:
                if prim.visible and prim.contains_point(point, tolerance):
                    results.append(prim)
        
        return results
    
    def to_dict(self) -> dict[str, Any]:
        """Serialize canvas to dict."""
        return {
            "layers": [
                {
                    "id": layer.id,
                    "name": layer.name,
                    "visible": layer.visible,
                    "locked": layer.locked,
                    "opacity": layer.opacity,
                    "primitives": [p.to_dict() for p in layer.primitives],
                }
                for layer in self.layers
            ],
            "active_layer": self._active_layer_id,
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DrawingCanvas":
        """Deserialize canvas from dict."""
        canvas = cls()
        canvas._layers.clear()
        canvas._layer_order.clear()
        
        # Would need primitive deserialization here
        # Left as exercise
        
        return canvas
```

### 1.5.6 Gesture-Drawing Integration

Add these gesture mappings to the gesture command registry for drawing:

```python
# Additional gesture commands for drawing mode

# In gesture_commands.py, add to _register_default_commands():

# --- Drawing Mode Commands ---

# Pinch gesture: Start/confirm drawing point
self.register(GestureCommand(
    gesture=GestureType.PINCH,
    action="drawing_point",
    handler=self._handle_drawing_point,
    description="Add point in current drawing tool",
    requires_mode=InteractionMode.DRAW_LINE,
))

# Open hand: Finish current drawing
self.register(GestureCommand(
    gesture=GestureType.OPEN_PALM,
    action="finish_drawing",
    handler=self._finish_drawing,
    description="Complete current drawing",
    requires_mode=InteractionMode.DRAW_POLYGON,
))

# Pointing with movement: Draw freehand
self.register(GestureCommand(
    gesture=GestureType.POINTING,
    action="freehand_draw",
    handler=self._handle_freehand,
    description="Freehand drawing with finger",
    requires_mode=InteractionMode.DRAW_FREEHAND,
))

# Peace sign in drawing mode: Cycle drawing tool
self.register(GestureCommand(
    gesture=GestureType.PEACE,
    action="cycle_drawing_tool",
    handler=self._cycle_drawing_tool,
    description="Cycle through drawing tools",
))

# Closed fist: Toggle snap-to-grid
self.register(GestureCommand(
    gesture=GestureType.CLOSED_FIST,
    action="toggle_snap",
    handler=self._toggle_snap,
    description="Toggle snap-to-grid",
))

def _handle_drawing_point(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
    """Handle point addition for drawing tools."""
    # Get hand position and convert to canvas coordinates
    fingertip = gesture.hand.landmarks[8]  # Index finger tip
    point = (fingertip.x, fingertip.y)
    
    tool = engine.drawing_manager.current_tool
    if tool:
        if tool.state == ToolState.IDLE:
            tool.on_start(point)
        else:
            tool.on_end(point)

def _finish_drawing(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
    """Finish current multi-point drawing."""
    tool = engine.drawing_manager.current_tool
    if tool and hasattr(tool, 'finish'):
        tool.finish()

def _handle_freehand(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
    """Handle freehand drawing."""
    fingertip = gesture.hand.landmarks[8]
    point = (fingertip.x, fingertip.y)
    
    tool = engine.drawing_manager.current_tool
    if tool and tool.state == ToolState.DRAWING:
        tool.on_move(point)

def _cycle_drawing_tool(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
    """Cycle through available drawing tools."""
    if hasattr(engine, 'tool_manager'):
        new_tool = engine.tool_manager.cycle_tool()
        # Could emit event or update UI

def _toggle_snap(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
    """Toggle snap-to-grid."""
    if hasattr(engine, 'grid'):
        enabled = engine.grid.toggle_snap()
        # Could emit event or update UI
```

### 1.5.7 Drawing Mode Gesture Reference

| Gesture | Drawing Mode Action |
|---------|---------------------|
| 🤏 **Pinch** | Place point (start line, add vertex) |
| 👆 **Point + Move** | Freehand drawing / preview next point |
| ✋ **Open Palm** | Finish multi-point shape (polygon, polyline) |
| ✊ **Closed Fist** | Toggle snap-to-grid |
| ✌️ **Peace** | Cycle drawing tool (line→arc→curve→rect→circle) |
| 👍 **Thumbs Up** | Commit drawing to canvas |
| 👎 **Thumbs Down** | Cancel/undo current drawing |
| ← → **Swipe** | Adjust grid spacing / zoom |
| 👌 **OK Sign** | Toggle constraint mode (45° angles, square) |

---

## Phase 2: Gesture-Blueprint Integration

### 2.1 Gesture Commands

**File**: `core/blueprint_gesture/gesture_commands.py`

```python
"""Maps gestures to blueprint engine commands."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Callable, Any

from core.vision.gesture_recognizer import GestureType, GestureResult
from core.blueprint.engine import BlueprintEngine, InteractionMode, ViewMode

if TYPE_CHECKING:
    pass


@dataclass
class GestureCommand:
    """A gesture-to-action mapping."""
    gesture: GestureType
    action: str
    handler: Callable[[BlueprintEngine, GestureResult], None]
    description: str
    requires_mode: InteractionMode | None = None


class GestureCommandRegistry:
    """Registry of gesture commands for blueprint interaction."""
    
    def __init__(self, engine: BlueprintEngine) -> None:
        self._engine = engine
        self._commands: dict[GestureType, list[GestureCommand]] = {}
        self._register_default_commands()
    
    def _register_default_commands(self) -> None:
        """Register default gesture mappings."""
        
        # --- View Mode Commands ---
        
        # Open Palm: Stop/Reset
        self.register(GestureCommand(
            gesture=GestureType.OPEN_PALM,
            action="reset_view",
            handler=lambda e, g: e.reset_view(),
            description="Reset view to default",
        ))
        
        # Closed Fist: Toggle selection mode
        self.register(GestureCommand(
            gesture=GestureType.CLOSED_FIST,
            action="toggle_select_mode",
            handler=self._toggle_select_mode,
            description="Toggle selection mode",
        ))
        
        # Pointing: Select component at cursor
        self.register(GestureCommand(
            gesture=GestureType.POINTING,
            action="select_at_point",
            handler=self._select_at_point,
            description="Select component under cursor",
            requires_mode=InteractionMode.SELECT,
        ))
        
        # Thumbs Up: Confirm action / Save
        self.register(GestureCommand(
            gesture=GestureType.THUMBS_UP,
            action="confirm",
            handler=self._confirm_action,
            description="Confirm current action or save",
        ))
        
        # Thumbs Down: Cancel / Undo
        self.register(GestureCommand(
            gesture=GestureType.THUMBS_DOWN,
            action="cancel",
            handler=lambda e, g: e.undo(),
            description="Undo last action",
        ))
        
        # Peace Sign: Switch view mode
        self.register(GestureCommand(
            gesture=GestureType.PEACE,
            action="cycle_view",
            handler=self._cycle_view_mode,
            description="Cycle through view modes",
        ))
        
        # OK Sign: Toggle edit mode
        self.register(GestureCommand(
            gesture=GestureType.OK_SIGN,
            action="toggle_edit_mode",
            handler=self._toggle_edit_mode,
            description="Toggle edit mode",
        ))
        
        # Pinch: Zoom (handled dynamically via distance)
        self.register(GestureCommand(
            gesture=GestureType.PINCH,
            action="pinch_zoom",
            handler=self._handle_pinch,
            description="Zoom in/out with pinch",
        ))
        
        # --- Motion Gestures ---
        
        # Swipe Left: Previous component / Rotate left
        self.register(GestureCommand(
            gesture=GestureType.SWIPE_LEFT,
            action="swipe_left",
            handler=self._handle_swipe_left,
            description="Navigate left or rotate view",
        ))
        
        # Swipe Right: Next component / Rotate right
        self.register(GestureCommand(
            gesture=GestureType.SWIPE_RIGHT,
            action="swipe_right",
            handler=self._handle_swipe_right,
            description="Navigate right or rotate view",
        ))
        
        # Swipe Up: Zoom in
        self.register(GestureCommand(
            gesture=GestureType.SWIPE_UP,
            action="zoom_in",
            handler=lambda e, g: e.zoom(1.2),
            description="Zoom in",
        ))
        
        # Swipe Down: Zoom out
        self.register(GestureCommand(
            gesture=GestureType.SWIPE_DOWN,
            action="zoom_out",
            handler=lambda e, g: e.zoom(0.8),
            description="Zoom out",
        ))
    
    def register(self, command: GestureCommand) -> None:
        """Register a gesture command."""
        if command.gesture not in self._commands:
            self._commands[command.gesture] = []
        self._commands[command.gesture].append(command)
    
    def execute(self, result: GestureResult) -> bool:
        """Execute command for gesture."""
        commands = self._commands.get(result.gesture, [])
        
        for cmd in commands:
            # Check mode requirement
            if cmd.requires_mode and self._engine.state.interaction_mode != cmd.requires_mode:
                continue
            
            cmd.handler(self._engine, result)
            return True
        
        return False
    
    # --- Command Handlers ---
    
    def _toggle_select_mode(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        if engine.state.interaction_mode == InteractionMode.SELECT:
            engine.set_interaction_mode(InteractionMode.VIEW)
        else:
            engine.set_interaction_mode(InteractionMode.SELECT)
    
    def _toggle_edit_mode(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        if engine.state.interaction_mode == InteractionMode.EDIT:
            engine.set_interaction_mode(InteractionMode.VIEW)
        else:
            engine.set_interaction_mode(InteractionMode.EDIT)
    
    def _select_at_point(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        # Would use spatial mapping to convert hand position to component
        # For now, select first unselected component
        if engine.blueprint:
            for comp in engine.blueprint.components:
                node = engine.scene.find_by_component(comp.id)
                if node and not node.selected:
                    engine.select_component(comp.id)
                    break
    
    def _confirm_action(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        if engine.state.modified:
            engine.save_blueprint()
    
    def _cycle_view_mode(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        modes = list(ViewMode)
        current_idx = modes.index(engine.state.view.mode)
        next_idx = (current_idx + 1) % len(modes)
        engine.set_view_mode(modes[next_idx])
    
    def _handle_pinch(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        # Pinch distance would affect zoom factor
        # Simplified: toggle between zoom in/out
        if engine.state.view.zoom < 1.0:
            engine.zoom(1.5)
        else:
            engine.zoom(0.7)
    
    def _handle_swipe_left(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        if engine.state.interaction_mode == InteractionMode.VIEW:
            engine.rotate_view(0, -30)
        elif engine.state.interaction_mode == InteractionMode.SELECT:
            # Select previous component
            pass
    
    def _handle_swipe_right(self, engine: BlueprintEngine, gesture: GestureResult) -> None:
        if engine.state.interaction_mode == InteractionMode.VIEW:
            engine.rotate_view(0, 30)
        elif engine.state.interaction_mode == InteractionMode.SELECT:
            # Select next component
            pass
```

### 2.2 Spatial Mapping (Hand to Blueprint Coords)

**File**: `core/blueprint_gesture/spatial_mapping.py`

```python
"""Maps hand positions in camera space to blueprint coordinates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from core.vision.hand_detector import Landmark
from core.blueprint.engine import EngineState, ViewMode

if TYPE_CHECKING:
    pass


@dataclass
class ScreenPoint:
    """Point in screen/camera coordinates (0-1 normalized)."""
    x: float
    y: float


@dataclass
class BlueprintPoint:
    """Point in blueprint world coordinates."""
    x: float
    y: float
    z: float


class SpatialMapper:
    """Maps between camera space and blueprint space."""
    
    def __init__(
        self,
        camera_width: int = 640,
        camera_height: int = 480,
    ) -> None:
        self._camera_width = camera_width
        self._camera_height = camera_height
    
    def hand_to_screen(self, landmark: Landmark) -> ScreenPoint:
        """Convert hand landmark to screen coordinates."""
        # MediaPipe coordinates are already normalized 0-1
        # Mirror X for natural interaction
        return ScreenPoint(x=1.0 - landmark.x, y=landmark.y)
    
    def screen_to_blueprint(
        self,
        point: ScreenPoint,
        state: EngineState,
    ) -> BlueprintPoint:
        """Convert screen point to blueprint world coordinates.
        
        Takes into account current view state (zoom, pan, rotation).
        """
        zoom = state.view.zoom
        pan_x, pan_y = state.view.pan_offset
        
        # Convert normalized screen to centered coordinates
        cx = (point.x - 0.5) * 2.0  # -1 to 1
        cy = (point.y - 0.5) * 2.0  # -1 to 1
        
        # Apply inverse of view transform
        world_x = (cx / zoom) - pan_x
        world_y = (cy / zoom) - pan_y
        
        # For 2D views, z is fixed
        if state.view.mode in (ViewMode.TOP, ViewMode.FRONT, ViewMode.SIDE):
            world_z = 0.0
        else:
            # For 3D views, use hand depth (z from landmark)
            world_z = 0.0  # Would need actual depth calculation
        
        return BlueprintPoint(x=world_x, y=world_y, z=world_z)
    
    def pick_component(
        self,
        screen_point: ScreenPoint,
        state: EngineState,
    ) -> str | None:
        """Find component at screen position.
        
        Uses ray-casting against component bounding boxes.
        """
        bp_point = self.screen_to_blueprint(screen_point, state)
        
        # Simple 2D point-in-bounds check
        for node in state.scene.root.traverse():
            if node.bounds and node.component_id:
                # Convert point for current view mode
                if state.view.mode == ViewMode.TOP:
                    test_point = (bp_point.x, bp_point.y, 0)
                else:
                    test_point = (bp_point.x, bp_point.y, bp_point.z)
                
                if node.bounds.contains_point(test_point):
                    return node.component_id
        
        return None
```

---

## Phase 3: New Blueprint Tools

### 3.1 Blueprint Render Tool

**File**: `tools/blueprint_render_tool.py`

```python
"""Tool to render blueprints to display."""

from __future__ import annotations

from typing import Any

from core.base_tool import BaseTool, ToolResult


class BlueprintRenderTool(BaseTool):
    """Tool for rendering blueprints."""
    
    def __init__(self) -> None:
        from core.blueprint.engine import BlueprintEngine
        self._engine = BlueprintEngine()
    
    @property
    def name(self) -> str:
        return "blueprint_render"
    
    @property
    def description(self) -> str:
        return (
            "Render a blueprint for visualization. "
            "Can load from file or render current blueprint. "
            "Supports multiple view modes: top, front, side, isometric, perspective, exploded."
        )
    
    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "blueprint_path": {
                    "type": "string",
                    "description": "Path to .jarvis blueprint file (optional if already loaded)",
                },
                "view_mode": {
                    "type": "string",
                    "enum": ["top", "front", "side", "isometric", "perspective", "exploded"],
                    "description": "View mode for rendering",
                    "default": "isometric",
                },
                "zoom": {
                    "type": "number",
                    "description": "Zoom level (0.1 to 10.0)",
                    "default": 1.0,
                },
                "output": {
                    "type": "string",
                    "enum": ["display", "png", "svg"],
                    "description": "Output destination",
                    "default": "display",
                },
            },
            "required": [],
        }
    
    def execute(self, **kwargs: Any) -> ToolResult:
        from core.blueprint.engine import ViewMode
        from pathlib import Path
        
        blueprint_path = kwargs.get("blueprint_path")
        view_mode = kwargs.get("view_mode", "isometric")
        zoom = kwargs.get("zoom", 1.0)
        output = kwargs.get("output", "display")
        
        try:
            if blueprint_path:
                blueprint = self._engine.load_blueprint(Path(blueprint_path))
            elif not self._engine.blueprint:
                return ToolResult.fail(
                    "No blueprint loaded. Specify blueprint_path or load one first.",
                    error_type="ValidationError",
                )
            else:
                blueprint = self._engine.blueprint
            
            # Set view
            self._engine.set_view_mode(ViewMode(view_mode))
            self._engine.state.view.zoom = zoom
            
            component_count = len(blueprint.components)
            
            return ToolResult.ok_result(
                f"Rendering blueprint '{blueprint.name}' in {view_mode} view.\n"
                f"Components: {component_count}\n"
                f"Zoom: {zoom}x\n"
                f"Output: {output}",
                blueprint_id=blueprint.id,
                component_count=component_count,
            )
            
        except FileNotFoundError:
            return ToolResult.fail(
                f"Blueprint not found: {blueprint_path}",
                error_type="NotFound",
            )
        except Exception as e:
            return ToolResult.fail(
                f"Render failed: {e}",
                error_type="RenderError",
            )
```

### 3.2 Blueprint Edit Tool

**File**: `tools/blueprint_edit_tool.py`

```python
"""Tool for editing blueprint component properties."""

from __future__ import annotations

from typing import Any

from core.base_tool import BaseTool, ToolResult


class BlueprintEditTool(BaseTool):
    """Tool for editing blueprint components."""
    
    def __init__(self) -> None:
        from core.blueprint.engine import BlueprintEngine
        self._engine = BlueprintEngine()
    
    @property
    def name(self) -> str:
        return "blueprint_edit"
    
    @property
    def description(self) -> str:
        return (
            "Edit a blueprint component's properties. "
            "Can modify dimensions, materials, specifications, or any component field."
        )
    
    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "component_id": {
                    "type": "string",
                    "description": "ID of the component to edit",
                },
                "property_path": {
                    "type": "string",
                    "description": "Dot-notation path to property (e.g., 'specifications.dimensions.length')",
                },
                "value": {
                    "description": "New value for the property",
                },
                "action": {
                    "type": "string",
                    "enum": ["set", "add", "remove", "rename"],
                    "description": "Edit action to perform",
                    "default": "set",
                },
            },
            "required": ["component_id", "property_path", "value"],
        }
    
    def execute(self, **kwargs: Any) -> ToolResult:
        component_id = kwargs.get("component_id", "")
        property_path = kwargs.get("property_path", "")
        value = kwargs.get("value")
        action = kwargs.get("action", "set")
        
        if not self._engine.blueprint:
            return ToolResult.fail(
                "No blueprint loaded.",
                error_type="ValidationError",
            )
        
        # Find component
        component = None
        for c in self._engine.blueprint.components:
            if c.id == component_id:
                component = c
                break
        
        if not component:
            return ToolResult.fail(
                f"Component '{component_id}' not found.",
                error_type="NotFound",
            )
        
        # Navigate to property
        try:
            parts = property_path.split(".")
            target = component
            
            for part in parts[:-1]:
                if isinstance(target, dict):
                    target = target[part]
                else:
                    target = getattr(target, part)
            
            final_key = parts[-1]
            
            if action == "set":
                if isinstance(target, dict):
                    target[final_key] = value
                else:
                    setattr(target, final_key, value)
            
            self._engine._state.modified = True
            
            return ToolResult.ok_result(
                f"Updated {component_id}.{property_path} = {value}",
                component_id=component_id,
                property=property_path,
                new_value=value,
            )
            
        except (KeyError, AttributeError) as e:
            return ToolResult.fail(
                f"Property path error: {e}",
                error_type="PropertyError",
            )
```

### 3.3 Gesture Mode Tool

**File**: `tools/gesture_mode_tool.py`

```python
"""Tool for controlling gesture interaction modes."""

from __future__ import annotations

from typing import Any

from core.base_tool import BaseTool, ToolResult


class GestureModeTool(BaseTool):
    """Tool for switching gesture interaction modes."""
    
    @property
    def name(self) -> str:
        return "gesture_mode"
    
    @property
    def description(self) -> str:
        return (
            "Switch gesture interaction mode for blueprint control. "
            "Modes: view (pan/zoom), select (pick components), "
            "transform (move/rotate), edit (modify properties), "
            "measure (distances), annotate (add notes)."
        )
    
    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["view", "select", "transform", "edit", "measure", "annotate"],
                    "description": "Interaction mode to activate",
                },
                "action": {
                    "type": "string",
                    "enum": ["set", "get", "list"],
                    "description": "Action to perform",
                    "default": "set",
                },
            },
            "required": [],
        }
    
    def execute(self, **kwargs: Any) -> ToolResult:
        from core.blueprint.engine import InteractionMode
        
        mode = kwargs.get("mode")
        action = kwargs.get("action", "set")
        
        if action == "list":
            modes = [m.value for m in InteractionMode]
            return ToolResult.ok_result(
                "Available gesture modes:\n" +
                "\n".join(f"• {m}" for m in modes),
                modes=modes,
            )
        
        if action == "get":
            # Would get from actual engine instance
            return ToolResult.ok_result(
                "Current mode: view",
                current_mode="view",
            )
        
        if action == "set" and mode:
            try:
                InteractionMode(mode)
                return ToolResult.ok_result(
                    f"Gesture mode set to: {mode}\n\n"
                    f"Gesture mappings for {mode} mode:\n"
                    f"• ✋ Open Palm: Reset view\n"
                    f"• ✊ Fist: Toggle select\n"
                    f"• 👆 Point: Select component\n"
                    f"• 👍 Thumbs Up: Confirm/Save\n"
                    f"• 👎 Thumbs Down: Undo\n"
                    f"• ✌️ Peace: Cycle view\n"
                    f"• ← → Swipe: Rotate/Navigate\n"
                    f"• ↑ ↓ Swipe: Zoom in/out",
                    mode=mode,
                )
            except ValueError:
                return ToolResult.fail(
                    f"Invalid mode: {mode}",
                    error_type="ValidationError",
                )
        
        return ToolResult.fail(
            "Specify a mode to set.",
            error_type="ValidationError",
        )
```

---

## Phase 4: BlueprintAgent Integration

### 4.1 Extend BlueprintAgent

**Additions to** `core/agents/blueprint_agent.py`:

```python
# Add these methods to BlueprintAgent class

async def generate_from_gesture_description(
    self,
    description: str,
    gesture_context: dict[str, Any] | None = None,
) -> AgentResponse:
    """Generate blueprint from natural language + gesture context.
    
    Args:
        description: What to design.
        gesture_context: Optional gesture data (pointing location, etc.)
    
    Returns:
        AgentResponse with generated blueprint.
    """
    prompt = f"""Design a component based on this description:

DESCRIPTION: {description}
"""
    
    if gesture_context:
        if "position" in gesture_context:
            prompt += f"\nPLACEMENT: {gesture_context['position']}"
        if "size_hint" in gesture_context:
            prompt += f"\nSIZE HINT: {gesture_context['size_hint']}"
    
    prompt += """

Generate a complete .jarvis blueprint component that can be added to an assembly.
Include precise dimensions, materials, and connection points.
"""
    
    return await self.process(prompt)

async def modify_component(
    self,
    component_data: dict[str, Any],
    modification: str,
) -> AgentResponse:
    """Modify an existing component based on instruction.
    
    Args:
        component_data: Current component specification.
        modification: What to change.
    
    Returns:
        AgentResponse with modified component.
    """
    prompt = f"""Modify this component:

CURRENT COMPONENT:
```json
{json.dumps(component_data, indent=2)}
```

MODIFICATION REQUEST: {modification}

Provide the updated component specification with all changes applied.
Maintain compatibility with existing connections.
"""
    
    return await self.process(prompt)

async def suggest_connections(
    self,
    components: list[dict[str, Any]],
) -> AgentResponse:
    """Suggest how components should connect.
    
    Args:
        components: List of components to connect.
    
    Returns:
        AgentResponse with connection suggestions.
    """
    comp_str = json.dumps(components, indent=2)
    
    prompt = f"""Analyze these components and suggest connections:

COMPONENTS:
```json
{comp_str}
```

For each pair of components that should connect, provide:
1. Connection type (bolt, weld, snap, press-fit, etc.)
2. Alignment requirements
3. Fastener specifications if applicable
4. Assembly sequence considerations
```
    
    return await self.process(prompt)
```

---

## Phase 5: Display Rendering

### 5.1 Framebuffer Renderer (Raspberry Pi)

**File**: `core/blueprint/renderer.py`

```python
"""Blueprint renderer for framebuffer display."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray

if TYPE_CHECKING:
    from core.blueprint.engine import EngineState, ViewMode
    from core.blueprint.scene_graph import SceneNode


@dataclass
class RenderConfig:
    """Rendering configuration."""
    width: int = 800
    height: int = 480
    background_color: tuple[int, int, int] = (32, 32, 32)
    grid_color: tuple[int, int, int] = (64, 64, 64)
    component_color: tuple[int, int, int] = (100, 149, 237)
    selected_color: tuple[int, int, int] = (255, 165, 0)
    connection_color: tuple[int, int, int] = (128, 128, 128)
    show_grid: bool = True
    show_axes: bool = True
    antialiasing: bool = True


class BlueprintRenderer:
    """Renders blueprints to framebuffer/image."""
    
    def __init__(self, config: RenderConfig | None = None) -> None:
        self._config = config or RenderConfig()
        self._buffer: NDArray[np.uint8] | None = None
    
    def render(self, state: EngineState) -> NDArray[np.uint8]:
        """Render current state to image buffer.
        
        Returns:
            RGB image as numpy array (H, W, 3).
        """
        # Create buffer
        self._buffer = np.full(
            (self._config.height, self._config.width, 3),
            self._config.background_color,
            dtype=np.uint8,
        )
        
        if self._config.show_grid:
            self._draw_grid(state)
        
        if self._config.show_axes:
            self._draw_axes(state)
        
        # Render components
        for node in state.scene.root.traverse():
            if node.component_id and node.visible:
                self._render_component(node, state)
        
        # Render connections
        if state.blueprint:
            for conn in state.blueprint.connections:
                self._render_connection(conn, state)
        
        # Render UI overlay
        self._render_overlay(state)
        
        return self._buffer
    
    def _draw_grid(self, state: EngineState) -> None:
        """Draw background grid."""
        # Simplified grid drawing
        grid_spacing = int(50 * state.view.zoom)
        if grid_spacing < 10:
            return
        
        for x in range(0, self._config.width, grid_spacing):
            self._buffer[:, x] = self._config.grid_color
        
        for y in range(0, self._config.height, grid_spacing):
            self._buffer[y, :] = self._config.grid_color
    
    def _draw_axes(self, state: EngineState) -> None:
        """Draw coordinate axes."""
        cx = self._config.width // 2
        cy = self._config.height // 2
        
        # X axis (red)
        self._buffer[cy, cx:cx+50] = (255, 0, 0)
        # Y axis (green)
        self._buffer[cy-50:cy, cx] = (0, 255, 0)
    
    def _render_component(self, node: SceneNode, state: EngineState) -> None:
        """Render a single component."""
        # Get screen coordinates
        world_pos = node.get_world_transform().position
        screen_pos = self._world_to_screen(world_pos, state)
        
        x, y = int(screen_pos[0]), int(screen_pos[1])
        
        # Component size based on scale
        scale = node.transform.scale
        size_x = int(scale[0] * 50 * state.view.zoom)
        size_y = int(scale[1] * 50 * state.view.zoom)
        
        # Clamp to buffer
        x1 = max(0, x - size_x // 2)
        x2 = min(self._config.width, x + size_x // 2)
        y1 = max(0, y - size_y // 2)
        y2 = min(self._config.height, y + size_y // 2)
        
        color = self._config.selected_color if node.selected else self._config.component_color
        self._buffer[y1:y2, x1:x2] = color
    
    def _render_connection(self, conn: dict, state: EngineState) -> None:
        """Render connection line between components."""
        # Would draw line between component centers
        pass
    
    def _render_overlay(self, state: EngineState) -> None:
        """Render UI overlay (mode indicator, etc)."""
        # Mode indicator in top-left
        mode_text = state.interaction_mode.value.upper()
        # Would use proper text rendering
        pass
    
    def _world_to_screen(
        self,
        world_pos: tuple[float, float, float],
        state: EngineState,
    ) -> tuple[float, float]:
        """Convert world coordinates to screen coordinates."""
        zoom = state.view.zoom
        pan_x, pan_y = state.view.pan_offset
        
        screen_x = (world_pos[0] + pan_x) * zoom * 100 + self._config.width / 2
        screen_y = (world_pos[1] + pan_y) * zoom * 100 + self._config.height / 2
        
        return (screen_x, screen_y)
```

---

## Phase 6: Tool Registration

### 6.1 Update tools/__init__.py

Add new tools to the registry:

```python
# In tools/__init__.py

from tools.blueprint_render_tool import BlueprintRenderTool
from tools.blueprint_edit_tool import BlueprintEditTool
from tools.blueprint_transform_tool import BlueprintTransformTool
from tools.blueprint_export_tool import BlueprintExportTool
from tools.gesture_mode_tool import GestureModeTool

# Add to AGENT_TOOLS or create BLUEPRINT_TOOLS
BLUEPRINT_TOOLS = [
    BlueprintRenderTool,
    BlueprintEditTool,
    BlueprintTransformTool,
    BlueprintExportTool,
    GestureModeTool,
]
```

---

## Phase 7: Integration Flow

### 7.1 Main Integration Point

**File**: `core/blueprint/__init__.py`

```python
"""Blueprint Engine public API."""

from core.blueprint.engine import BlueprintEngine, InteractionMode, ViewMode
from core.blueprint.parser import Blueprint, BlueprintParser
from core.blueprint.scene_graph import SceneGraph, SceneNode, Transform
from core.blueprint.renderer import BlueprintRenderer, RenderConfig

__all__ = [
    "BlueprintEngine",
    "InteractionMode",
    "ViewMode",
    "Blueprint",
    "BlueprintParser",
    "SceneGraph",
    "SceneNode",
    "Transform",
    "BlueprintRenderer",
    "RenderConfig",
]


async def create_gesture_controlled_engine():
    """Factory to create fully configured gesture-controlled engine."""
    from core.vision import VisionService
    from core.blueprint_gesture.gesture_commands import GestureCommandRegistry
    
    # Create engine
    engine = BlueprintEngine()
    
    # Create vision service
    vision = VisionService()
    
    # Create gesture command registry
    commands = GestureCommandRegistry(engine)
    
    # Wire gesture events to commands
    async def on_gesture(result):
        commands.execute(result)
    
    vision.events.on_any(on_gesture)
    
    return engine, vision
```

---

## Implementation Timeline

| Phase | Task | Dependencies | Time Estimate |
|-------|------|--------------|---------------|
| 1.1 | Blueprint parser & validator | None | 4 hours |
| 1.2 | Scene graph implementation | None | 4 hours |
| 1.3 | Core engine class | 1.1, 1.2 | 6 hours |
| 1.4 | History (undo/redo) | 1.3 | 2 hours |
| **1.5.1** | **Grid & snapping system** | None | 3 hours |
| **1.5.2** | **Geometric primitives** | None | 4 hours |
| **1.5.3** | **Drawing tools** | 1.5.1, 1.5.2 | 5 hours |
| **1.5.4** | **Component library** | 1.5.2 | 3 hours |
| **1.5.5** | **Drawing canvas/layers** | 1.5.2 | 3 hours |
| 2.1 | Gesture command registry | Phase 1, Vision Plan | 4 hours |
| 2.2 | Spatial mapping | 2.1 | 3 hours |
| **2.3** | **Drawing gesture integration** | 1.5, 2.1 | 3 hours |
| 3.1 | Blueprint render tool | Phase 1 | 3 hours |
| 3.2 | Blueprint edit tool | Phase 1 | 2 hours |
| 3.3 | Gesture mode tool | Phase 2 | 2 hours |
| 4.1 | BlueprintAgent extensions | Phase 1 | 3 hours |
| 5.1 | Framebuffer renderer | Phase 1 | 6 hours |
| 6.1 | Tool registration | Phases 1-5 | 1 hour |
| 7.1 | Integration & testing | All | 8 hours |
| **Total** | | | **~67 hours** |

---

## Gesture-Blueprint Command Reference

| Gesture | View Mode | Select Mode | Transform Mode | Edit Mode | Drawing Mode |
|---------|-----------|-------------|----------------|-----------|--------------|
| ✋ Open Palm | Reset view | Clear selection | Cancel transform | Cancel edit | Finish multi-point |
| ✊ Closed Fist | → Select mode | → View mode | Apply transform | Apply edit | Toggle snap |
| 👆 Pointing | - | Pick component | Set pivot point | Edit property | Preview/freehand |
| 👍 Thumbs Up | - | Confirm selection | Confirm transform | Save changes | Commit drawing |
| 👎 Thumbs Down | Undo | Undo | Undo | Undo | Cancel drawing |
| ✌️ Peace | Cycle view mode | Multi-select | Cycle transform axis | - | Cycle tool |
| 👌 OK Sign | → Edit mode | → Edit mode | - | → View mode | Toggle constraint |
| 🤏 Pinch | Zoom | - | Scale | - | **Place point** |
| ← Swipe Left | Rotate view -30° | Previous component | Move left | - | Undo stroke |
| → Swipe Right | Rotate view +30° | Next component | Move right | - | Redo stroke |
| ↑ Swipe Up | Zoom in | - | Move up | - | Increase grid |
| ↓ Swipe Down | Zoom out | - | Move down | - | Decrease grid |

---

## Dependencies

### Python Packages (add to pyproject.toml)

```toml
dependencies = [
    # ... existing ...
    
    # Blueprint Engine
    "pydantic>=2.10.0",         # Schema validation (already present)
    "numpy>=2.0.0",             # Rendering math (already present)
    
    # Vision (from gesture plan)
    "opencv-python-headless>=4.9.0",
    "mediapipe>=0.10.14",
    "picamera2>=0.3.19",
]
```

---

## Testing Strategy

1. **Unit Tests**: Parser, scene graph, transforms
2. **Integration Tests**: Engine + gesture commands
3. **Visual Tests**: Render output verification
4. **E2E Tests**: Full gesture → render pipeline

---

## Future Enhancements

1. **3D Rendering**: OpenGL/Vulkan for true 3D visualization
2. **AR Overlay**: Project blueprint onto physical workspace
3. **Collaborative Editing**: Multi-device sync with conflict resolution
4. **STL Export**: Direct export to 3D printable formats
5. **Voice + Gesture**: Combined voice commands with gesture context
6. **Custom Gestures**: Train user-specific gesture patterns
