"""Selection management for blueprint components.

Handles single and multi-selection of scene nodes with selection modes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from core.blueprint.scene_graph import SceneNode, SceneGraph, BoundingBox


class SelectionMode(str, Enum):
    """Selection mode determining how new selections interact with existing."""

    REPLACE = "replace"  # Replace existing selection
    ADD = "add"  # Add to existing selection
    REMOVE = "remove"  # Remove from existing selection
    TOGGLE = "toggle"  # Toggle selection state


@dataclass
class SelectionEvent:
    """Event emitted when selection changes."""

    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    selection: list[str] = field(default_factory=list)


SelectionHandler = Callable[[SelectionEvent], None]


class SelectionManager:
    """Manages selection state for scene nodes.

    Supports single and multi-selection with various selection modes.

    Usage:
        selection = SelectionManager(scene_graph)
        selection.select("node_001")
        selection.select("node_002", mode=SelectionMode.ADD)
        print(selection.selected_ids)
    """

    def __init__(self, scene_graph: SceneGraph) -> None:
        """Initialize selection manager.

        Args:
            scene_graph: Scene graph to manage selections for.
        """
        self._scene_graph = scene_graph
        self._selected: set[str] = set()
        self._primary: str | None = None  # Primary selection (for transforms)
        self._handlers: list[SelectionHandler] = []

    @property
    def selected_ids(self) -> list[str]:
        """Get list of selected node IDs."""
        return list(self._selected)

    @property
    def selected_nodes(self) -> list[SceneNode]:
        """Get list of selected nodes."""
        nodes = []
        for node_id in self._selected:
            node = self._scene_graph.get_node(node_id)
            if node:
                nodes.append(node)
        return nodes

    @property
    def primary_id(self) -> str | None:
        """Get primary selection ID."""
        return self._primary

    @property
    def primary_node(self) -> SceneNode | None:
        """Get primary selection node."""
        if self._primary:
            return self._scene_graph.get_node(self._primary)
        return None

    @property
    def count(self) -> int:
        """Get number of selected items."""
        return len(self._selected)

    @property
    def is_empty(self) -> bool:
        """Check if selection is empty."""
        return len(self._selected) == 0

    def is_selected(self, node_id: str) -> bool:
        """Check if a node is selected."""
        return node_id in self._selected

    def select(
        self, node_id: str | list[str], mode: SelectionMode = SelectionMode.REPLACE
    ) -> None:
        """Select node(s).

        Args:
            node_id: Single node ID or list of node IDs.
            mode: Selection mode to use.
        """
        if isinstance(node_id, str):
            node_ids = [node_id]
        else:
            node_ids = node_id

        # Filter to valid nodes that aren't locked
        valid_ids = []
        for nid in node_ids:
            node = self._scene_graph.get_node(nid)
            if node and not node.locked and node.id != "root":
                valid_ids.append(nid)

        added: list[str] = []
        removed: list[str] = []

        if mode == SelectionMode.REPLACE:
            removed = [nid for nid in self._selected if nid not in valid_ids]
            added = [nid for nid in valid_ids if nid not in self._selected]
            self._selected = set(valid_ids)

        elif mode == SelectionMode.ADD:
            for nid in valid_ids:
                if nid not in self._selected:
                    self._selected.add(nid)
                    added.append(nid)

        elif mode == SelectionMode.REMOVE:
            for nid in valid_ids:
                if nid in self._selected:
                    self._selected.remove(nid)
                    removed.append(nid)

        elif mode == SelectionMode.TOGGLE:
            for nid in valid_ids:
                if nid in self._selected:
                    self._selected.remove(nid)
                    removed.append(nid)
                else:
                    self._selected.add(nid)
                    added.append(nid)

        # Update primary selection
        if self._selected:
            if self._primary not in self._selected:
                self._primary = next(iter(self._selected))
        else:
            self._primary = None

        # Emit event if changes occurred
        if added or removed:
            self._emit_event(SelectionEvent(
                added=added,
                removed=removed,
                selection=list(self._selected),
            ))

    def select_all(self) -> None:
        """Select all visible, unlocked nodes."""
        all_ids = []
        for node in self._scene_graph.get_visible_nodes():
            if not node.locked and node.id != "root":
                all_ids.append(node.id)
        self.select(all_ids, mode=SelectionMode.REPLACE)

    def deselect(self, node_id: str | list[str] | None = None) -> None:
        """Deselect node(s) or clear selection.

        Args:
            node_id: Node ID(s) to deselect. If None, clears all.
        """
        if node_id is None:
            self.clear()
        else:
            self.select(node_id, mode=SelectionMode.REMOVE)

    def clear(self) -> None:
        """Clear all selections."""
        if self._selected:
            removed = list(self._selected)
            self._selected.clear()
            self._primary = None
            self._emit_event(SelectionEvent(
                added=[],
                removed=removed,
                selection=[],
            ))

    def set_primary(self, node_id: str) -> bool:
        """Set the primary selection.

        Args:
            node_id: Node ID to set as primary.

        Returns:
            True if set successfully.
        """
        if node_id in self._selected:
            self._primary = node_id
            return True
        return False

    def invert(self) -> None:
        """Invert the selection (select unselected, deselect selected)."""
        all_ids = set()
        for node in self._scene_graph.get_visible_nodes():
            if not node.locked and node.id != "root":
                all_ids.add(node.id)

        new_selection = all_ids - self._selected
        self.select(list(new_selection), mode=SelectionMode.REPLACE)

    def select_by_component_ids(
        self, component_ids: list[str], mode: SelectionMode = SelectionMode.REPLACE
    ) -> None:
        """Select nodes by their component IDs.

        Args:
            component_ids: List of component IDs to select.
            mode: Selection mode to use.
        """
        node_ids = []
        for comp_id in component_ids:
            node = self._scene_graph.get_node_by_component(comp_id)
            if node:
                node_ids.append(node.id)
        self.select(node_ids, mode=mode)

    def select_in_bounds(
        self,
        bounds: BoundingBox,
        mode: SelectionMode = SelectionMode.REPLACE,
        fully_contained: bool = False,
    ) -> None:
        """Select nodes within a bounding box.

        Args:
            bounds: Bounding box for selection.
            mode: Selection mode to use.
            fully_contained: If True, node must be fully inside bounds.
        """
        matching = []
        for node in self._scene_graph.get_visible_nodes():
            if node.locked or node.id == "root":
                continue

            node_bounds = node.get_world_bounds()

            if fully_contained:
                # Node must be fully inside selection bounds
                inside = (
                    bounds.min_x <= node_bounds.min_x
                    and bounds.max_x >= node_bounds.max_x
                    and bounds.min_y <= node_bounds.min_y
                    and bounds.max_y >= node_bounds.max_y
                )
            else:
                # Node just needs to intersect
                inside = bounds.intersects(node_bounds)

            if inside:
                matching.append(node.id)

        self.select(matching, mode=mode)

    def get_selection_bounds(self) -> BoundingBox | None:
        """Get combined bounding box of all selected nodes."""
        from core.blueprint.scene_graph import BoundingBox

        nodes = self.selected_nodes
        if not nodes:
            return None

        bounds = nodes[0].get_world_bounds()
        for node in nodes[1:]:
            bounds.merge(node.get_world_bounds())

        return bounds

    def on_change(self, handler: SelectionHandler) -> None:
        """Register a handler for selection change events.

        Args:
            handler: Function to call when selection changes.
        """
        self._handlers.append(handler)

    def off_change(self, handler: SelectionHandler) -> None:
        """Unregister a selection change handler.

        Args:
            handler: Handler to remove.
        """
        if handler in self._handlers:
            self._handlers.remove(handler)

    def _emit_event(self, event: SelectionEvent) -> None:
        """Emit selection change event to all handlers."""
        for handler in self._handlers:
            try:
                handler(event)
            except Exception:
                pass  # Don't let handler errors break selection
