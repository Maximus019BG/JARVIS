"""Tests for TransformManager and TransformConstraint."""

from __future__ import annotations

from core.blueprint.scene_graph import BoundingBox, SceneGraph, SceneNode, Transform
from core.blueprint.selection import SelectionManager
from core.blueprint.history import CommandHistory
from core.blueprint.transforms import (
    TransformConstraint,
    TransformManager,
    TransformSpace,
    TransformType,
)


def _setup() -> tuple[SceneGraph, SelectionManager, TransformManager]:
    """Create scene with one node, selected."""
    sg = SceneGraph()
    n = SceneNode(id="n1", transform=Transform(x=0, y=0, z=0))
    sg.add_node(n)
    sel = SelectionManager(sg)
    sel.select("n1")
    tm = TransformManager(sg, sel)
    return sg, sel, tm


class TestTransformConstraint:
    def test_apply_translation_lock_x(self) -> None:
        c = TransformConstraint(lock_x=True)
        dx, dy, dz = c.apply_translation(10, 20, 30)
        assert dx == 0
        assert dy == 20
        assert dz == 30

    def test_apply_translation_lock_all(self) -> None:
        c = TransformConstraint(lock_x=True, lock_y=True, lock_z=True)
        assert c.apply_translation(10, 20, 30) == (0, 0, 0)

    def test_apply_translation_snap(self) -> None:
        c = TransformConstraint(snap_position=10.0)
        dx, dy, dz = c.apply_translation(12, 18, 5)
        assert dx == 10.0
        assert dy == 20.0
        # round(5/10)=round(0.5)=0 (Python banker's rounding) → 0.0
        assert dz == 0.0

    def test_apply_rotation_lock(self) -> None:
        c = TransformConstraint(lock_y=True)
        drx, dry, drz = c.apply_rotation(45, 90, 180)
        assert drx == 45
        assert dry == 0
        assert drz == 180

    def test_apply_rotation_snap(self) -> None:
        c = TransformConstraint(snap_angle=15.0)
        drx, dry, drz = c.apply_rotation(12, 8, 37)
        assert drx == 15.0
        # round(8/15)=round(0.533)=1 → 1*15=15.0
        assert dry == 15.0
        # round(37/15)=round(2.467)=2 → 2*15=30.0
        assert drz == 30.0

    def test_clamp_position(self) -> None:
        c = TransformConstraint(min_x=-10, max_x=10, min_y=-5, max_y=5)
        x, y, z = c.clamp_position(20, -10, 0)
        assert x == 10
        assert y == -5
        assert z == 0

    def test_clamp_position_no_bounds(self) -> None:
        c = TransformConstraint()
        assert c.clamp_position(100, 200, 300) == (100, 200, 300)


class TestTransformManagerLifecycle:
    def test_begin_on_empty_selection_fails(self) -> None:
        sg = SceneGraph()
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert not tm.begin_transform(TransformType.TRANSLATE)

    def test_begin_transform(self) -> None:
        _, _, tm = _setup()
        assert tm.begin_transform(TransformType.TRANSLATE, 0, 0)
        assert tm.is_transforming

    def test_end_transform(self) -> None:
        _, _, tm = _setup()
        tm.begin_transform(TransformType.TRANSLATE)
        assert tm.end_transform()
        assert not tm.is_transforming

    def test_end_without_begin(self) -> None:
        _, _, tm = _setup()
        assert not tm.end_transform()

    def test_cancel_transform(self) -> None:
        sg, sel, tm = _setup()
        tm.begin_transform(TransformType.TRANSLATE)
        tm.update_transform(dx=100, dy=200)
        tm.cancel_transform()
        assert not tm.is_transforming
        # Should restore original position
        node = sg.get_node("n1")
        assert node.transform.x == 0
        assert node.transform.y == 0

    def test_cancel_without_begin(self) -> None:
        _, _, tm = _setup()
        tm.cancel_transform()  # should not crash

    def test_begin_cancels_active(self) -> None:
        sg, _, tm = _setup()
        tm.begin_transform(TransformType.TRANSLATE)
        tm.update_transform(dx=100)
        # Starting a new transform should cancel the old one and restore
        tm.begin_transform(TransformType.ROTATE)
        node = sg.get_node("n1")
        assert node.transform.x == 0  # restored


