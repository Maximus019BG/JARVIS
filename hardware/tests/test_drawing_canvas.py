"""Tests for DrawingCanvas and Layer classes."""

from __future__ import annotations

from core.blueprint.drawing.canvas import DrawingCanvas, Layer
from core.blueprint.drawing.primitives import Line, Point2D, Circle, Rectangle


def _line(x1: float = 0, y1: float = 0, x2: float = 100, y2: float = 100) -> Line:
    return Line(start=Point2D(x1, y1), end=Point2D(x2, y2))


# ── Layer ────────────────────────────────────────────────────────────


class TestLayer:
    def test_defaults(self) -> None:
        layer = Layer()
        assert layer.name == "Layer"
        assert layer.visible
        assert not layer.locked
        assert layer.count == 0

    def test_add_remove(self) -> None:
        layer = Layer()
        line = _line()
        layer.add(line)
        assert layer.count == 1
        assert layer.get(line.id) is line
        assert layer.remove(line.id)
        assert layer.count == 0

    def test_remove_nonexistent(self) -> None:
        assert Layer().remove("nope") is False

    def test_get_nonexistent(self) -> None:
        assert Layer().get("nope") is None

    def test_clear(self) -> None:
        layer = Layer()
        layer.add(_line())
        layer.add(_line())
        layer.clear()
        assert layer.count == 0

    def test_iter_visible(self) -> None:
        layer = Layer()
        l1 = _line()
        l2 = _line()
        l2.visible = False
        layer.add(l1)
        layer.add(l2)
        visible = list(layer.iter_visible())
        assert len(visible) == 1
        assert visible[0] is l1

    def test_iter_visible_hidden_layer(self) -> None:
        layer = Layer(visible=False)
        layer.add(_line())
        assert list(layer.iter_visible()) == []

    def test_find_at_point(self) -> None:
        layer = Layer()
        line = Line(start=Point2D(0, 0), end=Point2D(100, 0))
        layer.add(line)
        hits = layer.find_at_point(Point2D(50, 0))
        assert len(hits) == 1

    def test_find_at_point_hidden_layer(self) -> None:
        layer = Layer(visible=False)
        layer.add(_line())
        assert layer.find_at_point(Point2D(50, 50)) == []

    def test_find_at_point_locked_prim_skipped(self) -> None:
        layer = Layer()
        line = _line()
        line.locked = True
        layer.add(line)
        assert layer.find_at_point(Point2D(50, 50)) == []

    def test_to_dict(self) -> None:
        layer = Layer(name="Test")
        layer.add(_line())
        d = layer.to_dict()
        assert d["name"] == "Test"
        assert len(d["primitives"]) == 1


# ── DrawingCanvas ────────────────────────────────────────────────────


