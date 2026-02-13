"""Drawing canvas with layer management.

Provides a canvas for organizing primitives into layers.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Iterator

from core.blueprint.drawing.primitives import Primitive, Point2D


@dataclass
class Layer:
    """A drawing layer containing primitives.

    Layers allow organizing drawing elements with independent
    visibility, locking, and styling.
    """

    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = "Layer"
    visible: bool = True
    locked: bool = False
    opacity: float = 1.0
    primitives: list[Primitive] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def add(self, primitive: Primitive) -> None:
        """Add a primitive to this layer."""
        self.primitives.append(primitive)

    def remove(self, primitive_id: str) -> bool:
        """Remove a primitive by ID. Returns True if removed."""
        for i, prim in enumerate(self.primitives):
            if prim.id == primitive_id:
                self.primitives.pop(i)
                return True
        return False

    def get(self, primitive_id: str) -> Primitive | None:
        """Get a primitive by ID."""
        for prim in self.primitives:
            if prim.id == primitive_id:
                return prim
        return None

    def clear(self) -> None:
        """Remove all primitives from this layer."""
        self.primitives.clear()

    def iter_visible(self) -> Iterator[Primitive]:
        """Iterate over visible primitives."""
        if not self.visible:
            return
        for prim in self.primitives:
            if prim.visible:
                yield prim

    def find_at_point(self, point: Point2D, tolerance: float = 5.0) -> list[Primitive]:
        """Find primitives at a point."""
        hits = []
        if not self.visible:
            return hits
        for prim in self.primitives:
            if prim.visible and not prim.locked:
                if prim.contains_point(point, tolerance):
                    hits.append(prim)
        return hits

    @property
    def count(self) -> int:
        """Number of primitives in this layer."""
        return len(self.primitives)

    def to_dict(self) -> dict[str, Any]:
        """Serialize layer to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "visible": self.visible,
            "locked": self.locked,
            "opacity": self.opacity,
            "primitives": [p.to_dict() for p in self.primitives],
            "metadata": self.metadata,
        }


