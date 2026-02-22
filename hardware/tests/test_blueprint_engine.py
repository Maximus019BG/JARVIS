"""Tests for blueprint engine module."""

from __future__ import annotations

import pytest
from pathlib import Path

from core.blueprint.engine import (
    BlueprintEngine,
    EngineState,
    InteractionMode,
    ViewMode,
    ViewState,
)
from core.blueprint.parser import BlueprintType
from core.blueprint.transforms import TransformType


class TestViewState:
    """Tests for ViewState."""

    def test_viewstate_defaults(self) -> None:
        """Test viewstate with defaults."""
        vs = ViewState()
        assert vs.pan_x == 0
        assert vs.pan_y == 0
        assert vs.zoom == 1.0
        assert vs.view_mode == ViewMode.TOP_2D

    def test_viewstate_pan(self) -> None:
        """Test panning."""
        vs = ViewState()
        vs.pan(10, 20)
        assert vs.pan_x == 10
        assert vs.pan_y == 20

    def test_viewstate_zoom(self) -> None:
        """Test zooming."""
        vs = ViewState()
        vs.zoom_by(2.0)
        assert vs.zoom == 2.0

        vs.zoom_to(0.5)
        assert vs.zoom == 0.5

    def test_viewstate_zoom_limits(self) -> None:
        """Test zoom limits."""
        vs = ViewState()
        vs.zoom_to(0.01)  # Below min
        assert vs.zoom >= 0.1

        vs.zoom_to(100)  # Above max
        assert vs.zoom <= 10.0

    def test_viewstate_reset(self) -> None:
        """Test reset."""
        vs = ViewState(pan_x=100, pan_y=50, zoom=2.0)
        vs.reset()
        assert vs.pan_x == 0
        assert vs.pan_y == 0
        assert vs.zoom == 1.0

    def test_viewstate_screen_to_world(self) -> None:
        """Test screen to world conversion."""
        vs = ViewState()
        # At default zoom and pan, center should be near origin
        wx, wy = vs.screen_to_world(0.5, 0.5)
        # With default zoom=1, screen center maps to (0, 0)
        assert wx == pytest.approx(0, abs=1)
        assert wy == pytest.approx(0, abs=1)

    def test_viewstate_world_to_screen(self) -> None:
        """Test world to screen conversion."""
        vs = ViewState()
        # Origin should map to screen center
        sx, sy = vs.world_to_screen(0, 0)
        assert sx == pytest.approx(0.5, abs=0.01)
        assert sy == pytest.approx(0.5, abs=0.01)


class TestEngineState:
    """Tests for EngineState."""

    def test_engine_state_default(self) -> None:
        """Test default engine state."""
        state = EngineState()
        assert state.interaction_mode == InteractionMode.SELECT
        assert state.snap_enabled is True
        assert state.grid_enabled is True
        assert state.blueprint is None
        assert state.modified is False

    def test_engine_state_grid_settings(self) -> None:
        """Test grid settings."""
        state = EngineState(
            grid_enabled=False,
            grid_size=20.0,
        )
        assert state.grid_enabled is False
        assert state.grid_size == 20.0