class TestTransformManagerTranslate:
    def test_interactive_translate(self) -> None:
        sg, _, tm = _setup()
        tm.begin_transform(TransformType.TRANSLATE)
        tm.update_transform(dx=50, dy=30)
        node = sg.get_node("n1")
        assert node.transform.x == 50
        assert node.transform.y == 30

    def test_interactive_translate_with_constraint(self) -> None:
        sg, _, tm = _setup()
        tm.constraint = TransformConstraint(lock_y=True)
        tm.begin_transform(TransformType.TRANSLATE)
        tm.update_transform(dx=50, dy=30)
        node = sg.get_node("n1")
        assert node.transform.x == 50
        assert node.transform.y == 0  # locked

    def test_immediate_translate(self) -> None:
        sg, _, tm = _setup()
        assert tm.translate(10, 20)
        node = sg.get_node("n1")
        assert node.transform.x == 10
        assert node.transform.y == 20

    def test_translate_specific_nodes(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="a"))
        sg.add_node(SceneNode(id="b"))
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert tm.translate(10, 20, node_ids=["a"])
        assert sg.get_node("a").transform.x == 10
        assert sg.get_node("b").transform.x == 0

    def test_translate_empty_returns_false(self) -> None:
        sg = SceneGraph()
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert not tm.translate(10, 20)

    def test_translate_skips_locked(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="locked", locked=True))
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        tm.translate(10, 20, node_ids=["locked"])
        assert sg.get_node("locked").transform.x == 0


class TestTransformManagerRotate:
    def test_interactive_rotate(self) -> None:
        sg, _, tm = _setup()
        tm.begin_transform(TransformType.ROTATE)
        tm.update_transform(dx=45)
        node = sg.get_node("n1")
        assert node.transform.rx == 45

    def test_immediate_rotate(self) -> None:
        sg, _, tm = _setup()
        assert tm.rotate(drz=90)
        assert sg.get_node("n1").transform.rz == 90

    def test_rotate_empty_returns_false(self) -> None:
        sg = SceneGraph()
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert not tm.rotate(drz=90)


class TestTransformManagerScale:
    def test_interactive_scale(self) -> None:
        sg, _, tm = _setup()
        tm.begin_transform(TransformType.SCALE)
        tm.update_transform(dx=1.0, dy=1.0, dz=1.0)
        node = sg.get_node("n1")
        assert node.transform.sx == 2.0  # 1*(1+1)

    def test_scale_uniform(self) -> None:
        sg, _, tm = _setup()
        assert tm.scale_uniform(2.0)
        assert sg.get_node("n1").transform.sx == 2.0

    def test_scale_empty_returns_false(self) -> None:
        sg = SceneGraph()
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert not tm.scale_uniform(2.0)


class TestTransformManagerReset:
    def test_reset_transforms(self) -> None:
        sg, _, tm = _setup()
        sg.get_node("n1").transform.x = 100
        sg.get_node("n1").transform.rx = 45
        sg.get_node("n1").transform.sx = 3
        assert tm.reset_transforms()
        node = sg.get_node("n1")
        assert node.transform.x == 0
        assert node.transform.rx == 0
        assert node.transform.sx == 1

    def test_reset_empty_returns_false(self) -> None:
        sg = SceneGraph()
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert not tm.reset_transforms()


class TestTransformManagerSetPosition:
    def test_set_position(self) -> None:
        sg, _, tm = _setup()
        assert tm.set_position(100, 200, 300)
        node = sg.get_node("n1")
        assert node.transform.position == (100, 200, 300)

    def test_set_position_specific_node(self) -> None:
        sg, _, tm = _setup()
        assert tm.set_position(50, 60, 70, node_id="n1")
        assert sg.get_node("n1").transform.position == (50, 60, 70)

    def test_set_position_no_selection(self) -> None:
        sg = SceneGraph()
        sel = SelectionManager(sg)
        tm = TransformManager(sg, sel)
        assert not tm.set_position(1, 2, 3)

    def test_set_position_with_clamping(self) -> None:
        sg, _, tm = _setup()
        tm.constraint = TransformConstraint(max_x=50, max_y=50)
        assert tm.set_position(100, 100)
        node = sg.get_node("n1")
        assert node.transform.x == 50
        assert node.transform.y == 50

    def test_set_position_locked_node(self) -> None:
        sg = SceneGraph()
        sg.add_node(SceneNode(id="locked", locked=True))
        sel = SelectionManager(sg)
        sel.select("locked")  # won't actually select (locked)
        tm = TransformManager(sg, sel)
        assert not tm.set_position(10, 20)


class TestTransformManagerSpace:
    def test_space_default_local(self) -> None:
        _, _, tm = _setup()
        assert tm.space == TransformSpace.LOCAL

    def test_space_setter(self) -> None:
        _, _, tm = _setup()
        tm.space = TransformSpace.WORLD
        assert tm.space == TransformSpace.WORLD


class TestUpdateTransformWithoutBegin:
    def test_noop(self) -> None:
        _, _, tm = _setup()
        tm.update_transform(dx=100)  # should not crash or do anything
        # No side effects if not active
