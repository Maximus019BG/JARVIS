"""Tests for SelectionManager — covers all selection operations."""

from __future__ import annotations

from core.blueprint.scene_graph import BoundingBox, SceneGraph, SceneNode, Transform
from core.blueprint.selection import SelectionEvent, SelectionManager, SelectionMode


def _make_graph(*node_ids: str) -> SceneGraph:
    """Build a scene graph with the given node IDs under root."""
    sg = SceneGraph()
    for nid in node_ids:
        sg.add_node(SceneNode(id=nid, bounds=BoundingBox(max_x=10, max_y=10)))
    return sg


class TestSelectionManagerProperties:
    def test_selected_nodes(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select("a")
        nodes = sm.selected_nodes
        assert len(nodes) == 1
        assert nodes[0].id == "a"

    def test_primary_id(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)
        sm.select("a")
        assert sm.primary_id == "a"

    def test_primary_node(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)
        sm.select("a")
        assert sm.primary_node is not None
        assert sm.primary_node.id == "a"

    def test_primary_node_none(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)
        assert sm.primary_node is None

    def test_count(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        assert sm.count == 0
        sm.select(["a", "b"])
        assert sm.count == 2

    def test_is_selected(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select("a")
        assert sm.is_selected("a")
        assert not sm.is_selected("b")


class TestSelectionModes:
    def test_replace_mode(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select("a")
        sm.select("b", mode=SelectionMode.REPLACE)
        assert sm.selected_ids == ["b"]

    def test_add_mode(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select("a")
        sm.select("b", mode=SelectionMode.ADD)
        assert set(sm.selected_ids) == {"a", "b"}

    def test_remove_mode(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select(["a", "b"])
        sm.select("a", mode=SelectionMode.REMOVE)
        assert sm.selected_ids == ["b"]

    def test_toggle_mode(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select("a")
        sm.select(["a", "b"], mode=SelectionMode.TOGGLE)
        assert set(sm.selected_ids) == {"b"}

    def test_multi_select_list(self) -> None:
        sg = _make_graph("a", "b", "c")
        sm = SelectionManager(sg)
        sm.select(["a", "b", "c"])
        assert sm.count == 3

    def test_skips_locked_nodes(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="locked", locked=True))
        sm = SelectionManager(sg)
        sm.select("locked")
        assert sm.is_empty

    def test_skips_root(self) -> None:
        sg = SceneGraph()
        sm = SelectionManager(sg)
        sm.select("root")
        assert sm.is_empty

    def test_skips_nonexistent(self) -> None:
        sg = SceneGraph()
        sm = SelectionManager(sg)
        sm.select("nonexistent")
        assert sm.is_empty


class TestSelectionBulkOps:
    def test_select_all(self) -> None:
        sg = _make_graph("a", "b", "c")
        sm = SelectionManager(sg)
        sm.select_all()
        assert sm.count == 3

    def test_select_all_skips_locked(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="a", visible=True))
        sg.add_node(SceneNode(id="b", visible=True, locked=True))
        sm = SelectionManager(sg)
        sm.select_all()
        assert "a" in sm.selected_ids
        assert "b" not in sm.selected_ids

    def test_deselect_specific(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select(["a", "b"])
        sm.deselect("a")
        assert sm.selected_ids == ["b"]

    def test_deselect_none_clears(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)
        sm.select("a")
        sm.deselect()
        assert sm.is_empty

    def test_clear(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select(["a", "b"])
        sm.clear()
        assert sm.is_empty
        assert sm.primary_id is None

    def test_clear_empty_noop(self) -> None:
        sg = SceneGraph()
        sm = SelectionManager(sg)
        sm.clear()  # no crash
        assert sm.is_empty

    def test_set_primary(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select(["a", "b"])
        assert sm.set_primary("b")
        assert sm.primary_id == "b"

    def test_set_primary_not_selected(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select("a")
        assert not sm.set_primary("b")

    def test_invert(self) -> None:
        sg = _make_graph("a", "b", "c")
        sm = SelectionManager(sg)
        sm.select("a")
        sm.invert()
        assert set(sm.selected_ids) == {"b", "c"}

    def test_select_by_component_ids(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="n1", component_id="c1"))
        sg.add_node(SceneNode(id="n2", component_id="c2"))
        sm = SelectionManager(sg)
        sm.select_by_component_ids(["c1", "c2"])
        assert set(sm.selected_ids) == {"n1", "n2"}

    def test_select_by_component_ids_missing(self) -> None:
        sg = SceneGraph()
        sm = SelectionManager(sg)
        sm.select_by_component_ids(["nonexistent"])
        assert sm.is_empty


class TestSelectionBounds:
    def test_select_in_bounds_intersects(self) -> None:
        sg = SceneGraph()
        n = SceneNode(id="inside", bounds=BoundingBox(max_x=5, max_y=5))
        sg.add_node(n)
        sm = SelectionManager(sg)
        sm.select_in_bounds(BoundingBox(max_x=10, max_y=10))
        assert "inside" in sm.selected_ids

    def test_select_in_bounds_fully_contained(self) -> None:
        sg = SceneGraph()
        n = SceneNode(id="inside", bounds=BoundingBox(min_x=2, min_y=2, max_x=4, max_y=4))
        sg.add_node(n)
        sm = SelectionManager(sg)
        sm.select_in_bounds(
            BoundingBox(max_x=10, max_y=10),
            fully_contained=True,
        )
        assert "inside" in sm.selected_ids

    def test_select_in_bounds_partially_outside(self) -> None:
        sg = SceneGraph()
        n = SceneNode(
            id="partial",
            bounds=BoundingBox(min_x=-5, max_x=5, max_y=5),
        )
        sg.add_node(n)
        sm = SelectionManager(sg)
        sm.select_in_bounds(
            BoundingBox(max_x=10, max_y=10),
            fully_contained=True,
        )
        assert "partial" not in sm.selected_ids

    def test_get_selection_bounds(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="a", bounds=BoundingBox(max_x=10, max_y=10)))
        sg.add_node(
            SceneNode(
                id="b",
                transform=Transform(x=20),
                bounds=BoundingBox(max_x=5, max_y=5),
            )
        )
        sm = SelectionManager(sg)
        sm.select(["a", "b"])
        bounds = sm.get_selection_bounds()
        assert bounds is not None
        assert bounds.max_x == 25

    def test_get_selection_bounds_empty(self) -> None:
        sg = SceneGraph()
        sm = SelectionManager(sg)
        assert sm.get_selection_bounds() is None


class TestSelectionEvents:
    def test_on_change(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)
        events: list[SelectionEvent] = []
        sm.on_change(events.append)
        sm.select("a")
        assert len(events) == 1
        assert "a" in events[0].added

    def test_off_change(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)
        events: list[SelectionEvent] = []
        sm.on_change(events.append)
        sm.off_change(events.append)
        sm.select("a")
        assert len(events) == 0

    def test_handler_error_does_not_break(self) -> None:
        sg = _make_graph("a")
        sm = SelectionManager(sg)

        def bad_handler(e: SelectionEvent) -> None:
            raise ValueError("boom")

        sm.on_change(bad_handler)
        sm.select("a")  # should not raise
        assert sm.is_selected("a")

    def test_clear_emits_event(self) -> None:
        sg = _make_graph("a", "b")
        sm = SelectionManager(sg)
        sm.select(["a", "b"])
        events: list[SelectionEvent] = []
        sm.on_change(events.append)
        sm.clear()
        assert len(events) == 1
        assert set(events[0].removed) == {"a", "b"}
        assert events[0].selection == []