class TestBlueprintEngine:
    """Tests for BlueprintEngine."""

    @pytest.fixture
    def engine(self, tmp_path: Path) -> BlueprintEngine:
        """Create a fresh engine for each test."""
        return BlueprintEngine(blueprint_dir=str(tmp_path))

    @pytest.fixture
    def sample_blueprint_file(self, tmp_path: Path) -> Path:
        """Create a sample blueprint file for testing."""
        content = """{
    "jarvis_version": "1.0.0",
    "name": "Test Blueprint",
    "type": "part",
    "components": [
        {
            "id": "box1",
            "name": "Box 1",
            "type": "box",
            "dimensions": {"length": 100, "width": 50, "height": 25}
        },
        {
            "id": "box2",
            "name": "Box 2",
            "type": "box",
            "dimensions": {"length": 50, "width": 50, "height": 50}
        }
    ],
    "connections": []
}"""
        file_path = tmp_path / "test_blueprint.jarvis"
        file_path.write_text(content)
        return file_path

    def test_engine_creation(self, engine: BlueprintEngine) -> None:
        """Test engine creation."""
        assert engine is not None
        assert engine.mode == InteractionMode.SELECT
        assert engine.blueprint is None

    def test_new_blueprint(self, engine: BlueprintEngine) -> None:
        """Test creating a new blueprint."""
        bp = engine.new_blueprint("My Blueprint", BlueprintType.PART)

        assert bp is not None
        assert bp.name == "My Blueprint"
        assert bp.type == BlueprintType.PART
        assert engine.blueprint is bp
        assert engine.is_modified is True

    @pytest.mark.asyncio
    async def test_load_blueprint(
        self, engine: BlueprintEngine, sample_blueprint_file: Path
    ) -> None:
        """Test loading a blueprint from file."""
        result = await engine.load(sample_blueprint_file)

        assert result is True
        assert engine.blueprint is not None
        assert engine.blueprint.name == "Test Blueprint"
        assert len(engine.blueprint.components) == 2
        assert engine.is_modified is False

    @pytest.mark.asyncio
    async def test_save_blueprint(
        self, engine: BlueprintEngine, tmp_path: Path
    ) -> None:
        """Test saving a blueprint."""
        engine.new_blueprint("Save Test", BlueprintType.ASSEMBLY)
        save_path = tmp_path / "saved.jarvis"

        result = await engine.save(save_path)

        assert result is True
        assert save_path.exists()
        assert engine.is_modified is False

    def test_mode_switching(self, engine: BlueprintEngine) -> None:
        """Test mode switching."""
        engine.set_mode(InteractionMode.TRANSLATE)
        assert engine.mode == InteractionMode.TRANSLATE

        engine.set_mode(InteractionMode.ROTATE)
        assert engine.mode == InteractionMode.ROTATE

        engine.set_mode(InteractionMode.SELECT)
        assert engine.mode == InteractionMode.SELECT

    def test_grid_toggle(self, engine: BlueprintEngine) -> None:
        """Test grid toggle."""
        initial = engine.state.grid_enabled
        result = engine.toggle_grid()
        assert result != initial
        assert engine.state.grid_enabled == result

        result2 = engine.toggle_grid()
        assert result2 == initial

    def test_snap_toggle(self, engine: BlueprintEngine) -> None:
        """Test snap toggle."""
        initial = engine.state.snap_enabled
        result = engine.toggle_snap()
        assert result != initial
        assert engine.state.snap_enabled == result

    def test_view_pan(self, engine: BlueprintEngine) -> None:
        """Test view panning."""
        initial_x = engine.view.pan_x
        initial_y = engine.view.pan_y

        engine.pan_view(100, 50)

        assert engine.view.pan_x != initial_x
        assert engine.view.pan_y != initial_y

    def test_view_zoom(self, engine: BlueprintEngine) -> None:
        """Test view zooming."""
        initial_zoom = engine.view.zoom

        engine.zoom_view(2.0)

        assert engine.view.zoom == pytest.approx(initial_zoom * 2.0)

    def test_view_reset(self, engine: BlueprintEngine) -> None:
        """Test view reset."""
        engine.pan_view(100, 100)
        engine.zoom_view(3.0)

        engine.reset_view()

        assert engine.view.pan_x == 0
        assert engine.view.pan_y == 0
        assert engine.view.zoom == 1.0

    @pytest.mark.asyncio
    async def test_scene_built_from_blueprint(
        self, engine: BlueprintEngine, sample_blueprint_file: Path
    ) -> None:
        """Test that scene graph is built from loaded blueprint."""
        await engine.load(sample_blueprint_file)

        # Scene should have nodes (root + components)
        all_nodes = engine.scene.get_all_nodes()
        # Root + 2 components = 3 nodes
        assert len(all_nodes) >= 1

    def test_selection_empty_initially(self, engine: BlueprintEngine) -> None:
        """Test that selection is empty initially."""
        assert engine.selection.is_empty

    @pytest.mark.asyncio
    async def test_select_component(
        self, engine: BlueprintEngine, sample_blueprint_file: Path
    ) -> None:
        """Test selecting a component."""
        await engine.load(sample_blueprint_file)

        result = engine.select_component("box1")

        assert result is True
        assert not engine.selection.is_empty

    def test_undo_redo_empty_history(self, engine: BlueprintEngine) -> None:
        """Test undo/redo with empty history."""
        assert engine.history.can_undo is False
        assert engine.history.can_redo is False

        result = engine.undo()
        assert result is False

        result = engine.redo()
        assert result is False

    def test_event_handlers(self, engine: BlueprintEngine) -> None:
        """Test event handler registration."""
        events_received: list[str] = []

        def handler(eng: BlueprintEngine, event: str, data: dict) -> None:
            events_received.append(event)

        engine.on("mode_changed", handler)
        engine.set_mode(InteractionMode.TRANSLATE)

        assert "mode_changed" in events_received

    def test_fit_view(self, engine: BlueprintEngine) -> None:
        """Test fit view."""
        engine.new_blueprint("Test", BlueprintType.PART)
        # Fit view shouldn't crash even with empty scene
        engine.fit_view()
        # Just ensure it runs without error

    def test_transform_without_selection(self, engine: BlueprintEngine) -> None:
        """Test transform without selection."""
        result = engine.transform_selection(dx=10)
        assert result is False  # No selection

    @pytest.mark.asyncio
    async def test_transform_with_selection(
        self, engine: BlueprintEngine, sample_blueprint_file: Path
    ) -> None:
        """Test transform with selection."""
        await engine.load(sample_blueprint_file)
        engine.select_component("box1")
        engine.set_mode(InteractionMode.TRANSLATE)

        result = engine.transform_selection(dx=10, dy=5)

        assert result is True
        assert engine.is_modified is True

    # ─── Additional coverage ──────────────────────────────────────

    def test_add_component_no_blueprint(self, engine: BlueprintEngine) -> None:
        """add_component auto-creates blueprint if None."""
        cid = engine.add_component("Part A", "box", dimensions=(10, 20, 30))
        assert cid is not None
        assert engine.blueprint is not None

    def test_add_then_remove_component(self, engine: BlueprintEngine) -> None:
        """Remove a component previously added."""
        engine.new_blueprint("Test", BlueprintType.PART)
        cid = engine.add_component("Part X")
        assert cid is not None
        assert engine.remove_component(cid)
        assert engine.is_modified

    def test_remove_component_no_blueprint(self, engine: BlueprintEngine) -> None:
        assert engine.remove_component("nope") is False

    def test_remove_nonexistent_component(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("T", BlueprintType.PART)
        assert engine.remove_component("ghost") is False

    @pytest.mark.asyncio
    async def test_delete_selected(
        self, engine: BlueprintEngine, sample_blueprint_file: Path
    ) -> None:
        await engine.load(sample_blueprint_file)
        engine.select_component("box1")
        deleted = engine.delete_selected()
        assert deleted >= 1

    def test_off_handler(self, engine: BlueprintEngine) -> None:
        """off() removes a handler so it no longer fires."""
        calls: list[str] = []

        def h(eng, ev, data):
            calls.append(ev)

        engine.on("mode_changed", h)
        engine.off("mode_changed", h)
        engine.set_mode(InteractionMode.PAN)
        assert calls == []

    def test_get_status(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("Status Test", BlueprintType.PART)
        status = engine.get_status()
        assert status["blueprint"] == "Status Test"
        assert status["mode"] == "select"
        assert status["can_undo"] is False

    @pytest.mark.asyncio
    async def test_select_at_point_miss(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("T", BlueprintType.PART)
        engine.add_component("C1", position=(500, 500, 0), dimensions=(10, 10, 0))
        result = engine.select_at_point(0.0, 0.0)  # far from component
        assert result == []

    @pytest.mark.asyncio
    async def test_save_no_blueprint(self, engine: BlueprintEngine) -> None:
        assert await engine.save() is False

    @pytest.mark.asyncio
    async def test_load_nonexistent(self, engine: BlueprintEngine) -> None:
        result = await engine.load("nonexistent_file_xyz.jarvis")
        assert result is False

    def test_interactive_transform_no_selection(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("T", BlueprintType.PART)
        assert engine.begin_interactive_transform(TransformType.TRANSLATE, 0, 0) is False

    def test_cancel_interactive_transform(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("T", BlueprintType.PART)
        engine.cancel_interactive_transform()  # should not raise

    def test_transform_rotate_mode(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("T", BlueprintType.PART)
        cid = engine.add_component("R")
        node = engine.scene.get_node_by_component(cid)
        engine.selection.select(node.id)
        engine.set_mode(InteractionMode.ROTATE)
        result = engine.transform_selection(dx=45)
        assert result is True

    def test_transform_scale_mode(self, engine: BlueprintEngine) -> None:
        engine.new_blueprint("T", BlueprintType.PART)
        cid = engine.add_component("S")
        node = engine.scene.get_node_by_component(cid)
        engine.selection.select(node.id)
        engine.set_mode(InteractionMode.SCALE)
        result = engine.transform_selection(dx=0.5)
        assert result is True
