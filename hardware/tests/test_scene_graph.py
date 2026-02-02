"""Tests for scene graph module."""

from __future__ import annotations

import pytest

from core.blueprint.scene_graph import (
    BoundingBox,
    SceneGraph,
    SceneNode,
    Transform,
)


class TestTransform:
    """Tests for Transform dataclass."""

    def test_transform_defaults(self) -> None:
        """Test transform with defaults."""
        t = Transform()
        assert t.x == 0
        assert t.y == 0
        assert t.z == 0
        assert t.rx == 0
        assert t.ry == 0
        assert t.rz == 0
        assert t.sx == 1
        assert t.sy == 1
        assert t.sz == 1

    def test_transform_custom_values(self) -> None:
        """Test transform with custom values."""
        t = Transform(x=10, y=20, z=5, rx=45, sy=2.0)
        assert t.x == 10
        assert t.y == 20
        assert t.z == 5
        assert t.rx == 45
        assert t.sy == 2.0

    def test_transform_copy(self) -> None:
        """Test transform copy."""
        t1 = Transform(x=10, y=20)
        t2 = t1.copy()
        t2.x = 100

        assert t1.x == 10
        assert t2.x == 100

    def test_transform_apply(self) -> None:
        """Test applying transform to point."""
        t = Transform(x=10, y=20)
        px, py, pz = t.apply_to_point(5, 5, 0)

        assert px == 15
        assert py == 25
        assert pz == 0

    def test_transform_with_scale(self) -> None:
        """Test transform with scaling."""
        t = Transform(sx=2, sy=2, sz=2)
        px, py, pz = t.apply_to_point(10, 10, 10)

        assert px == 20
        assert py == 20
        assert pz == 20

    def test_transform_translate(self) -> None:
        """Test translate method."""
        t = Transform(x=10, y=10)
        t.translate(5, 5, 5)

        assert t.x == 15
        assert t.y == 15
        assert t.z == 5


class TestBoundingBox:
    """Tests for BoundingBox dataclass."""

    def test_bounding_box_creation(self) -> None:
        """Test bounding box creation."""
        bb = BoundingBox(min_x=0, min_y=0, max_x=100, max_y=50)
        assert bb.min_x == 0
        assert bb.max_x == 100
        assert bb.width == 100
        assert bb.height == 50

    def test_bounding_box_center(self) -> None:
        """Test bounding box center."""
        bb = BoundingBox(min_x=0, min_y=0, max_x=100, max_y=100)
        cx, cy, cz = bb.center
        assert cx == 50
        assert cy == 50
        assert cz == 0

    def test_bounding_box_contains(self) -> None:
        """Test point containment."""
        bb = BoundingBox(min_x=0, min_y=0, max_x=100, max_y=100)

        assert bb.contains_point(50, 50)
        assert bb.contains_point(0, 0)
        assert not bb.contains_point(-1, 50)
        assert not bb.contains_point(50, 101)

    def test_bounding_box_intersects(self) -> None:
        """Test bounding box intersection."""
        bb1 = BoundingBox(min_x=0, min_y=0, max_x=100, max_y=100)
        bb2 = BoundingBox(min_x=50, min_y=50, max_x=150, max_y=150)
        bb3 = BoundingBox(min_x=200, min_y=200, max_x=300, max_y=300)

        assert bb1.intersects(bb2)
        assert not bb1.intersects(bb3)

    def test_bounding_box_expand(self) -> None:
        """Test bounding box expansion."""
        bb = BoundingBox(min_x=10, min_y=10, max_x=20, max_y=20)
        bb.expand_to_include(0, 0)

        assert bb.min_x == 0
        assert bb.min_y == 0
        assert bb.max_x == 20
        assert bb.max_y == 20

    def test_bounding_box_merge(self) -> None:
        """Test bounding box merge."""
        bb1 = BoundingBox(min_x=0, min_y=0, max_x=10, max_y=10)
        bb2 = BoundingBox(min_x=5, min_y=5, max_x=20, max_y=20)

        bb1.merge(bb2)
        assert bb1.min_x == 0
        assert bb1.min_y == 0
        assert bb1.max_x == 20
        assert bb1.max_y == 20