class TestDrawingCanvas:
    def test_default_layer(self) -> None:
        canvas = DrawingCanvas()
        assert canvas.layer_count == 1
        assert canvas.active_layer is not None
        assert canvas.active_layer.name == "Default"

    def test_add_layer(self) -> None:
        canvas = DrawingCanvas()
        new = canvas.add_layer("Annotations")
        assert canvas.layer_count == 2
        assert canvas.get_layer(new.id) is new
        assert canvas.get_layer_by_name("Annotations") is new

    def test_add_layer_at_index(self) -> None:
        canvas = DrawingCanvas()
        bottom = canvas.add_layer("Bottom", index=0)
        assert canvas.layers[0] is bottom

    def test_remove_layer(self) -> None:
        canvas = DrawingCanvas()
        extra = canvas.add_layer("Extra")
        assert canvas.remove_layer(extra.id)
        assert canvas.layer_count == 1

    def test_remove_last_layer_prevented(self) -> None:
        canvas = DrawingCanvas()
        assert not canvas.remove_layer(canvas.active_layer.id)

    def test_remove_active_reassigns(self) -> None:
        canvas = DrawingCanvas()
        default_id = canvas.active_layer.id
        extra = canvas.add_layer("Extra")
        canvas.set_active_layer(extra.id)
        canvas.remove_layer(extra.id)
        assert canvas.active_layer is not None

    def test_remove_nonexistent(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_layer("X")
        assert not canvas.remove_layer("nope")

    def test_set_active_layer(self) -> None:
        canvas = DrawingCanvas()
        n = canvas.add_layer("New")
        assert canvas.set_active_layer(n.id)
        assert canvas.active_layer.id == n.id

    def test_set_active_layer_invalid(self) -> None:
        canvas = DrawingCanvas()
        assert not canvas.set_active_layer("nope")

    def test_move_layer(self) -> None:
        canvas = DrawingCanvas()
        a = canvas.add_layer("A")
        b = canvas.add_layer("B")
        canvas.move_layer(a.id, 99)  # beyond end → clamped
        assert canvas.layers[-1].id == a.id

    def test_move_layer_invalid(self) -> None:
        canvas = DrawingCanvas()
        assert not canvas.move_layer("nope", 0)

    def test_add_primitive_to_active(self) -> None:
        canvas = DrawingCanvas()
        line = _line()
        assert canvas.add_primitive(line)
        assert canvas.total_primitive_count() == 1

    def test_add_primitive_to_specific_layer(self) -> None:
        canvas = DrawingCanvas()
        lay = canvas.add_layer("Custom")
        line = _line()
        assert canvas.add_primitive(line, layer_id=lay.id)
        prim, container = canvas.get_primitive(line.id)
        assert container.id == lay.id

    def test_add_primitive_to_locked_layer(self) -> None:
        canvas = DrawingCanvas()
        canvas.active_layer.locked = True
        assert not canvas.add_primitive(_line())

    def test_remove_primitive(self) -> None:
        canvas = DrawingCanvas()
        line = _line()
        canvas.add_primitive(line)
        assert canvas.remove_primitive(line.id)
        assert canvas.total_primitive_count() == 0

    def test_remove_primitive_not_found(self) -> None:
        canvas = DrawingCanvas()
        assert not canvas.remove_primitive("nope")

    def test_get_primitive_not_found(self) -> None:
        canvas = DrawingCanvas()
        assert canvas.get_primitive("nope") == (None, None)

    def test_find_at_point(self) -> None:
        canvas = DrawingCanvas()
        line = Line(start=Point2D(0, 0), end=Point2D(100, 0))
        canvas.add_primitive(line)
        hits = canvas.find_at_point(Point2D(50, 0))
        assert len(hits) == 1
        assert hits[0][0].id == line.id

    def test_find_at_point_hidden_layer(self) -> None:
        canvas = DrawingCanvas()
        canvas.active_layer.visible = False
        canvas.add_primitive(Line(start=Point2D(0, 0), end=Point2D(100, 0)))
        assert canvas.find_at_point(Point2D(50, 0)) == []

    def test_iter_all_primitives(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_primitive(_line())
        canvas.add_primitive(_line())
        assert len(list(canvas.iter_all_primitives())) == 2

    def test_iter_visible_primitives(self) -> None:
        canvas = DrawingCanvas()
        l1 = _line()
        l2 = _line()
        l2.visible = False
        canvas.add_primitive(l1)
        canvas.add_primitive(l2)
        vis = list(canvas.iter_visible_primitives())
        assert len(vis) == 1

    def test_get_bounds(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_primitive(Line(start=Point2D(10, 20), end=Point2D(100, 200)))
        bounds = canvas.get_bounds()
        assert bounds is not None
        assert bounds[0].x == 10
        assert bounds[1].y == 200

    def test_get_bounds_empty(self) -> None:
        canvas = DrawingCanvas()
        assert canvas.get_bounds() is None

    def test_clear(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_primitive(_line())
        canvas.add_layer("Extra")
        canvas.add_primitive(_line(), layer_id=canvas.layers[1].id)
        canvas.clear()
        assert canvas.total_primitive_count() == 0

    def test_clear_layer(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_primitive(_line())
        assert canvas.clear_layer(canvas.active_layer.id)
        assert canvas.total_primitive_count() == 0

    def test_clear_layer_invalid(self) -> None:
        canvas = DrawingCanvas()
        assert not canvas.clear_layer("nope")

    def test_to_dict(self) -> None:
        canvas = DrawingCanvas()
        d = canvas.to_dict()
        assert "layers" in d
        assert "active_layer_id" in d

    def test_duplicate_layer(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_primitive(_line())
        default_id = canvas.active_layer.id
        dup = canvas.duplicate_layer(default_id)
        assert dup is not None
        assert "copy" in dup.name
        assert dup.count == 1
        assert canvas.layer_count == 2

    def test_duplicate_layer_invalid(self) -> None:
        canvas = DrawingCanvas()
        assert canvas.duplicate_layer("nope") is None

    def test_merge_layers(self) -> None:
        canvas = DrawingCanvas()
        canvas.add_primitive(_line())
        extra = canvas.add_layer("Extra")
        l2 = _line()
        canvas.add_primitive(l2, layer_id=extra.id)
        merged = canvas.merge_layers(
            [canvas.layers[0].id, extra.id], name="Merged"
        )
        assert merged is not None
        assert merged.count == 2
        assert canvas.layer_count == 1

    def test_merge_layers_empty_ids(self) -> None:
        canvas = DrawingCanvas()
        assert canvas.merge_layers([]) is None

    def test_merge_updates_active(self) -> None:
        canvas = DrawingCanvas()
        active_id = canvas.active_layer.id
        extra = canvas.add_layer("Extra")
        canvas.merge_layers([active_id, extra.id])
        assert canvas.active_layer is not None