class DrawingCanvas:
    """Canvas for blueprint drawing with layers.

    Manages multiple layers of primitives with support for
    layer ordering, visibility, and primitive operations.

    Usage:
        canvas = DrawingCanvas()
        canvas.add_layer("Components")
        canvas.add_primitive(Line(...))
        hits = canvas.find_at_point(Point2D(100, 100))
    """

    def __init__(self) -> None:
        """Initialize canvas with default layer."""
        self._layers: list[Layer] = []
        self._active_layer_id: str | None = None

        # Create default layer
        default = Layer(name="Default")
        self._layers.append(default)
        self._active_layer_id = default.id

    @property
    def layers(self) -> list[Layer]:
        """Get all layers (bottom to top order)."""
        return self._layers.copy()

    @property
    def active_layer(self) -> Layer | None:
        """Get the active layer."""
        return self.get_layer(self._active_layer_id) if self._active_layer_id else None

    @property
    def layer_count(self) -> int:
        """Get number of layers."""
        return len(self._layers)

    def add_layer(self, name: str, index: int | None = None) -> Layer:
        """Add a new layer.

        Args:
            name: Layer name.
            index: Optional position to insert. None = top.

        Returns:
            The new layer.
        """
        layer = Layer(name=name)
        if index is None:
            self._layers.append(layer)
        else:
            self._layers.insert(index, layer)
        return layer

    def remove_layer(self, layer_id: str) -> bool:
        """Remove a layer by ID.

        Args:
            layer_id: ID of layer to remove.

        Returns:
            True if removed.
        """
        if len(self._layers) <= 1:
            return False  # Keep at least one layer

        for i, layer in enumerate(self._layers):
            if layer.id == layer_id:
                self._layers.pop(i)
                if self._active_layer_id == layer_id:
                    self._active_layer_id = self._layers[0].id if self._layers else None
                return True
        return False

    def get_layer(self, layer_id: str) -> Layer | None:
        """Get a layer by ID."""
        for layer in self._layers:
            if layer.id == layer_id:
                return layer
        return None

    def get_layer_by_name(self, name: str) -> Layer | None:
        """Get a layer by name."""
        for layer in self._layers:
            if layer.name == name:
                return layer
        return None

    def set_active_layer(self, layer_id: str) -> bool:
        """Set the active layer.

        Args:
            layer_id: ID of layer to activate.

        Returns:
            True if layer was found and activated.
        """
        if self.get_layer(layer_id):
            self._active_layer_id = layer_id
            return True
        return False

    def move_layer(self, layer_id: str, new_index: int) -> bool:
        """Move a layer to a new position.

        Args:
            layer_id: ID of layer to move.
            new_index: New position (0 = bottom).

        Returns:
            True if moved.
        """
        for i, layer in enumerate(self._layers):
            if layer.id == layer_id:
                self._layers.pop(i)
                new_index = max(0, min(new_index, len(self._layers)))
                self._layers.insert(new_index, layer)
                return True
        return False

    def add_primitive(self, primitive: Primitive, layer_id: str | None = None) -> bool:
        """Add a primitive to a layer.

        Args:
            primitive: Primitive to add.
            layer_id: Target layer ID. None = active layer.

        Returns:
            True if added.
        """
        target_id = layer_id or self._active_layer_id
        if target_id:
            layer = self.get_layer(target_id)
            if layer and not layer.locked:
                layer.add(primitive)
                return True
        return False

    def remove_primitive(self, primitive_id: str) -> bool:
        """Remove a primitive from any layer.

        Args:
            primitive_id: ID of primitive to remove.

        Returns:
            True if removed.
        """
        for layer in self._layers:
            if layer.remove(primitive_id):
                return True
        return False

    def get_primitive(self, primitive_id: str) -> tuple[Primitive | None, Layer | None]:
        """Get a primitive and its containing layer.

        Args:
            primitive_id: ID of primitive to find.

        Returns:
            Tuple of (primitive, layer) or (None, None).
        """
        for layer in self._layers:
            prim = layer.get(primitive_id)
            if prim:
                return (prim, layer)
        return (None, None)

    def find_at_point(
        self, point: Point2D, tolerance: float = 5.0
    ) -> list[tuple[Primitive, Layer]]:
        """Find all primitives at a point across all visible layers.

        Args:
            point: Point to search at.
            tolerance: Hit tolerance in pixels.

        Returns:
            List of (primitive, layer) tuples, top to bottom.
        """
        results: list[tuple[Primitive, Layer]] = []

        # Search top to bottom (reverse order)
        for layer in reversed(self._layers):
            if not layer.visible:
                continue
            for prim in layer.find_at_point(point, tolerance):
                results.append((prim, layer))

        return results

    def iter_all_primitives(self) -> Iterator[tuple[Primitive, Layer]]:
        """Iterate over all primitives in all layers (bottom to top)."""
        for layer in self._layers:
            for prim in layer.primitives:
                yield (prim, layer)

    def iter_visible_primitives(self) -> Iterator[tuple[Primitive, Layer]]:
        """Iterate over visible primitives in visible layers."""
        for layer in self._layers:
            if not layer.visible:
                continue
            for prim in layer.iter_visible():
                yield (prim, layer)

    def get_bounds(self) -> tuple[Point2D, Point2D] | None:
        """Get combined bounding box of all visible primitives.

        Returns:
            Tuple of (min_point, max_point) or None if empty.
        """
        min_x = float("inf")
        min_y = float("inf")
        max_x = float("-inf")
        max_y = float("-inf")
        found_any = False

        for prim, _ in self.iter_visible_primitives():
            bounds = prim.get_bounds()
            min_x = min(min_x, bounds[0].x)
            min_y = min(min_y, bounds[0].y)
            max_x = max(max_x, bounds[1].x)
            max_y = max(max_y, bounds[1].y)
            found_any = True

        if not found_any:
            return None

        return (Point2D(min_x, min_y), Point2D(max_x, max_y))

    def clear(self) -> None:
        """Clear all primitives from all layers."""
        for layer in self._layers:
            layer.clear()

    def clear_layer(self, layer_id: str) -> bool:
        """Clear all primitives from a specific layer."""
        layer = self.get_layer(layer_id)
        if layer:
            layer.clear()
            return True
        return False

    def total_primitive_count(self) -> int:
        """Get total number of primitives across all layers."""
        return sum(layer.count for layer in self._layers)

    def to_dict(self) -> dict[str, Any]:
        """Serialize canvas to dictionary."""
        return {
            "layers": [layer.to_dict() for layer in self._layers],
            "active_layer_id": self._active_layer_id,
        }

    def duplicate_layer(self, layer_id: str) -> Layer | None:
        """Duplicate a layer and all its primitives.

        Args:
            layer_id: ID of layer to duplicate.

        Returns:
            The new duplicated layer.
        """
        source = self.get_layer(layer_id)
        if not source:
            return None

        new_layer = Layer(
            name=f"{source.name} copy",
            visible=source.visible,
            locked=False,
            opacity=source.opacity,
            metadata=source.metadata.copy(),
        )

        # Deep copy primitives would require a copy method on each primitive
        # For now, just reference the same primitives
        new_layer.primitives = source.primitives.copy()

        # Insert after source layer
        try:
            idx = self._layers.index(source)
            self._layers.insert(idx + 1, new_layer)
        except ValueError:
            self._layers.append(new_layer)

        return new_layer

    def merge_layers(self, layer_ids: list[str], name: str = "Merged") -> Layer | None:
        """Merge multiple layers into one.

        Args:
            layer_ids: IDs of layers to merge.
            name: Name for the merged layer.

        Returns:
            The new merged layer.
        """
        layers_to_merge = [
            layer for layer in self._layers
            if layer.id in layer_ids
        ]

        if not layers_to_merge:
            return None

        merged = Layer(name=name)

        for layer in layers_to_merge:
            merged.primitives.extend(layer.primitives)

        # Find lowest position of merged layers
        min_idx = min(
            self._layers.index(layer)
            for layer in layers_to_merge
        )

        # Remove old layers
        for layer in layers_to_merge:
            self._layers.remove(layer)

        # Insert merged layer
        self._layers.insert(min_idx, merged)

        # Update active layer if needed
        if self._active_layer_id in layer_ids:
            self._active_layer_id = merged.id

        return merged
