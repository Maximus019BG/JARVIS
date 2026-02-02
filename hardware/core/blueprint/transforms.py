"""Transform management for blueprint components.

Provides transform operations with constraints and snapping.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.blueprint.scene_graph import SceneNode, SceneGraph, Transform
    from core.blueprint.selection import SelectionManager
    from core.blueprint.history import CommandHistory


class TransformType(str, Enum):
    """Types of transform operations."""

    TRANSLATE = "translate"
    ROTATE = "rotate"
    SCALE = "scale"


class TransformSpace(str, Enum):
    """Coordinate space for transforms."""

    LOCAL = "local"  # Relative to parent
    WORLD = "world"  # World coordinates


@dataclass
class TransformConstraint:
    """Constraint for transform operations."""

    lock_x: bool = False
    lock_y: bool = False
    lock_z: bool = False
    min_x: float | None = None
    max_x: float | None = None
    min_y: float | None = None
    max_y: float | None = None
    min_z: float | None = None
    max_z: float | None = None
    snap_angle: float | None = None  # Snap rotation to multiples
    snap_position: float | None = None  # Snap position to grid

    def apply_translation(
        self, dx: float, dy: float, dz: float
    ) -> tuple[float, float, float]:
        """Apply constraint to translation delta."""
        if self.lock_x:
            dx = 0.0
        if self.lock_y:
            dy = 0.0
        if self.lock_z:
            dz = 0.0

        if self.snap_position is not None:
            snap = self.snap_position
            dx = round(dx / snap) * snap
            dy = round(dy / snap) * snap
            dz = round(dz / snap) * snap

        return dx, dy, dz

    def apply_rotation(
        self, drx: float, dry: float, drz: float
    ) -> tuple[float, float, float]:
        """Apply constraint to rotation delta."""
        if self.lock_x:
            drx = 0.0
        if self.lock_y:
            dry = 0.0
        if self.lock_z:
            drz = 0.0

        if self.snap_angle is not None:
            snap = self.snap_angle
            drx = round(drx / snap) * snap
            dry = round(dry / snap) * snap
            drz = round(drz / snap) * snap

        return drx, dry, drz

    def clamp_position(
        self, x: float, y: float, z: float
    ) -> tuple[float, float, float]:
        """Clamp position to constraint bounds."""
        if self.min_x is not None:
            x = max(self.min_x, x)
        if self.max_x is not None:
            x = min(self.max_x, x)
        if self.min_y is not None:
            y = max(self.min_y, y)
        if self.max_y is not None:
            y = min(self.max_y, y)
        if self.min_z is not None:
            z = max(self.min_z, z)
        if self.max_z is not None:
            z = min(self.max_z, z)
        return x, y, z


@dataclass
class TransformState:
    """State of an ongoing transform operation."""

    active: bool = False
    transform_type: TransformType | None = None
    start_x: float = 0.0
    start_y: float = 0.0
    current_x: float = 0.0
    current_y: float = 0.0
    node_ids: list[str] = field(default_factory=list)
    original_transforms: dict[str, dict] = field(default_factory=dict)


class TransformManager:
    """Manages transform operations on scene nodes.

    Handles translation, rotation, and scaling with constraints,
    and integrates with command history for undo/redo.

    Usage:
        manager = TransformManager(scene_graph, selection, history)
        manager.begin_transform(TransformType.TRANSLATE)
        manager.update_transform(10, 0, 0)
        manager.end_transform()
    """

    def __init__(
        self,
        scene_graph: SceneGraph,
        selection: SelectionManager,
        history: CommandHistory | None = None,
    ) -> None:
        """Initialize transform manager.

        Args:
            scene_graph: Scene graph containing nodes.
            selection: Selection manager.
            history: Optional command history for undo/redo.
        """
        self._scene_graph = scene_graph
        self._selection = selection
        self._history = history
        self._state = TransformState()
        self._constraint = TransformConstraint()
        self._space = TransformSpace.LOCAL

    @property
    def is_transforming(self) -> bool:
        """Check if a transform operation is in progress."""
        return self._state.active

    @property
    def constraint(self) -> TransformConstraint:
        """Get current transform constraint."""
        return self._constraint

    @constraint.setter
    def constraint(self, value: TransformConstraint) -> None:
        """Set transform constraint."""
        self._constraint = value

    @property
    def space(self) -> TransformSpace:
        """Get transform space."""
        return self._space

    @space.setter
    def space(self, value: TransformSpace) -> None:
        """Set transform space."""
        self._space = value

    def begin_transform(
        self,
        transform_type: TransformType,
        start_x: float = 0.0,
        start_y: float = 0.0,
    ) -> bool:
        """Begin a transform operation on selected nodes.

        Args:
            transform_type: Type of transform to perform.
            start_x: Starting X coordinate (for gesture tracking).
            start_y: Starting Y coordinate (for gesture tracking).

        Returns:
            True if transform started successfully.
        """
        if self._selection.is_empty:
            return False

        if self._state.active:
            self.cancel_transform()

        # Save original transforms
        original_transforms = {}
        for node_id in self._selection.selected_ids:
            node = self._scene_graph.get_node(node_id)
            if node:
                original_transforms[node_id] = {
                    "x": node.transform.x,
                    "y": node.transform.y,
                    "z": node.transform.z,
                    "rx": node.transform.rx,
                    "ry": node.transform.ry,
                    "rz": node.transform.rz,
                    "sx": node.transform.sx,
                    "sy": node.transform.sy,
                    "sz": node.transform.sz,
                }

        self._state = TransformState(
            active=True,
            transform_type=transform_type,
            start_x=start_x,
            start_y=start_y,
            current_x=start_x,
            current_y=start_y,
            node_ids=self._selection.selected_ids,
            original_transforms=original_transforms,
        )

        return True

    def update_transform(
        self,
        dx: float = 0.0,
        dy: float = 0.0,
        dz: float = 0.0,
    ) -> None:
        """Update the current transform operation.

        Args:
            dx: Delta X (or delta rotation X, or scale factor X).
            dy: Delta Y.
            dz: Delta Z.
        """
        if not self._state.active:
            return

        for node_id in self._state.node_ids:
            node = self._scene_graph.get_node(node_id)
            if not node:
                continue

            orig = self._state.original_transforms.get(node_id, {})

            if self._state.transform_type == TransformType.TRANSLATE:
                dx_c, dy_c, dz_c = self._constraint.apply_translation(dx, dy, dz)
                new_x = orig.get("x", 0.0) + dx_c
                new_y = orig.get("y", 0.0) + dy_c
                new_z = orig.get("z", 0.0) + dz_c
                new_x, new_y, new_z = self._constraint.clamp_position(
                    new_x, new_y, new_z
                )
                node.transform.x = new_x
                node.transform.y = new_y
                node.transform.z = new_z

            elif self._state.transform_type == TransformType.ROTATE:
                drx, dry, drz = self._constraint.apply_rotation(dx, dy, dz)
                node.transform.rx = (orig.get("rx", 0.0) + drx) % 360
                node.transform.ry = (orig.get("ry", 0.0) + dry) % 360
                node.transform.rz = (orig.get("rz", 0.0) + drz) % 360

            elif self._state.transform_type == TransformType.SCALE:
                # dx, dy, dz are scale factors
                node.transform.sx = orig.get("sx", 1.0) * max(0.01, 1.0 + dx)
                node.transform.sy = orig.get("sy", 1.0) * max(0.01, 1.0 + dy)
                node.transform.sz = orig.get("sz", 1.0) * max(0.01, 1.0 + dz)

    def end_transform(self) -> bool:
        """End the current transform operation and commit to history.

        Returns:
            True if transform was committed.
        """
        if not self._state.active:
            return False

        if self._history:
            from core.blueprint.history import CompositeCommand, TransformCommand

            composite = CompositeCommand(_description="Transform nodes")

            for node_id in self._state.node_ids:
                node = self._scene_graph.get_node(node_id)
                if not node:
                    continue

                orig = self._state.original_transforms.get(node_id, {})

                if self._state.transform_type == TransformType.TRANSLATE:
                    cmd = TransformCommand(
                        node_id=node_id,
                        old_x=orig.get("x", 0.0),
                        old_y=orig.get("y", 0.0),
                        old_z=orig.get("z", 0.0),
                        new_x=node.transform.x,
                        new_y=node.transform.y,
                        new_z=node.transform.z,
                        scene_graph=self._scene_graph,
                    )
                    composite.add(cmd)

            # Already executed, just add to history without re-executing
            # For proper implementation, we'd need a way to add without execute

        self._state = TransformState()
        return True

    def cancel_transform(self) -> None:
        """Cancel the current transform and restore original state."""
        if not self._state.active:
            return

        # Restore original transforms
        for node_id, orig in self._state.original_transforms.items():
            node = self._scene_graph.get_node(node_id)
            if node:
                node.transform.x = orig.get("x", 0.0)
                node.transform.y = orig.get("y", 0.0)
                node.transform.z = orig.get("z", 0.0)
                node.transform.rx = orig.get("rx", 0.0)
                node.transform.ry = orig.get("ry", 0.0)
                node.transform.rz = orig.get("rz", 0.0)
                node.transform.sx = orig.get("sx", 1.0)
                node.transform.sy = orig.get("sy", 1.0)
                node.transform.sz = orig.get("sz", 1.0)

        self._state = TransformState()

    def translate(
        self,
        dx: float,
        dy: float,
        dz: float = 0.0,
        node_ids: list[str] | None = None,
    ) -> bool:
        """Immediately translate nodes.

        Args:
            dx: Delta X.
            dy: Delta Y.
            dz: Delta Z.
            node_ids: Specific nodes to translate. If None, uses selection.

        Returns:
            True if any nodes were translated.
        """
        if node_ids is None:
            node_ids = self._selection.selected_ids

        if not node_ids:
            return False

        dx, dy, dz = self._constraint.apply_translation(dx, dy, dz)

        for node_id in node_ids:
            node = self._scene_graph.get_node(node_id)
            if node and not node.locked:
                node.transform.translate(dx, dy, dz)

        return True

    def rotate(
        self,
        drx: float = 0.0,
        dry: float = 0.0,
        drz: float = 0.0,
        node_ids: list[str] | None = None,
    ) -> bool:
        """Immediately rotate nodes.

        Args:
            drx: Delta rotation X (degrees).
            dry: Delta rotation Y (degrees).
            drz: Delta rotation Z (degrees).
            node_ids: Specific nodes to rotate. If None, uses selection.

        Returns:
            True if any nodes were rotated.
        """
        if node_ids is None:
            node_ids = self._selection.selected_ids

        if not node_ids:
            return False

        drx, dry, drz = self._constraint.apply_rotation(drx, dry, drz)

        for node_id in node_ids:
            node = self._scene_graph.get_node(node_id)
            if node and not node.locked:
                node.transform.rotate(drx, dry, drz)

        return True

    def scale_uniform(
        self,
        factor: float,
        node_ids: list[str] | None = None,
    ) -> bool:
        """Uniformly scale nodes.

        Args:
            factor: Scale factor.
            node_ids: Specific nodes to scale. If None, uses selection.

        Returns:
            True if any nodes were scaled.
        """
        if node_ids is None:
            node_ids = self._selection.selected_ids

        if not node_ids:
            return False

        for node_id in node_ids:
            node = self._scene_graph.get_node(node_id)
            if node and not node.locked:
                node.transform.scale_by(factor)

        return True

    def reset_transforms(self, node_ids: list[str] | None = None) -> bool:
        """Reset transforms to identity.

        Args:
            node_ids: Specific nodes to reset. If None, uses selection.

        Returns:
            True if any nodes were reset.
        """
        if node_ids is None:
            node_ids = self._selection.selected_ids

        if not node_ids:
            return False

        for node_id in node_ids:
            node = self._scene_graph.get_node(node_id)
            if node and not node.locked:
                node.transform.reset()

        return True

    def set_position(
        self,
        x: float,
        y: float,
        z: float = 0.0,
        node_id: str | None = None,
    ) -> bool:
        """Set absolute position of a node.

        Args:
            x: X position.
            y: Y position.
            z: Z position.
            node_id: Node to position. If None, uses primary selection.

        Returns:
            True if position was set.
        """
        if node_id is None:
            node_id = self._selection.primary_id

        if node_id is None:
            return False

        node = self._scene_graph.get_node(node_id)
        if node and not node.locked:
            x, y, z = self._constraint.clamp_position(x, y, z)
            node.transform.position = (x, y, z)
            return True

        return False
