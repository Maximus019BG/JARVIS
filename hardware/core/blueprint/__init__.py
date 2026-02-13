"""Blueprint Engine - Renders, manipulates, and updates .jarvis blueprints.

This module provides a complete blueprint engine with:
- Blueprint parsing and validation
- Scene graph for component hierarchy
- 2D/3D rendering pipeline
- Undo/redo history
- Gesture-based interaction
- Drawing tools

Usage:
    from core.blueprint import BlueprintEngine, Blueprint

    engine = BlueprintEngine()
    await engine.load("my_design.jarvis")
    engine.select_component("part_001")
    engine.transform_selection(translate=(10, 0, 0))
"""

from __future__ import annotations

from core.blueprint.parser import (
    Blueprint,
    BlueprintParser,
    BlueprintType,
    Dimension,
    Material,
    ComponentSpec,
    Connection,
)
from core.blueprint.scene_graph import (
    SceneGraph,
    SceneNode,
    Transform,
    BoundingBox,
)
from core.blueprint.engine import (
    BlueprintEngine,
    EngineState,
    InteractionMode,
    ViewMode,
    ViewState,
)
from core.blueprint.history import (
    CommandHistory,
    Command,
)
from core.blueprint.selection import (
    SelectionManager,
    SelectionMode,
)
from core.blueprint.transforms import (
    TransformManager,
    TransformType,
)

__all__ = [
    # Parser
    "Blueprint",
    "BlueprintParser",
    "BlueprintType",
    "Dimension",
    "Material",
    "ComponentSpec",
    "Connection",
    # Scene Graph
    "SceneGraph",
    "SceneNode",
    "Transform",
    "BoundingBox",
    # Engine
    "BlueprintEngine",
    "EngineState",
    "InteractionMode",
    "ViewMode",
    "ViewState",
    # History
    "CommandHistory",
    "Command",
    # Selection
    "SelectionManager",
    "SelectionMode",
    # Transforms
    "TransformManager",
    "TransformType",
]