class TestSceneNode:
    """Tests for SceneNode."""

    def test_node_creation(self) -> None:
        """Test node creation."""
        node = SceneNode(
            id="node1",
            name="Test Node",
        )
        assert node.id == "node1"
        assert node.name == "Test Node"
        assert node.parent is None
        assert len(node.children) == 0

    def test_node_with_transform(self) -> None:
        """Test node with transform."""
        node = SceneNode(
            id="node1",
            name="Node",
            transform=Transform(x=10, y=20),
        )
        assert node.transform.x == 10
        assert node.transform.y == 20

    def test_node_with_bounds(self) -> None:
        """Test node with bounds."""
        node = SceneNode(
            id="node1",
            name="Node",
            bounds=BoundingBox(min_x=0, min_y=0, max_x=100, max_y=50),
        )
        assert node.bounds.width == 100

    def test_node_add_child(self) -> None:
        """Test adding child node."""
        parent = SceneNode(id="parent", name="Parent")
        child = SceneNode(id="child", name="Child")

        parent.add_child(child)

        assert len(parent.children) == 1
        assert parent.children[0] is child
        assert child.parent is parent

    def test_node_remove_child(self) -> None:
        """Test removing child node."""
        parent = SceneNode(id="parent", name="Parent")
        child = SceneNode(id="child", name="Child")

        parent.add_child(child)
        parent.remove_child(child)

        assert len(parent.children) == 0
        assert child.parent is None

    def test_node_world_transform(self) -> None:
        """Test world transform computation."""
        parent = SceneNode(
            id="parent",
            name="Parent",
            transform=Transform(x=100, y=100),
        )
        child = SceneNode(
            id="child",
            name="Child",
            transform=Transform(x=50, y=50),
        )

        parent.add_child(child)
        world = child.get_world_transform()

        assert world.x == 150
        assert world.y == 150


class TestSceneGraph:
    """Tests for SceneGraph."""

    def test_empty_graph(self) -> None:
        """Test empty scene graph."""
        graph = SceneGraph()
        assert graph.root is not None
        # get_all_nodes() includes root, so empty graph has 1 node
        all_nodes = graph.get_all_nodes()
        assert len(all_nodes) == 1
        assert all_nodes[0].id == "root"

    def test_add_node(self) -> None:
        """Test adding node."""
        graph = SceneGraph()
        node = SceneNode(id="node1", name="Node 1")

        graph.add_node(node)

        assert graph.get_node("node1") is node
        # Includes root + 1 added node
        assert len(graph.get_all_nodes()) == 2

    def test_add_node_with_parent(self) -> None:
        """Test adding node with parent."""
        graph = SceneGraph()
        parent = SceneNode(id="parent", name="Parent")
        child = SceneNode(id="child", name="Child")

        graph.add_node(parent)
        graph.add_node(child, parent_id="parent")

        assert child.parent is parent
        assert child in parent.children

    def test_remove_node(self) -> None:
        """Test removing node."""
        graph = SceneGraph()
        node = SceneNode(id="node1", name="Node 1")

        graph.add_node(node)
        graph.remove_node("node1")

        assert graph.get_node("node1") is None
        # Only root remains
        assert len(graph.get_all_nodes()) == 1

    def test_remove_node_with_children(self) -> None:
        """Test removing node also removes children."""
        graph = SceneGraph()
        parent = SceneNode(id="parent", name="Parent")
        child = SceneNode(id="child", name="Child")

        graph.add_node(parent)
        graph.add_node(child, parent_id="parent")

        graph.remove_node("parent")

        assert graph.get_node("parent") is None
        assert graph.get_node("child") is None

    def test_find_at_point(self) -> None:
        """Test finding node at point."""
        graph = SceneGraph()
        node = SceneNode(
            id="node1",
            name="Node 1",
            bounds=BoundingBox(min_x=0, min_y=0, max_x=100, max_y=100),
        )

        graph.add_node(node)

        found = graph.find_at_point(50, 50)
        # Should find node1 (root has zero bounds, may or may not match)
        assert any(n.id == "node1" for n in found)

        not_found = graph.find_at_point(200, 200)
        # Should not find node1
        assert not any(n.id == "node1" for n in not_found)

    def test_compute_bounds(self) -> None:
        """Test computing scene bounds."""
        graph = SceneGraph()
        node1 = SceneNode(
            id="node1",
            name="Node 1",
            bounds=BoundingBox(min_x=0, min_y=0, max_x=50, max_y=50),
        )
        node2 = SceneNode(
            id="node2",
            name="Node 2",
            bounds=BoundingBox(min_x=100, min_y=100, max_x=200, max_y=200),
        )

        graph.add_node(node1)
        graph.add_node(node2)

        bounds = graph.compute_bounds()
        # Bounds should encompass all nodes
        assert bounds.min_x <= 0
        assert bounds.min_y <= 0
        assert bounds.max_x >= 200
        assert bounds.max_y >= 200

    def test_clear(self) -> None:
        """Test clearing scene graph."""
        graph = SceneGraph()
        graph.add_node(SceneNode(id="n1", name="N1"))
        graph.add_node(SceneNode(id="n2", name="N2"))

        graph.clear()

        # After clear, only root should remain
        all_nodes = graph.get_all_nodes()
        assert len(all_nodes) == 1
        assert all_nodes[0].id == "root"
