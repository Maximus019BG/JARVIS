"""Tests for command history — undo/redo with all command types."""

from __future__ import annotations

from core.blueprint.scene_graph import BoundingBox, SceneGraph, SceneNode, Transform
from core.blueprint.history import (
    AddNodeCommand,
    CommandHistory,
    CompositeCommand,
    RemoveNodeCommand,
    RotateCommand,
    ScaleCommand,
    TransformCommand,
)


def _make_scene() -> SceneGraph:
    sg = SceneGraph()
    n = SceneNode(id="n1", name="Node 1", component_id="c1", transform=Transform(x=10, y=20, z=0))
    sg.add_node(n)
    return sg


class TestTransformCommand:
    def test_execute(self) -> None:
        sg = _make_scene()
        cmd = TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg)
        assert cmd.execute()
        node = sg.get_node("n1")
        assert node.transform.x == 50
        assert node.transform.y == 60

    def test_undo(self) -> None:
        sg = _make_scene()
        cmd = TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg)
        cmd.execute()
        assert cmd.undo()
        node = sg.get_node("n1")
        assert node.transform.x == 10
        assert node.transform.y == 20

    def test_execute_missing_node(self) -> None:
        sg = SceneGraph()
        cmd = TransformCommand("missing", 0, 0, 0, 1, 1, 1, sg)
        assert not cmd.execute()

    def test_description(self) -> None:
        sg = _make_scene()
        cmd = TransformCommand("n1", 0, 0, 0, 1, 1, 1, sg)
        assert "n1" in cmd.description


class TestRotateCommand:
    def test_execute(self) -> None:
        sg = _make_scene()
        cmd = RotateCommand("n1", 0, 0, 0, 45, 90, 180, sg)
        assert cmd.execute()
        node = sg.get_node("n1")
        assert node.transform.rx == 45
        assert node.transform.ry == 90
        assert node.transform.rz == 180

    def test_undo(self) -> None:
        sg = _make_scene()
        cmd = RotateCommand("n1", 0, 0, 0, 45, 90, 180, sg)
        cmd.execute()
        assert cmd.undo()
        node = sg.get_node("n1")
        assert node.transform.rx == 0

    def test_missing_node(self) -> None:
        sg = SceneGraph()
        cmd = RotateCommand("missing", 0, 0, 0, 45, 0, 0, sg)
        assert not cmd.execute()
        assert not cmd.undo()

    def test_description(self) -> None:
        cmd = RotateCommand("abc", 0, 0, 0, 0, 0, 0, None)
        assert "abc" in cmd.description


class TestScaleCommand:
    def test_execute(self) -> None:
        sg = _make_scene()
        cmd = ScaleCommand("n1", 1, 1, 1, 2, 3, 4, sg)
        assert cmd.execute()
        node = sg.get_node("n1")
        assert node.transform.sx == 2

    def test_undo(self) -> None:
        sg = _make_scene()
        cmd = ScaleCommand("n1", 1, 1, 1, 2, 3, 4, sg)
        cmd.execute()
        assert cmd.undo()
        node = sg.get_node("n1")
        assert node.transform.sx == 1

    def test_missing_node(self) -> None:
        sg = SceneGraph()
        assert not ScaleCommand("missing", 1, 1, 1, 2, 2, 2, sg).execute()

    def test_description(self) -> None:
        cmd = ScaleCommand("xyz", 1, 1, 1, 2, 2, 2, None)
        assert "xyz" in cmd.description


class TestAddNodeCommand:
    def test_execute_and_undo(self) -> None:
        sg = SceneGraph()
        cmd = AddNodeCommand(
            node_data={"id": "new", "name": "New Node"},
            parent_id="root",
            scene_graph=sg,
        )
        assert cmd.execute()
        assert sg.get_node("new") is not None

        assert cmd.undo()
        assert sg.get_node("new") is None

    def test_execute_with_transform(self) -> None:
        sg = SceneGraph()
        cmd = AddNodeCommand(
            node_data={
                "id": "t1",
                "name": "Transformed",
                "transform": {"x": 10, "y": 20},
                "bounds": {"max_x": 5, "max_y": 5},
            },
            parent_id="root",
            scene_graph=sg,
        )
        assert cmd.execute()
        node = sg.get_node("t1")
        assert node.transform.x == 10

    def test_description(self) -> None:
        cmd = AddNodeCommand({"id": "abc"}, "root", None)
        assert "abc" in cmd.description


