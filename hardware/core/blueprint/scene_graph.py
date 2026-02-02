"""Scene graph for blueprint component hierarchy.

Provides a hierarchical tree structure for managing blueprint components
with transforms, bounds, and visibility.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator


@dataclass
class Transform:
    """3D transformation - position, rotation, scale."""

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    rx: float = 0.0  # Rotation around X axis (degrees)
    ry: float = 0.0  # Rotation around Y axis (degrees)
    rz: float = 0.0  # Rotation around Z axis (degrees)
    sx: float = 1.0  # Scale X
    sy: float = 1.0  # Scale Y
    sz: float = 1.0  # Scale Z

    @property
    def position(self) -> tuple[float, float, float]:
        """Get position as tuple."""
        return (self.x, self.y, self.z)

    @position.setter
    def position(self, value: tuple[float, float, float]) -> None:
        """Set position from tuple."""
        self.x, self.y, self.z = value

    @property
    def rotation(self) -> tuple[float, float, float]:
        """Get rotation as tuple (degrees)."""
        return (self.rx, self.ry, self.rz)

    @rotation.setter
    def rotation(self, value: tuple[float, float, float]) -> None:
        """Set rotation from tuple (degrees)."""
        self.rx, self.ry, self.rz = value

    @property
    def scale(self) -> tuple[float, float, float]:
        """Get scale as tuple."""
        return (self.sx, self.sy, self.sz)

    @scale.setter
    def scale(self, value: tuple[float, float, float]) -> None:
        """Set scale from tuple."""
        self.sx, self.sy, self.sz = value

    def translate(self, dx: float, dy: float, dz: float) -> None:
        """Translate by delta values."""
        self.x += dx
        self.y += dy
        self.z += dz

    def rotate(self, drx: float, dry: float, drz: float) -> None:
        """Rotate by delta values (degrees)."""
        self.rx = (self.rx + drx) % 360
        self.ry = (self.ry + dry) % 360
        self.rz = (self.rz + drz) % 360

    def scale_by(self, factor: float) -> None:
        """Scale uniformly by factor."""
        self.sx *= factor
        self.sy *= factor
        self.sz *= factor

    def copy(self) -> Transform:
        """Create a copy of this transform."""
        return Transform(
            x=self.x, y=self.y, z=self.z,
            rx=self.rx, ry=self.ry, rz=self.rz,
            sx=self.sx, sy=self.sy, sz=self.sz,
        )

    def reset(self) -> None:
        """Reset to identity transform."""
        self.x = self.y = self.z = 0.0
        self.rx = self.ry = self.rz = 0.0
        self.sx = self.sy = self.sz = 1.0

    def apply_to_point(self, px: float, py: float, pz: float) -> tuple[float, float, float]:
        """Apply this transform to a point.

        Applies in order: scale, rotation, translation.
        """
        # Scale
        px *= self.sx
        py *= self.sy
        pz *= self.sz

        # Rotation (simplified - proper rotation would use matrices)
        # This is a basic implementation for 2D-primary usage
        if self.rz != 0:
            rad = math.radians(self.rz)
            cos_r, sin_r = math.cos(rad), math.sin(rad)
            px, py = px * cos_r - py * sin_r, px * sin_r + py * cos_r

        # Translation
        return (px + self.x, py + self.y, pz + self.z)


@dataclass
class BoundingBox:
    """Axis-aligned bounding box."""

    min_x: float = 0.0
    min_y: float = 0.0
    min_z: float = 0.0
    max_x: float = 0.0
    max_y: float = 0.0
    max_z: float = 0.0

    @property
    def width(self) -> float:
        """Width of bounding box (X dimension)."""
        return self.max_x - self.min_x

    @property
    def height(self) -> float:
        """Height of bounding box (Y dimension)."""
        return self.max_y - self.min_y

    @property
    def depth(self) -> float:
        """Depth of bounding box (Z dimension)."""
        return self.max_z - self.min_z

    @property
    def center(self) -> tuple[float, float, float]:
        """Center point of bounding box."""
        return (
            (self.min_x + self.max_x) / 2,
            (self.min_y + self.max_y) / 2,
            (self.min_z + self.max_z) / 2,
        )

    @property
    def size(self) -> tuple[float, float, float]:
        """Size of bounding box (width, height, depth)."""
        return (self.width, self.height, self.depth)

    def contains_point(self, x: float, y: float, z: float = 0.0) -> bool:
        """Check if point is inside bounding box."""
        return (
            self.min_x <= x <= self.max_x
            and self.min_y <= y <= self.max_y
            and self.min_z <= z <= self.max_z
        )

    def intersects(self, other: BoundingBox) -> bool:
        """Check if this box intersects another."""
        return (
            self.min_x <= other.max_x
            and self.max_x >= other.min_x
            and self.min_y <= other.max_y
            and self.max_y >= other.min_y
            and self.min_z <= other.max_z
            and self.max_z >= other.min_z
        )

    def expand_to_include(self, x: float, y: float, z: float = 0.0) -> None:
        """Expand bounding box to include a point."""
        self.min_x = min(self.min_x, x)
        self.min_y = min(self.min_y, y)
        self.min_z = min(self.min_z, z)
        self.max_x = max(self.max_x, x)
        self.max_y = max(self.max_y, y)
        self.max_z = max(self.max_z, z)

    def merge(self, other: BoundingBox) -> None:
        """Merge another bounding box into this one."""
        self.min_x = min(self.min_x, other.min_x)
        self.min_y = min(self.min_y, other.min_y)
        self.min_z = min(self.min_z, other.min_z)
        self.max_x = max(self.max_x, other.max_x)
        self.max_y = max(self.max_y, other.max_y)
        self.max_z = max(self.max_z, other.max_z)

    @classmethod
    def from_points(cls, points: list[tuple[float, float, float]]) -> BoundingBox:
        """Create bounding box from list of points."""
        if not points:
            return cls()
        min_x = min(p[0] for p in points)
        max_x = max(p[0] for p in points)
        min_y = min(p[1] for p in points)
        max_y = max(p[1] for p in points)
        min_z = min(p[2] for p in points)
        max_z = max(p[2] for p in points)
        return cls(min_x, min_y, min_z, max_x, max_y, max_z)

    @classmethod
    def from_dimensions(
        cls, width: float, height: float, depth: float = 0.0, center: bool = True
    ) -> BoundingBox:
        """Create bounding box from dimensions.

        Args:
            width: Width (X dimension)
            height: Height (Y dimension)
            depth: Depth (Z dimension)
            center: If True, center at origin. If False, start at origin.
        """
        if center:
            hw, hh, hd = width / 2, height / 2, depth / 2
            return cls(-hw, -hh, -hd, hw, hh, hd)
        return cls(0, 0, 0, width, height, depth)


@dataclass
class SceneNode:
    """Node in the scene graph representing a component or group.

    Each node has a local transform relative to its parent.
    """

    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = ""
    component_id: str | None = None  # Reference to ComponentSpec.id
    transform: Transform = field(default_factory=Transform)
    bounds: BoundingBox = field(default_factory=BoundingBox)
    visible: bool = True
    locked: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    # Hierarchy
    parent: SceneNode | None = field(default=None, repr=False)
    children: list[SceneNode] = field(default_factory=list, repr=False)

    def add_child(self, child: SceneNode) -> None:
        """Add a child node."""
        if child.parent is not None:
            child.parent.remove_child(child)
        child.parent = self
        self.children.append(child)

    def remove_child(self, child: SceneNode) -> bool:
        """Remove a child node. Returns True if removed."""
        if child in self.children:
            self.children.remove(child)
            child.parent = None
            return True
        return False

    def get_world_transform(self) -> Transform:
        """Get transform in world coordinates (accumulated from root)."""
        if self.parent is None:
            return self.transform.copy()

        parent_transform = self.parent.get_world_transform()
        world = Transform()

        # Accumulate transforms
        world.x = parent_transform.x + self.transform.x * parent_transform.sx
        world.y = parent_transform.y + self.transform.y * parent_transform.sy
        world.z = parent_transform.z + self.transform.z * parent_transform.sz
        world.rx = (parent_transform.rx + self.transform.rx) % 360
        world.ry = (parent_transform.ry + self.transform.ry) % 360
        world.rz = (parent_transform.rz + self.transform.rz) % 360
        world.sx = parent_transform.sx * self.transform.sx
        world.sy = parent_transform.sy * self.transform.sy
        world.sz = parent_transform.sz * self.transform.sz

        return world

    def get_world_bounds(self) -> BoundingBox:
        """Get bounding box in world coordinates."""
        world_transform = self.get_world_transform()

        # Transform corner points
        corners = [
            (self.bounds.min_x, self.bounds.min_y, self.bounds.min_z),
            (self.bounds.max_x, self.bounds.min_y, self.bounds.min_z),
            (self.bounds.min_x, self.bounds.max_y, self.bounds.min_z),
            (self.bounds.max_x, self.bounds.max_y, self.bounds.min_z),
            (self.bounds.min_x, self.bounds.min_y, self.bounds.max_z),
            (self.bounds.max_x, self.bounds.min_y, self.bounds.max_z),
            (self.bounds.min_x, self.bounds.max_y, self.bounds.max_z),
            (self.bounds.max_x, self.bounds.max_y, self.bounds.max_z),
        ]

        transformed = [world_transform.apply_to_point(*c) for c in corners]
        return BoundingBox.from_points(transformed)

    def iter_descendants(self) -> Iterator[SceneNode]:
        """Iterate over all descendant nodes (depth-first)."""
        for child in self.children:
            yield child
            yield from child.iter_descendants()

    def find_by_id(self, node_id: str) -> SceneNode | None:
        """Find a node by ID in this subtree."""
        if self.id == node_id:
            return self
        for child in self.children:
            result = child.find_by_id(node_id)
            if result:
                return result
        return None

    def find_by_component_id(self, component_id: str) -> SceneNode | None:
        """Find a node by component ID in this subtree."""
        if self.component_id == component_id:
            return self
        for child in self.children:
            result = child.find_by_component_id(component_id)
            if result:
                return result
        return None

    def get_depth(self) -> int:
        """Get depth in tree (0 for root)."""
        if self.parent is None:
            return 0
        return 1 + self.parent.get_depth()

    def get_path(self) -> list[str]:
        """Get path from root to this node as list of IDs."""
        if self.parent is None:
            return [self.id]
        return self.parent.get_path() + [self.id]


class SceneGraph:
    """Blueprint scene graph manager.

    Manages the hierarchical structure of components in a blueprint,
    providing efficient queries and transformations.

    Usage:
        graph = SceneGraph()
        node = graph.create_node("part_001", "Main Body")
        graph.add_node(node)
        child = graph.create_node("part_002", "Attachment")
        graph.add_node(child, parent_id=node.id)
    """

    def __init__(self) -> None:
        """Initialize empty scene graph with root node."""
        self._root = SceneNode(id="root", name="Scene Root")
        self._nodes: dict[str, SceneNode] = {"root": self._root}
        self._component_map: dict[str, str] = {}  # component_id -> node_id

    @property
    def root(self) -> SceneNode:
        """Get root node of scene graph."""
        return self._root

    def create_node(
        self,
        component_id: str | None = None,
        name: str = "",
        bounds: BoundingBox | None = None,
    ) -> SceneNode:
        """Create a new scene node (not yet added to graph).

        Args:
            component_id: Optional reference to blueprint component.
            name: Display name for the node.
            bounds: Optional bounding box.

        Returns:
            New SceneNode instance.
        """
        node = SceneNode(
            name=name or (component_id or "Node"),
            component_id=component_id,
            bounds=bounds or BoundingBox(),
        )
        return node

    def add_node(self, node: SceneNode, parent_id: str | None = None) -> None:
        """Add a node to the scene graph.

        Args:
            node: Node to add.
            parent_id: ID of parent node. If None, adds to root.

        Raises:
            ValueError: If node ID already exists or parent not found.
        """
        if node.id in self._nodes:
            raise ValueError(f"Node with ID {node.id} already exists")

        parent = self._root
        if parent_id is not None:
            parent = self._nodes.get(parent_id)
            if parent is None:
                raise ValueError(f"Parent node {parent_id} not found")

        parent.add_child(node)
        self._nodes[node.id] = node

        if node.component_id:
            self._component_map[node.component_id] = node.id

    def remove_node(self, node_id: str) -> bool:
        """Remove a node and all its descendants.

        Args:
            node_id: ID of node to remove.

        Returns:
            True if removed, False if not found.
        """
        if node_id == "root":
            return False  # Cannot remove root

        node = self._nodes.get(node_id)
        if node is None:
            return False

        # Remove all descendants first
        for child in list(node.iter_descendants()):
            self._nodes.pop(child.id, None)
            if child.component_id:
                self._component_map.pop(child.component_id, None)

        # Remove from parent
        if node.parent:
            node.parent.remove_child(node)

        # Remove from lookups
        self._nodes.pop(node_id, None)
        if node.component_id:
            self._component_map.pop(node.component_id, None)

        return True

    def get_node(self, node_id: str) -> SceneNode | None:
        """Get node by ID."""
        return self._nodes.get(node_id)

    def get_node_by_component(self, component_id: str) -> SceneNode | None:
        """Get node by component ID."""
        node_id = self._component_map.get(component_id)
        if node_id:
            return self._nodes.get(node_id)
        return None

    def get_all_nodes(self) -> list[SceneNode]:
        """Get all nodes in the scene graph."""
        return list(self._nodes.values())

    def get_visible_nodes(self) -> list[SceneNode]:
        """Get all visible nodes."""
        return [n for n in self._nodes.values() if n.visible]

    def clear(self) -> None:
        """Clear all nodes except root."""
        self._root.children.clear()
        self._nodes = {"root": self._root}
        self._component_map.clear()

    def iter_all(self) -> Iterator[SceneNode]:
        """Iterate over all nodes in depth-first order."""
        yield self._root
        yield from self._root.iter_descendants()

    def compute_bounds(self) -> BoundingBox:
        """Compute combined bounding box of all visible nodes."""
        bounds = BoundingBox()
        first = True

        for node in self.get_visible_nodes():
            if node.id == "root":
                continue
            world_bounds = node.get_world_bounds()
            if first:
                bounds = world_bounds
                first = False
            else:
                bounds.merge(world_bounds)

        return bounds

    def find_at_point(
        self, x: float, y: float, z: float = 0.0
    ) -> list[SceneNode]:
        """Find all visible nodes whose bounds contain the given point.

        Returns nodes in order from deepest to shallowest (front to back).
        """
        hits: list[SceneNode] = []

        for node in self.get_visible_nodes():
            if node.id == "root" or node.locked:
                continue
            world_bounds = node.get_world_bounds()
            if world_bounds.contains_point(x, y, z):
                hits.append(node)

        # Sort by depth (deepest first)
        hits.sort(key=lambda n: -n.get_depth())
        return hits

    def move_node(self, node_id: str, new_parent_id: str) -> bool:
        """Move a node to a different parent.

        Args:
            node_id: ID of node to move.
            new_parent_id: ID of new parent.

        Returns:
            True if moved, False if failed.
        """
        if node_id == "root":
            return False

        node = self._nodes.get(node_id)
        new_parent = self._nodes.get(new_parent_id)

        if node is None or new_parent is None:
            return False

        # Check for circular reference
        check = new_parent
        while check:
            if check.id == node_id:
                return False  # Would create cycle
            check = check.parent

        # Remove from old parent and add to new
        if node.parent:
            node.parent.remove_child(node)
        new_parent.add_child(node)

        return True

    def node_count(self) -> int:
        """Get total number of nodes."""
        return len(self._nodes)
