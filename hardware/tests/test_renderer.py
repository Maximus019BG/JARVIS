"""Tests for core.blueprint.renderer – RenderConfig, RenderStats, BlueprintRenderer."""

from __future__ import annotations

import pytest

from core.blueprint.renderer import (
    BlueprintRenderer,
    RenderConfig,
    RenderStats,
    RenderStyle,
)


# ---------------------------------------------------------------------------
# RenderStyle enum
# ---------------------------------------------------------------------------

class TestRenderStyle:
    def test_values(self) -> None:
        assert RenderStyle.WIREFRAME.value == "wireframe"
        assert RenderStyle.SOLID.value == "solid"
        assert RenderStyle.SHADED.value == "shaded"
        assert RenderStyle.TECHNICAL.value == "technical"


# ---------------------------------------------------------------------------
# RenderConfig
# ---------------------------------------------------------------------------

class TestRenderConfig:
    def test_defaults(self) -> None:
        cfg = RenderConfig()
        assert cfg.width == 800
        assert cfg.height == 600
        assert cfg.show_grid is True
        assert cfg.show_labels is True
        assert cfg.style == RenderStyle.SOLID
        assert cfg.antialiased is True

    def test_custom(self) -> None:
        cfg = RenderConfig(width=1920, height=1080, style=RenderStyle.WIREFRAME)
        assert cfg.width == 1920
        assert cfg.style == RenderStyle.WIREFRAME


# ---------------------------------------------------------------------------
# RenderStats
# ---------------------------------------------------------------------------

class TestRenderStats:
    def test_defaults(self) -> None:
        stats = RenderStats()
        assert stats.frame_time_ms == 0.0
        assert stats.nodes_rendered == 0
        assert stats.primitives_drawn == 0


# ---------------------------------------------------------------------------
# BlueprintRenderer
# ---------------------------------------------------------------------------

class TestBlueprintRenderer:
    def test_init_default_config(self) -> None:
        r = BlueprintRenderer()
        assert r.config.width == 800
        assert isinstance(r.stats, RenderStats)

    def test_init_custom_config(self) -> None:
        cfg = RenderConfig(width=320, height=240)
        r = BlueprintRenderer(cfg)
        assert r.config.width == 320

    def test_config_setter(self) -> None:
        r = BlueprintRenderer()
        new_cfg = RenderConfig(width=1280)
        r.config = new_cfg
        assert r.config.width == 1280

    def test_check_cv2(self) -> None:
        r = BlueprintRenderer()
        # Just check it returns a boolean (cv2 may or may not be installed)
        assert isinstance(r._cv2_available, bool)

    def test_world_to_screen(self) -> None:
        from unittest.mock import MagicMock
        r = BlueprintRenderer()
        # Create a mock ViewState
        view = MagicMock()
        view.pan_x = 0
        view.pan_y = 0
        view.zoom = 1.0
        sx, sy = r._world_to_screen(100, 200, view, 800, 600)
        assert isinstance(sx, float)
        assert isinstance(sy, float)


# ---------------------------------------------------------------------------
# FramebufferRenderer
# ---------------------------------------------------------------------------

class TestFramebufferRenderer:
    def test_init(self) -> None:
        from core.blueprint.renderer import FramebufferRenderer
        r = FramebufferRenderer(fb_device="/nonexistent/fb")
        assert r._fb_available is False
        assert r.is_available is False

    def test_render_to_framebuffer_unavailable(self) -> None:
        from core.blueprint.renderer import FramebufferRenderer
        from unittest.mock import MagicMock
        r = FramebufferRenderer(fb_device="/nonexistent/fb")
        engine = MagicMock()
        assert r.render_to_framebuffer(engine) is False


# ---------------------------------------------------------------------------
# Extra renderer methods
# ---------------------------------------------------------------------------

class TestRendererExtra:
    def test_create_canvas(self) -> None:
        r = BlueprintRenderer(RenderConfig(width=100, height=50))
        canvas = r._create_canvas()
        assert canvas.shape == (50, 100, 3)

    def test_render_to_file_no_cv2(self) -> None:
        from unittest.mock import MagicMock
        r = BlueprintRenderer()
        r._cv2_available = False
        engine = MagicMock()
        result = r.render_to_file(engine, "/tmp/test.png")
        assert result is False

    def test_world_to_screen_with_pan_and_zoom(self) -> None:
        from unittest.mock import MagicMock
        r = BlueprintRenderer()
        view = MagicMock()
        view.pan_x = 10
        view.pan_y = 20
        view.zoom = 2.0
        sx, sy = r._world_to_screen(100, 200, view, 800, 600)
        assert sx == (100 + 10) * 2.0 + 800 / 2
        assert sy == (-200 - 20) * 2.0 + 600 / 2