class TestRemoveNodeCommand:
    def test_execute_and_undo(self) -> None:
        sg = _make_scene()
        cmd = RemoveNodeCommand(node_id="n1", scene_graph=sg)
        assert cmd.execute()
        assert sg.get_node("n1") is None

        # Undo should restore
        assert cmd.undo()
        node = sg.get_node("n1")
        assert node is not None
        assert node.transform.x == 10

    def test_execute_missing_node(self) -> None:
        sg = SceneGraph()
        cmd = RemoveNodeCommand(node_id="missing", scene_graph=sg)
        assert not cmd.execute()

    def test_description(self) -> None:
        cmd = RemoveNodeCommand(node_id="abc")
        assert "abc" in cmd.description


class TestCompositeCommand:
    def test_execute_all(self) -> None:
        sg = _make_scene()
        composite = CompositeCommand(_description="Multi")
        composite.add(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        assert composite.execute()
        assert sg.get_node("n1").transform.x == 50

    def test_undo_all(self) -> None:
        sg = _make_scene()
        composite = CompositeCommand()
        composite.add(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        composite.execute()
        assert composite.undo()
        assert sg.get_node("n1").transform.x == 10

    def test_rollback_on_failure(self) -> None:
        sg = _make_scene()
        composite = CompositeCommand()
        # First cmd succeeds
        composite.add(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        # Second cmd fails (missing node)
        composite.add(TransformCommand("missing", 0, 0, 0, 1, 1, 1, sg))
        result = composite.execute()
        assert not result
        # Should have rolled back the first cmd
        assert sg.get_node("n1").transform.x == 10

    def test_description(self) -> None:
        composite = CompositeCommand(_description="Test Composite")
        assert composite.description == "Test Composite"


class TestCommandHistory:
    def test_execute_and_undo(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        cmd = TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg)
        assert history.execute(cmd)
        assert history.can_undo
        assert not history.can_redo

        assert history.undo()
        assert sg.get_node("n1").transform.x == 10
        assert not history.can_undo
        assert history.can_redo

    def test_redo(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        history.execute(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        history.undo()
        assert history.redo()
        assert sg.get_node("n1").transform.x == 50

    def test_new_action_clears_redo(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        history.execute(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        history.undo()
        assert history.can_redo
        history.execute(TransformCommand("n1", 10, 20, 0, 30, 40, 0, sg))
        assert not history.can_redo

    def test_max_size_trims(self) -> None:
        sg = _make_scene()
        history = CommandHistory(max_size=2)
        history.execute(TransformCommand("n1", 10, 20, 0, 1, 1, 0, sg))
        history.execute(TransformCommand("n1", 1, 1, 0, 2, 2, 0, sg))
        history.execute(TransformCommand("n1", 2, 2, 0, 3, 3, 0, sg))
        # Only 2 should remain
        history.undo()
        history.undo()
        assert not history.can_undo

    def test_undo_empty(self) -> None:
        history = CommandHistory()
        assert not history.undo()

    def test_redo_empty(self) -> None:
        history = CommandHistory()
        assert not history.redo()

    def test_clear(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        history.execute(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        history.clear()
        assert not history.can_undo
        assert not history.can_redo

    def test_descriptions(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        history.execute(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        assert history.undo_description is not None
        assert "n1" in history.undo_description
        assert history.redo_description is None

    def test_get_undo_history(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        history.execute(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        history.execute(RotateCommand("n1", 0, 0, 0, 45, 0, 0, sg))
        undo_list = history.get_undo_history()
        assert len(undo_list) == 2

    def test_get_redo_history(self) -> None:
        sg = _make_scene()
        history = CommandHistory()
        history.execute(TransformCommand("n1", 10, 20, 0, 50, 60, 0, sg))
        history.undo()
        redo_list = history.get_redo_history()
        assert len(redo_list) == 1

    def test_execute_failure_not_added(self) -> None:
        sg = SceneGraph()
        history = CommandHistory()
        cmd = TransformCommand("missing", 0, 0, 0, 1, 1, 1, sg)
        assert not history.execute(cmd)
        assert not history.can_undo
