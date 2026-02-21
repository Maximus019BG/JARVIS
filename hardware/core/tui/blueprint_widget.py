"""Blueprint Engine Widget for the TUI.

Renders the blueprint engine grid, component visualization, and status
in a Textual widget that can be placed in the split-pane layout.
Uses Unicode box-drawing characters for the grid and components.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.reactive import reactive
from textual.timer import Timer
from textual.widgets import Label, Static

from app_logging.logger import get_logger

if TYPE_CHECKING:
    from core.blueprint.engine import BlueprintEngine

logger = get_logger(__name__)

# ── Theme tokens (matching app.py) ───────────────────────────────────
ACCENT = "#3ec9b0"
ACCENT_DIM = "#2a8c7a"
BG_DARK = "#111214"
BG_SURFACE = "#1a1c1f"
TEXT_PRIMARY = "#d4d4d4"
TEXT_DIM = "#6b7280"
GRID_COLOR = "#2a2c30"
GRID_MAJOR = "#3a3c40"
COMPONENT_COLOR = "#3ec9b0"
SELECTION_COLOR = "#f0c040"
ORIGIN_COLOR = "#804040"


def _build_grid_text(
    width: int,
    height: int,
    grid_spacing: int = 8,
    pan_x: float = 0.0,
    pan_y: float = 0.0,
    zoom: float = 1.0,
) -> str:
    """Build a text-based grid for the engine viewport.

    Returns a string grid using Unicode characters.
    """
    lines: list[str] = []
    effective_spacing = max(2, int(grid_spacing * zoom))

    for row in range(height):
        line_chars: list[str] = []
        for col in range(width):
            # Offset by pan
            world_col = col - int(pan_x * zoom)
            world_row = row - int(pan_y * zoom)

            is_origin_h = (world_row == height // 2)
            is_origin_v = (world_col == width // 2)
            is_major_h = (world_row % (effective_spacing * 4) == 0)
            is_major_v = (world_col % (effective_spacing * 4) == 0)
            is_minor_h = (world_row % effective_spacing == 0)
            is_minor_v = (world_col % effective_spacing == 0)

            if is_origin_h and is_origin_v:
                line_chars.append("╋")
            elif is_origin_h:
                if is_major_v or is_minor_v:
                    line_chars.append("─")
                else:
                    line_chars.append("─")
            elif is_origin_v:
                if is_major_h or is_minor_h:
                    line_chars.append("│")
                else:
                    line_chars.append("│")
            elif is_major_h and is_major_v:
                line_chars.append("┼")
            elif is_major_h:
                if is_minor_v:
                    line_chars.append("┼")
                else:
                    line_chars.append("─")
            elif is_major_v:
                if is_minor_h:
                    line_chars.append("┼")
                else:
                    line_chars.append("│")
            elif is_minor_h and is_minor_v:
                line_chars.append("·")
            elif is_minor_h:
                line_chars.append("·")
            elif is_minor_v:
                line_chars.append("·")
            else:
                line_chars.append(" ")

        lines.append("".join(line_chars))

    return "\n".join(lines)


class BlueprintStatusBar(Static):
    """Status bar showing engine mode, zoom, grid info."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._status_text = "Mode: SELECT | Zoom: 100% | Grid: ON | Snap: ON"

    def update_status(
        self,
        mode: str = "SELECT",
        zoom: float = 1.0,
        grid: bool = True,
        snap: bool = True,
        components: int = 0,
        selected: int = 0,
        blueprint_name: str = "",
    ) -> None:
        zoom_pct = int(zoom * 100)
        grid_str = "ON" if grid else "OFF"
        snap_str = "ON" if snap else "OFF"
        sel_str = f" | Selected: {selected}" if selected > 0 else ""
        name_str = f" [{blueprint_name}]" if blueprint_name else ""

        self._status_text = (
            f"Mode: {mode.upper()} | Zoom: {zoom_pct}% | "
            f"Grid: {grid_str} | Snap: {snap_str} | "
            f"Components: {components}{sel_str}{name_str}"
        )
        self.update(self._status_text)


