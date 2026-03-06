"""Core Blueprint Engine - manages blueprint state, rendering, and interactions.

The main orchestration module for the blueprint system.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any, Callable, TYPE_CHECKING

from app_logging.logger import get_logger
from core.blueprint.parser import Blueprint, BlueprintParser, BlueprintType, ComponentSpec
from core.blueprint.scene_graph import SceneGraph, SceneNode, Transform, BoundingBox
from core.blueprint.history import CommandHistory
from core.blueprint.selection import SelectionManager, SelectionMode
from core.blueprint.transforms import TransformManager, TransformType

if TYPE_CHECKING:
    pass

logger = get_logger(__name__)


class InteractionMode(str, Enum):
    """Current interaction mode for the engine."""

    SELECT = "select"  # Select and manipulate components
    PAN = "pan"  # Pan the view
    ZOOM = "zoom"  # Zoom the view
    ROTATE_VIEW = "rotate_view"  # Rotate 3D view
    TRANSLATE = "translate"  # Move selected components
    ROTATE = "rotate"  # Rotate selected components
    SCALE = "scale"  # Scale selected components
    DRAW_LINE = "draw_line"  # Draw line primitive
    DRAW_RECT = "draw_rect"  # Draw rectangle
    DRAW_CIRCLE = "draw_circle"  # Draw circle
    DRAW_POLYGON = "draw_polygon"  # Draw polygon
    DRAW_FREEHAND = "draw_freehand"  # Freehand drawing
    COMPONENT = "component"  # Place component from library


class ViewMode(str, Enum):
    """Rendering view mode."""

    TOP_2D = "top_2d"  # Top-down 2D view
    FRONT_2D = "front_2d"  # Front 2D view
    SIDE_2D = "side_2d"  # Side 2D view
    ISO_3D = "iso_3d"  # Isometric 3D view
    PERSPECTIVE = "perspective"  # Perspective 3D view
    EXPLODED = "exploded"  # Exploded assembly view


@dataclass
class ViewState:
    """Current view state - pan, zoom, rotation."""

    pan_x: float = 0.0
    pan_y: float = 0.0
    zoom: float = 1.0
    rotation: tuple[float, float, float] = (30.0, -45.0, 0.0)  # For 3D views
    view_mode: ViewMode = ViewMode.TOP_2D

    def pan(self, dx: float, dy: float) -> None:
        """Pan the view by delta."""
        self.pan_x += dx
        self.pan_y += dy

    def zoom_by(self, factor: float) -> None:
        """Zoom by factor (>1 zoom in, <1 zoom out)."""
        self.zoom = max(0.1, min(10.0, self.zoom * factor))

    def zoom_to(self, level: float) -> None:
        """Set absolute zoom level."""
        self.zoom = max(0.1, min(10.0, level))

    def reset(self) -> None:
        """Reset view to default."""
        self.pan_x = 0.0
        self.pan_y = 0.0
        self.zoom = 1.0
        self.rotation = (30.0, -45.0, 0.0)

    def screen_to_world(self, sx: float, sy: float) -> tuple[float, float]:
        """Convert screen coordinates to world coordinates.

        Args:
            sx: Screen X (0-1 normalized).
            sy: Screen Y (0-1 normalized).

        Returns:
            World coordinates (x, y).
        """
        # Assuming 1000x1000 base viewport
        world_x = (sx * 1000 - 500) / self.zoom - self.pan_x
        world_y = (sy * 1000 - 500) / self.zoom - self.pan_y
        return world_x, world_y

    def world_to_screen(self, wx: float, wy: float) -> tuple[float, float]:
        """Convert world coordinates to screen coordinates.

        Args:
            wx: World X.
            wy: World Y.

        Returns:
            Screen coordinates (0-1 normalized).
        """
        screen_x = ((wx + self.pan_x) * self.zoom + 500) / 1000
        screen_y = ((wy + self.pan_y) * self.zoom + 500) / 1000
        return screen_x, screen_y


@dataclass
class EngineState:
    """Complete engine state."""

    blueprint: Blueprint | None = None
    file_path: Path | None = None
    modified: bool = False
    interaction_mode: InteractionMode = InteractionMode.SELECT
    grid_enabled: bool = True
    snap_enabled: bool = True
    grid_size: float = 10.0  # Grid spacing in blueprint units


EngineEventHandler = Callable[["BlueprintEngine", str, Any], None]


class BlueprintEngine:
    """Main Blueprint Engine class.

    Manages blueprint loading, scene graph, selection, transforms,
    and provides the interface for gesture-based interaction.

    Usage:
        engine = BlueprintEngine()
        await engine.load("design.jarvis")
        engine.select_component("part_001")
        engine.set_mode(InteractionMode.TRANSLATE)
        engine.transform_selection(dx=10, dy=0)
    """

    def __init__(self, blueprint_dir: str = "data/blueprints") -> None:
        """Initialize the blueprint engine.

        Args:
            blueprint_dir: Directory for blueprint files.
        """
        self._blueprint_dir = Path(blueprint_dir)
        self._blueprint_dir.mkdir(parents=True, exist_ok=True)

        self._parser = BlueprintParser()
        self._state = EngineState()
        self._view = ViewState()
        self._scene = SceneGraph()
        self._history = CommandHistory(max_size=100)
        self._selection = SelectionManager(self._scene)
        self._transforms = TransformManager(self._scene, self._selection, self._history)

        self._event_handlers: dict[str, list[EngineEventHandler]] = {}

        logger.info("Blueprint engine initialized")

    # ---- Properties ----

    @property
    def state(self) -> EngineState:
        """Get current engine state."""
        return self._state

    @property
    def view(self) -> ViewState:
        """Get current view state."""
        return self._view

    @property
    def scene(self) -> SceneGraph:
        """Get scene graph."""
        return self._scene

    @property
    def selection(self) -> SelectionManager:
        """Get selection manager."""
        return self._selection

    @property
    def transforms(self) -> TransformManager:
        """Get transform manager."""
        return self._transforms

    @property
    def history(self) -> CommandHistory:
        """Get command history."""
        return self._history

    @property
    def blueprint(self) -> Blueprint | None:
        """Get current blueprint."""
        return self._state.blueprint

    @property
    def is_modified(self) -> bool:
        """Check if blueprint has unsaved changes."""
        return self._state.modified

    @property
    def mode(self) -> InteractionMode:
        """Get current interaction mode."""
        return self._state.interaction_mode

    # ---- Blueprint Operations ----

    async def load(self, path: str | Path) -> bool:
        """Load a blueprint from file.

        Args:
            path: Path to .jarvis file.

        Returns:
            True if loaded successfully.
        """
        try:
            path = Path(path)
            if not path.is_absolute():
                # If path already exists relative to cwd, use it as-is;
                # otherwise prepend the blueprint directory.
                if not path.exists():
                    candidate = self._blueprint_dir / path
                    if candidate.exists():
                        path = candidate
                    else:
                        # Try just the filename in blueprint_dir
                        path = self._blueprint_dir / path.name

            blueprint = self._parser.load(path)
            self._state.blueprint = blueprint
            self._state.file_path = path
            self._state.modified = False

            self._build_scene_from_blueprint(blueprint)
            self._emit("blueprint_loaded", {"path": str(path)})

            logger.info(f"Loaded blueprint: {path}")
            return True

        except Exception as e:
            logger.error(f"Failed to load blueprint: {e}")
            self._emit("error", {"message": str(e)})
            return False

    async def save(self, path: str | Path | None = None) -> bool:
        """Save the current blueprint.

        Args:
            path: Optional path. If None, saves to original path.

        Returns:
            True if saved successfully.
        """
        if self._state.blueprint is None:
            logger.warning("No blueprint to save")
            return False

        try:
            save_path = Path(path) if path else self._state.file_path
            if save_path is None:
                save_path = self._blueprint_dir / f"{self._state.blueprint.name}.jarvis"

            if not save_path.is_absolute():
                save_path = self._blueprint_dir / save_path

            # Update blueprint from scene graph
            self._update_blueprint_from_scene()

            self._parser.save(self._state.blueprint, save_path)
            self._state.file_path = save_path
            self._state.modified = False

            self._emit("blueprint_saved", {"path": str(save_path)})
            logger.info(f"Saved blueprint: {save_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to save blueprint: {e}")
            self._emit("error", {"message": str(e)})
            return False

    def new_blueprint(
        self, name: str, bp_type: BlueprintType = BlueprintType.PART
    ) -> Blueprint:
        """Create a new empty blueprint.

        Args:
            name: Blueprint name.
            bp_type: Blueprint type.

        Returns:
            New Blueprint instance.
        """
        blueprint = self._parser.create_empty(name, bp_type)
        self._state.blueprint = blueprint
        self._state.file_path = None
        self._state.modified = True

        self._scene.clear()
        self._selection.clear()
        self._history.clear()

        self._emit("blueprint_created", {"name": name, "type": bp_type.value})
        logger.info(f"Created new blueprint: {name}")
        return blueprint

    # ---- Mode Management ----

    def set_mode(self, mode: InteractionMode) -> None:
        """Set the interaction mode.

        Args:
            mode: New interaction mode.
        """
        old_mode = self._state.interaction_mode
        self._state.interaction_mode = mode
        self._emit("mode_changed", {"old": old_mode.value, "new": mode.value})

    def toggle_grid(self) -> bool:
        """Toggle grid display. Returns new state."""
        self._state.grid_enabled = not self._state.grid_enabled
        self._emit("grid_toggled", {"enabled": self._state.grid_enabled})
        return self._state.grid_enabled

    def toggle_snap(self) -> bool:
        """Toggle snap to grid. Returns new state."""
        self._state.snap_enabled = not self._state.snap_enabled
        self._transforms.constraint.snap_position = (
            self._state.grid_size if self._state.snap_enabled else None
        )
        self._emit("snap_toggled", {"enabled": self._state.snap_enabled})
        return self._state.snap_enabled

    # ---- Selection Operations ----

    def select_component(
        self, component_id: str, mode: SelectionMode = SelectionMode.REPLACE
    ) -> bool:
        """Select a component by ID.

        Args:
            component_id: Component ID to select.
            mode: Selection mode.

        Returns:
            True if component was found and selected.
        """
        node = self._scene.get_node_by_component(component_id)
        if node:
            self._selection.select(node.id, mode)
            return True
        return False

    def select_at_point(
        self, x: float, y: float, mode: SelectionMode = SelectionMode.REPLACE
    ) -> list[str]:
        """Select component(s) at a screen point.

        Args:
            x: Screen X (0-1 normalized).
            y: Screen Y (0-1 normalized).
            mode: Selection mode.

        Returns:
            List of selected component IDs.
        """
        world_x, world_y = self._view.screen_to_world(x, y)
        hits = self._scene.find_at_point(world_x, world_y)

        if hits:
            self._selection.select(hits[0].id, mode)
            return [h.component_id for h in hits if h.component_id]
        elif mode == SelectionMode.REPLACE:
            self._selection.clear()

        return []

    # ---- Transform Operations ----

    def transform_selection(
        self,
        dx: float = 0.0,
        dy: float = 0.0,
        dz: float = 0.0,
    ) -> bool:
        """Transform selected components based on current mode.

        Args:
            dx: Delta X or rotation X or scale factor X.
            dy: Delta Y.
            dz: Delta Z.

        Returns:
            True if transform was applied.
        """
        if self._selection.is_empty:
            return False

        mode = self._state.interaction_mode
        result = False

        if mode == InteractionMode.TRANSLATE:
            result = self._transforms.translate(dx, dy, dz)
        elif mode == InteractionMode.ROTATE:
            result = self._transforms.rotate(dx, dy, dz)
        elif mode == InteractionMode.SCALE:
            result = self._transforms.scale_uniform(1.0 + dx)

        if result:
            self._state.modified = True
            self._emit("transform_applied", {
                "mode": mode.value,
                "delta": (dx, dy, dz),
            })

        return result

    def begin_interactive_transform(
        self, transform_type: TransformType, x: float, y: float
    ) -> bool:
        """Begin an interactive transform (for gesture tracking).

        Args:
            transform_type: Type of transform.
            x: Starting screen X.
            y: Starting screen Y.

        Returns:
            True if transform started.
        """
        return self._transforms.begin_transform(transform_type, x, y)

    def update_interactive_transform(
        self, dx: float, dy: float, dz: float = 0.0
    ) -> None:
        """Update an ongoing interactive transform."""
        self._transforms.update_transform(dx, dy, dz)

    def end_interactive_transform(self) -> bool:
        """End an interactive transform."""
        result = self._transforms.end_transform()
        if result:
            self._state.modified = True
        return result

    def cancel_interactive_transform(self) -> None:
        """Cancel an ongoing interactive transform."""
        self._transforms.cancel_transform()

    # ---- View Operations ----

    def pan_view(self, dx: float, dy: float) -> None:
        """Pan the view.

        Args:
            dx: Delta X in screen space.
            dy: Delta Y in screen space.
        """
        self._view.pan(dx / self._view.zoom, dy / self._view.zoom)
        self._emit("view_changed", {"type": "pan"})

    def zoom_view(self, factor: float, center_x: float = 0.5, center_y: float = 0.5) -> None:
        """Zoom the view.

        Args:
            factor: Zoom factor (>1 zoom in, <1 zoom out).
            center_x: Zoom center X (0-1).
            center_y: Zoom center Y (0-1).
        """
        self._view.zoom_by(factor)
        self._emit("view_changed", {"type": "zoom", "level": self._view.zoom})

    def fit_view(self) -> None:
        """Fit view to show all components."""
        bounds = self._scene.compute_bounds()
        if bounds.width > 0 and bounds.height > 0:
            # Calculate zoom to fit
            viewport_size = 1000  # Assume 1000x1000 viewport
            zoom_x = viewport_size / (bounds.width * 1.2)  # 20% margin
            zoom_y = viewport_size / (bounds.height * 1.2)
            self._view.zoom = min(zoom_x, zoom_y, 2.0)

            # Center on bounds
            center = bounds.center
            self._view.pan_x = -center[0]
            self._view.pan_y = -center[1]

        self._emit("view_changed", {"type": "fit"})

    def reset_view(self) -> None:
        """Reset view to default."""
        self._view.reset()
        self._emit("view_changed", {"type": "reset"})

    # ---- Undo/Redo ----

    def undo(self) -> bool:
        """Undo last action."""
        result = self._history.undo()
        if result:
            self._state.modified = True
            self._emit("undo", {"description": self._history.redo_description})
        return result

    def redo(self) -> bool:
        """Redo last undone action."""
        result = self._history.redo()
        if result:
            self._state.modified = True
            self._emit("redo", {"description": self._history.undo_description})
        return result

    # ---- Component Operations ----

    def add_component(
        self,
        name: str,
        component_type: str = "generic",
        position: tuple[float, float, float] = (0.0, 0.0, 0.0),
        dimensions: tuple[float, float, float] | None = None,
    ) -> str | None:
        """Add a new component to the blueprint.

        Args:
            name: Component name.
            component_type: Type of component.
            position: Initial position.
            dimensions: Optional dimensions (w, h, d).

        Returns:
            Component ID if created, None on failure.
        """
        if self._state.blueprint is None:
            self.new_blueprint("Untitled")

        from datetime import datetime
        import uuid

        component_id = f"comp_{uuid.uuid4().hex[:8]}"

        # Create component spec
        from core.blueprint.parser import Dimension

        dim = None
        if dimensions:
            dim = Dimension(
                length=dimensions[0],
                width=dimensions[1],
                height=dimensions[2],
            )

        component = ComponentSpec(
            id=component_id,
            name=name,
            type=component_type,
            position=position,
            dimensions=dim,
        )

        self._state.blueprint.add_component(component)

        # Add to scene graph
        bounds = BoundingBox.from_dimensions(
            dimensions[0] if dimensions else 50,
            dimensions[1] if dimensions else 50,
            dimensions[2] if dimensions else 0,
            center=True,
        )

        node = self._scene.create_node(
            component_id=component_id,
            name=name,
            bounds=bounds,
        )
        node.transform.position = position
        self._scene.add_node(node)

        self._state.modified = True
        self._emit("component_added", {"id": component_id, "name": name})

        return component_id

    def remove_component(self, component_id: str) -> bool:
        """Remove a component from the blueprint.

        Args:
            component_id: Component ID to remove.

        Returns:
            True if removed.
        """
        if self._state.blueprint is None:
            return False

        # Remove from blueprint
        if not self._state.blueprint.remove_component(component_id):
            return False

        # Remove from scene graph
        node = self._scene.get_node_by_component(component_id)
        if node:
            self._scene.remove_node(node.id)

        # Clear selection if removed component was selected
        if node and self._selection.is_selected(node.id):
            self._selection.deselect(node.id)

        self._state.modified = True
        self._emit("component_removed", {"id": component_id})

        return True

    def delete_selected(self) -> int:
        """Delete all selected components.

        Returns:
            Number of components deleted.
        """
        deleted = 0
        for node_id in list(self._selection.selected_ids):
            node = self._scene.get_node(node_id)
            if node and node.component_id:
                if self.remove_component(node.component_id):
                    deleted += 1

        return deleted

    # ---- Event System ----

    def on(self, event_name: str, handler: EngineEventHandler) -> None:
        """Register an event handler.

        Args:
            event_name: Event name to listen for.
            handler: Handler function.
        """
        if event_name not in self._event_handlers:
            self._event_handlers[event_name] = []
        self._event_handlers[event_name].append(handler)

    def off(self, event_name: str, handler: EngineEventHandler) -> None:
        """Unregister an event handler.

        Args:
            event_name: Event name.
            handler: Handler to remove.
        """
        if event_name in self._event_handlers:
            if handler in self._event_handlers[event_name]:
                self._event_handlers[event_name].remove(handler)

    def _emit(self, event_name: str, data: Any = None) -> None:
        """Emit an event to all registered handlers."""
        if event_name in self._event_handlers:
            for handler in self._event_handlers[event_name]:
                try:
                    handler(self, event_name, data)
                except Exception as e:
                    logger.error(f"Event handler error: {e}")

    # ---- Internal Methods ----

    def _build_scene_from_blueprint(self, blueprint: Blueprint) -> None:
        """Build scene graph from blueprint components."""
        self._scene.clear()
        self._selection.clear()
        self._history.clear()

        for component in blueprint.components:
            # Create bounding box from dimensions
            if component.dimensions:
                bounds = BoundingBox.from_dimensions(
                    component.dimensions.length,
                    component.dimensions.width,
                    component.dimensions.height,
                    center=True,
                )
            else:
                bounds = BoundingBox.from_dimensions(50, 50, 0, center=True)

            node = self._scene.create_node(
                component_id=component.id,
                name=component.name,
                bounds=bounds,
            )

            # Set transform from component
            node.transform.position = component.position
            node.transform.rotation = component.rotation

            self._scene.add_node(node)

        # Handle parent-child relationships
        for component in blueprint.components:
            if component.children:
                parent_node = self._scene.get_node_by_component(component.id)
                if parent_node:
                    for child_id in component.children:
                        child_node = self._scene.get_node_by_component(child_id)
                        if child_node:
                            self._scene.move_node(child_node.id, parent_node.id)

    def _update_blueprint_from_scene(self) -> None:
        """Update blueprint components from scene graph state."""
        if self._state.blueprint is None:
            return

        for component in self._state.blueprint.components:
            node = self._scene.get_node_by_component(component.id)
            if node:
                component.position = node.transform.position
                component.rotation = node.transform.rotation

    def get_status(self) -> dict[str, Any]:
        """Get current engine status for display/debugging."""
        return {
            "blueprint": self._state.blueprint.name if self._state.blueprint else None,
            "file_path": str(self._state.file_path) if self._state.file_path else None,
            "modified": self._state.modified,
            "mode": self._state.interaction_mode.value,
            "view_mode": self._view.view_mode.value,
            "zoom": self._view.zoom,
            "grid_enabled": self._state.grid_enabled,
            "snap_enabled": self._state.snap_enabled,
            "selection_count": self._selection.count,
            "component_count": self._scene.node_count() - 1,  # Exclude root
            "can_undo": self._history.can_undo,
            "can_redo": self._history.can_redo,
        }