class BlueprintViewport(Static):
    """The main grid/canvas viewport for the blueprint engine."""

    viewport_width = reactive(60)
    viewport_height = reactive(20)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._pan_x = 0.0
        self._pan_y = 0.0
        self._zoom = 1.0
        self._components: list[dict[str, Any]] = []
        self._selected_ids: set[str] = set()

    def set_view_state(
        self,
        pan_x: float = 0.0,
        pan_y: float = 0.0,
        zoom: float = 1.0,
    ) -> None:
        self._pan_x = pan_x
        self._pan_y = pan_y
        self._zoom = zoom
        self._refresh_grid()

    def set_components(
        self,
        components: list[dict[str, Any]],
        selected_ids: set[str] | None = None,
    ) -> None:
        self._components = components
        self._selected_ids = selected_ids or set()
        self._refresh_grid()

    def _refresh_grid(self) -> None:
        grid = _build_grid_text(
            self.viewport_width,
            self.viewport_height,
            grid_spacing=6,
            pan_x=self._pan_x,
            pan_y=self._pan_y,
            zoom=self._zoom,
        )
        self.update(grid)

    def on_mount(self) -> None:
        self._refresh_grid()

    def on_resize(self, event: Any) -> None:
        self.viewport_width = event.size.width
        self.viewport_height = event.size.height - 1
        self._refresh_grid()


class BlueprintToolbar(Static):
    """Toolbar with drawing mode indicators."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)

    def compose(self) -> ComposeResult:
        yield Label(
            "▎ [S]elect  [L]ine  [R]ect  [C]ircle  "
            "[F]reehand  [P]an  [Z]oom  [U]ndo  "
            "[G]rid  [N]snap",
        )


class BlueprintEngineWidget(Static):
    """Complete blueprint engine widget for embedding in the TUI.

    Contains the grid viewport, toolbar, and status bar.
    Communicates with the BlueprintEngine for state management.
    """

    def __init__(
        self,
        engine: BlueprintEngine | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._engine = engine
        self._refresh_timer: Timer | None = None

    @property
    def engine(self) -> BlueprintEngine | None:
        return self._engine

    @engine.setter
    def engine(self, value: BlueprintEngine | None) -> None:
        self._engine = value
        self._sync_from_engine()

    def compose(self) -> ComposeResult:
        yield BlueprintToolbar(id="bp-toolbar")
        yield BlueprintViewport(id="bp-viewport")
        yield BlueprintStatusBar(id="bp-status")

    def on_mount(self) -> None:
        self._sync_from_engine()
        # Periodic refresh for gesture-driven updates
        self._refresh_timer = self.set_interval(1.0, self._sync_from_engine)

    def _sync_from_engine(self) -> None:
        """Pull state from the BlueprintEngine and update widgets."""
        if self._engine is None:
            return

        try:
            viewport = self.query_one("#bp-viewport", BlueprintViewport)
            status = self.query_one("#bp-status", BlueprintStatusBar)
        except Exception:
            return

        # Update viewport
        view = self._engine.view
        viewport.set_view_state(
            pan_x=view.pan_x,
            pan_y=view.pan_y,
            zoom=view.zoom,
        )

        # Update status bar
        state = self._engine.state
        bp_name = state.blueprint.name if state.blueprint else ""
        component_count = (
            len(state.blueprint.components) if state.blueprint else 0
        )
        status.update_status(
            mode=state.interaction_mode.value,
            zoom=view.zoom,
            grid=state.grid_enabled,
            snap=state.snap_enabled,
            components=component_count,
            selected=self._engine.selection.count,
            blueprint_name=bp_name,
        )

    async def load_blueprint(self, path: str) -> bool:
        """Load a blueprint into the engine and refresh the view."""
        if self._engine is None:
            from core.blueprint.engine import BlueprintEngine
            self._engine = BlueprintEngine()

        success = await self._engine.load(path)
        if success:
            self._sync_from_engine()
        return success

    async def new_blueprint(self, name: str, bp_type: str = "part") -> bool:
        """Create a new blueprint in the engine."""
        if self._engine is None:
            from core.blueprint.engine import BlueprintEngine
            self._engine = BlueprintEngine()

        from core.blueprint.parser import BlueprintType
        try:
            bt = BlueprintType(bp_type)
        except ValueError:
            bt = BlueprintType.PART

        self._engine.new_blueprint(name, bt)
        self._sync_from_engine()
        return True
