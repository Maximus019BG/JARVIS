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

# ── Rich markup helpers ──────────────────────────────────────────────
_C_GRID = "dim"
_C_MAJOR = "grey50"
_C_ORIGIN = "red"
_C_COMP = "bold cyan"
_C_COMP_FILL = "on grey15"
_C_SEL = "bold yellow"
_C_SEL_FILL = "on grey23"
_C_CONN = "magenta"
_C_LABEL = "bold white"
_C_LABEL_SEL = "bold yellow"
_C_LINE = "cyan"          # default drawing-line colour
_C_CIRCLE = "green"       # default circle colour
_C_RECT = "blue"          # default rect colour
_C_ARC = "magenta"        # default arc colour
_C_TEXT = "bold white"    # default text colour


# ── Component data structure for rendering ───────────────────────────

class _RenderComponent:
    """Lightweight data for rendering a component on the grid."""
    __slots__ = ("id", "name", "comp_type", "x", "y", "w", "h", "selected")

    def __init__(
        self,
        id: str,
        name: str,
        comp_type: str,
        x: float,
        y: float,
        w: float,
        h: float,
        selected: bool = False,
    ) -> None:
        self.id = id
        self.name = name
        self.comp_type = comp_type
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.selected = selected


class _RenderConnection:
    """Lightweight data for rendering a connection line."""
    __slots__ = ("from_x", "from_y", "to_x", "to_y")

    def __init__(self, from_x: float, from_y: float, to_x: float, to_y: float) -> None:
        self.from_x = from_x
        self.from_y = from_y
        self.to_x = to_x
        self.to_y = to_y


# ── Drawing primitive structures (percentage-based 0–100) ────────────

class _RenderDrawLine:
    """A line defined in percentage coords of the viewport."""
    __slots__ = ("x1", "y1", "x2", "y2", "color", "style", "label")

    def __init__(
        self,
        x1: float, y1: float,
        x2: float, y2: float,
        color: str = _C_LINE,
        style: str = "solid",
        label: str = "",
    ) -> None:
        self.x1, self.y1 = x1, y1
        self.x2, self.y2 = x2, y2
        self.color = color
        self.style = style
        self.label = label


class _RenderDrawCircle:
    """A circle defined in percentage coords."""
    __slots__ = ("cx", "cy", "r", "color", "fill", "label")

    def __init__(
        self,
        cx: float, cy: float, r: float,
        color: str = _C_CIRCLE,
        fill: bool = False,
        label: str = "",
    ) -> None:
        self.cx, self.cy, self.r = cx, cy, r
        self.color = color
        self.fill = fill
        self.label = label


class _RenderDrawRect:
    """A rectangle defined in percentage coords."""
    __slots__ = ("x", "y", "w", "h", "color", "fill", "label")

    def __init__(
        self,
        x: float, y: float, w: float, h: float,
        color: str = _C_RECT,
        fill: bool = False,
        label: str = "",
    ) -> None:
        self.x, self.y, self.w, self.h = x, y, w, h
        self.color = color
        self.fill = fill
        self.label = label


class _RenderDrawArc:
    """An arc defined in percentage coords."""
    __slots__ = ("cx", "cy", "r", "start_angle", "end_angle", "color", "label")

    def __init__(
        self,
        cx: float, cy: float, r: float,
        start_angle: float = 0.0,
        end_angle: float = 180.0,
        color: str = _C_ARC,
        label: str = "",
    ) -> None:
        self.cx, self.cy, self.r = cx, cy, r
        self.start_angle = start_angle
        self.end_angle = end_angle
        self.color = color
        self.label = label


class _RenderDrawText:
    """A text label in percentage coords."""
    __slots__ = ("x", "y", "text", "color", "bold")

    def __init__(
        self,
        x: float, y: float, text: str,
        color: str = _C_TEXT,
        bold: bool = False,
    ) -> None:
        self.x, self.y = x, y
        self.text = text
        self.color = color
        self.bold = bold


# ── Grid + Component Renderer ───────────────────────────────────────

def _render_grid_with_components(
    width: int,
    height: int,
    components: list[_RenderComponent],
    connections: list[_RenderConnection],
    grid_spacing: int = 6,
    pan_x: float = 0.0,
    pan_y: float = 0.0,
    zoom: float = 1.0,
    *,
    draw_lines: list[_RenderDrawLine] | None = None,
    draw_circles: list[_RenderDrawCircle] | None = None,
    draw_rects: list[_RenderDrawRect] | None = None,
    draw_arcs: list[_RenderDrawArc] | None = None,
    draw_texts: list[_RenderDrawText] | None = None,
    dim_info: str = "",
) -> str:
    """Build a Rich-markup string showing the grid with components overlaid.

    Components are rendered as Unicode boxes on the grid.
    Connections are rendered as lines between component centers.
    """
    if width < 4 or height < 2:
        return ""

    # Build a 2-D character buffer + a parallel style buffer.
    # We'll compose the final string with Rich markup at the end.
    EMPTY = " "
    chars: list[list[str]] = [[EMPTY] * width for _ in range(height)]
    styles: list[list[str]] = [[""] * width for _ in range(height)]

    eff_spacing = max(2, int(grid_spacing * zoom))
    cx, cy = width // 2, height // 2  # screen-space origin

    # ── 1. Draw clean dot grid ────────────────────────────────────
    # Dots-only grid: quiet background that lets lines and components
    # stand out.  Origin gets a small crosshair, major intersections
    # are slightly brighter, minor intersections are dim dots.
    for row in range(height):
        for col in range(width):
            wr = row - cy + int(pan_y * zoom)
            wc = col - cx + int(pan_x * zoom)

            on_origin_h = wr == 0
            on_origin_v = wc == 0
            on_major_h = wr % (eff_spacing * 4) == 0 if eff_spacing else False
            on_major_v = wc % (eff_spacing * 4) == 0 if eff_spacing else False
            on_minor_h = wr % eff_spacing == 0 if eff_spacing else False
            on_minor_v = wc % eff_spacing == 0 if eff_spacing else False

            if on_origin_h and on_origin_v:
                chars[row][col] = "┼"
                styles[row][col] = _C_ORIGIN
            elif (on_origin_h and on_minor_v) or (on_origin_v and on_minor_h):
                chars[row][col] = "·"
                styles[row][col] = _C_ORIGIN
            elif on_major_h and on_major_v:
                chars[row][col] = "·"
                styles[row][col] = _C_MAJOR
            elif on_minor_h and on_minor_v:
                chars[row][col] = "·"
                styles[row][col] = _C_GRID
            else:
                chars[row][col] = " "
                styles[row][col] = ""

    # ── Helper: world → screen ──────────────────────────────────
    def w2s(wx: float, wy: float) -> tuple[int, int]:
        """World coords to screen col, row."""
        sc = int(wx * zoom) + cx - int(pan_x * zoom)
        sr = int(wy * zoom) + cy - int(pan_y * zoom)
        return sc, sr

    # ── Helper: percentage → screen ─────────────────────────────
    def pct2s(px: float, py: float) -> tuple[int, int]:
        """Percentage (0-100) coords to screen col, row."""
        sc = int(px / 100.0 * width)
        sr = int(py / 100.0 * height)
        return max(0, min(width - 1, sc)), max(0, min(height - 1, sr))

    # ── Helper: draw a line between two screen points ───────────
    def _bresenham(c0: int, r0: int, c1: int, r1: int, char_h: str, char_v: str, char_d: str, color: str, style: str = "solid") -> None:
        steps = max(abs(c1 - c0), abs(r1 - r0), 1)
        for i in range(steps + 1):
            t = i / steps
            c = int(c0 + (c1 - c0) * t)
            r = int(r0 + (r1 - r0) * t)
            if 0 <= r < height and 0 <= c < width:
                # Dashed: skip every other pair
                if style == "dashed" and (i // 3) % 2 == 1:
                    continue
                if style == "dotted" and i % 2 == 1:
                    continue
                dc = abs(c1 - c0)
                dr = abs(r1 - r0)
                if dc > dr * 2:
                    chars[r][c] = char_h
                elif dr > dc * 2:
                    chars[r][c] = char_v
                else:
                    chars[r][c] = char_d
                styles[r][c] = color

    # ── Helper: draw a smooth line using Braille characters ─────
    def _bresenham_braille(c0: int, r0: int, c1: int, r1: int, color: str, style: str = "solid") -> None:
        """Draw a line using Unicode Braille patterns (U+2800-U+28FF).

        Each character cell provides a 2×4 sub-pixel grid, producing
        much smoother lines than box-drawing characters.
        """
        BRAILLE_BASE = 0x2800
        # Bit positions for (row, col) within a braille cell:
        #        col0   col1
        # row0:  0x01   0x08
        # row1:  0x02   0x10
        # row2:  0x04   0x20
        # row3:  0x40   0x80
        DOT_BITS = [
            [0x01, 0x08],
            [0x02, 0x10],
            [0x04, 0x20],
            [0x40, 0x80],
        ]

        # Work in sub-pixel space (each char cell = 2 wide × 4 tall)
        sx0, sy0 = c0 * 2, r0 * 4
        sx1, sy1 = c1 * 2, r1 * 4

        steps = max(abs(sx1 - sx0), abs(sy1 - sy0), 1)

        # Collect braille bitmasks per character cell
        cells: dict[tuple[int, int], int] = {}

        for i in range(steps + 1):
            if style == "dashed" and (i // 6) % 2 == 1:
                continue
            if style == "dotted" and (i // 3) % 2 == 1:
                continue

            t = i / steps
            sx = int(sx0 + (sx1 - sx0) * t + 0.5)
            sy = int(sy0 + (sy1 - sy0) * t + 0.5)

            cc = sx // 2   # character column
            cr = sy // 4   # character row
            dc = sx % 2    # dot column within cell
            dr = sy % 4    # dot row within cell

            if 0 <= cr < height and 0 <= cc < width:
                key = (cc, cr)
                if key not in cells:
                    # Inherit existing braille bits if cell already has one
                    existing = chars[cr][cc]
                    if len(existing) == 1 and 0x2800 <= ord(existing) <= 0x28FF:
                        cells[key] = ord(existing) - BRAILLE_BASE
                    else:
                        cells[key] = 0
                cells[key] |= DOT_BITS[dr][dc]

        # Write braille characters to the buffer
        for (cc, cr), bits in cells.items():
            chars[cr][cc] = chr(BRAILLE_BASE + bits)
            styles[cr][cc] = color

    # ── 2. Draw connection lines (smooth braille) ────────────────
    for conn in connections:
        fc, fr = pct2s(conn.from_x, conn.from_y)
        tc, tr = pct2s(conn.to_x, conn.to_y)
        _bresenham_braille(fc, fr, tc, tr, _C_CONN)

    # ── 3. Draw components as boxes ──────────────────────────────
    for comp in components:
        # Component box size: at least 3 cols wide for the label, 3 rows tall
        box_w = max(len(comp.name) + 4, int(comp.w * zoom) if comp.w else 8)
        box_h = max(3, int(comp.h * zoom) if comp.h else 3)
        # Limit box size to something reasonable
        box_w = min(box_w, width // 2)
        box_h = min(box_h, height // 2)

        sc, sr = pct2s(comp.x, comp.y)
        # center the box on the component position
        left = sc - box_w // 2
        top = sr - box_h // 2

        style_border = _C_SEL if comp.selected else _C_COMP
        style_fill = _C_SEL_FILL if comp.selected else _C_COMP_FILL
        style_label = _C_LABEL_SEL if comp.selected else _C_LABEL

        for r in range(top, top + box_h):
            for c in range(left, left + box_w):
                if 0 <= r < height and 0 <= c < width:
                    # Edges
                    is_top = r == top
                    is_bot = r == top + box_h - 1
                    is_left = c == left
                    is_right = c == left + box_w - 1

                    if is_top and is_left:
                        chars[r][c] = "┌"
                        styles[r][c] = style_border
                    elif is_top and is_right:
                        chars[r][c] = "┐"
                        styles[r][c] = style_border
                    elif is_bot and is_left:
                        chars[r][c] = "└"
                        styles[r][c] = style_border
                    elif is_bot and is_right:
                        chars[r][c] = "┘"
                        styles[r][c] = style_border
                    elif is_top or is_bot:
                        chars[r][c] = "─"
                        styles[r][c] = style_border
                    elif is_left or is_right:
                        chars[r][c] = "│"
                        styles[r][c] = style_border
                    else:
                        chars[r][c] = " "
                        styles[r][c] = style_fill

        # ── Place label (component name) centered in the box ─────
        label = comp.name
        if len(label) > box_w - 2:
            label = label[: box_w - 3] + "…"
        label_row = top + box_h // 2
        label_start = left + (box_w - len(label)) // 2
        if 0 <= label_row < height:
            for i, ch in enumerate(label):
                c = label_start + i
                if 0 <= c < width:
                    chars[label_row][c] = ch
                    styles[label_row][c] = style_label

        # ── Place type annotation (small, above label) ───────────
        if box_h >= 4:
            type_str = f"({comp.comp_type})"
            if len(type_str) > box_w - 2:
                type_str = type_str[: box_w - 3] + "…"
            type_row = top + 1
            type_start = left + (box_w - len(type_str)) // 2
            if 0 <= type_row < height:
                for i, ch in enumerate(type_str):
                    c = type_start + i
                    if 0 <= c < width:
                        chars[type_row][c] = ch
                        styles[type_row][c] = _C_GRID

    # ── 4. Draw percentage-based drawing primitives ──────────────
    import math as _math

    # ── Braille sub-pixel helpers for curves ─────────────────────
    _BRAILLE_BASE = 0x2800
    _DOT_BITS = [
        [0x01, 0x08],
        [0x02, 0x10],
        [0x04, 0x20],
        [0x40, 0x80],
    ]

    def _plot_braille_subpixels(
        points: list[tuple[int, int]], color: str,
    ) -> None:
        """Render a list of sub-pixel (2x, 4y) points as braille chars."""
        cells: dict[tuple[int, int], int] = {}
        for sx, sy in points:
            cc = sx // 2
            cr = sy // 4
            dc = sx % 2
            dr = sy % 4
            if 0 <= cr < height and 0 <= cc < width:
                key = (cc, cr)
                if key not in cells:
                    existing = chars[cr][cc]
                    if len(existing) == 1 and 0x2800 <= ord(existing) <= 0x28FF:
                        cells[key] = ord(existing) - _BRAILLE_BASE
                    else:
                        cells[key] = 0
                cells[key] |= _DOT_BITS[dr][dc]
        for (cc, cr), bits in cells.items():
            chars[cr][cc] = chr(_BRAILLE_BASE + bits)
            styles[cr][cc] = color

    def _circle_braille(
        center_c: int, center_r: int,
        rx: int, ry: int, color: str,
    ) -> None:
        """Draw a circle outline using braille sub-pixels."""
        sub_cx, sub_cy = center_c * 2, center_r * 4
        sub_rx, sub_ry = max(rx * 2, 1), max(ry * 4, 1)
        steps = max(int(2 * _math.pi * max(sub_rx, sub_ry)), 72)
        pts: list[tuple[int, int]] = []
        for i in range(steps):
            angle = 2.0 * _math.pi * i / steps
            sx = int(sub_cx + sub_rx * _math.cos(angle) + 0.5)
            sy = int(sub_cy + sub_ry * _math.sin(angle) + 0.5)
            pts.append((sx, sy))
        _plot_braille_subpixels(pts, color)

    def _arc_braille(
        center_c: int, center_r: int,
        rx: int, ry: int,
        start_deg: float, end_deg: float, color: str,
    ) -> None:
        """Draw an arc using braille sub-pixels."""
        sub_cx, sub_cy = center_c * 2, center_r * 4
        sub_rx, sub_ry = max(rx * 2, 1), max(ry * 4, 1)
        s_rad = _math.radians(start_deg)
        e_rad = _math.radians(end_deg)
        if e_rad < s_rad:
            e_rad += 2.0 * _math.pi
        arc_len = (e_rad - s_rad) * max(sub_rx, sub_ry)
        steps = max(int(arc_len), 36)
        pts: list[tuple[int, int]] = []
        for i in range(steps + 1):
            angle = s_rad + (e_rad - s_rad) * i / steps
            sx = int(sub_cx + sub_rx * _math.cos(angle) + 0.5)
            sy = int(sub_cy + sub_ry * _math.sin(angle) + 0.5)
            pts.append((sx, sy))
        _plot_braille_subpixels(pts, color)

    # 4a. Lines
    for dl in (draw_lines or []):
        sc0, sr0 = pct2s(dl.x1, dl.y1)
        sc1, sr1 = pct2s(dl.x2, dl.y2)
        safe = _safe_color(dl.color)
        line_color = f"bold {safe}"
        _bresenham_braille(sc0, sr0, sc1, sr1, line_color, dl.style)
        # Draw label at midpoint
        if dl.label:
            mc = (sc0 + sc1) // 2 - len(dl.label) // 2
            mr = (sr0 + sr1) // 2
            for i, ch in enumerate(dl.label):
                cc = mc + i
                if 0 <= mr < height and 0 <= cc < width:
                    chars[mr][cc] = ch
                    styles[mr][cc] = f"bold {safe}"

    # 4b. Rectangles
    for dr in (draw_rects or []):
        tl_c, tl_r = pct2s(dr.x, dr.y)
        br_c, br_r = pct2s(dr.x + dr.w, dr.y + dr.h)
        safe = _safe_color(dr.color)
        rect_color = f"bold {safe}"
        fill_style = f"on grey15" if dr.fill else ""
        for r in range(tl_r, br_r + 1):
            for c in range(tl_c, br_c + 1):
                if 0 <= r < height and 0 <= c < width:
                    is_top = r == tl_r
                    is_bot = r == br_r
                    is_left = c == tl_c
                    is_right = c == br_c
                    if is_top and is_left:
                        chars[r][c] = "┌"; styles[r][c] = rect_color
                    elif is_top and is_right:
                        chars[r][c] = "┐"; styles[r][c] = rect_color
                    elif is_bot and is_left:
                        chars[r][c] = "└"; styles[r][c] = rect_color
                    elif is_bot and is_right:
                        chars[r][c] = "┘"; styles[r][c] = rect_color
                    elif is_top or is_bot:
                        chars[r][c] = "─"; styles[r][c] = rect_color
                    elif is_left or is_right:
                        chars[r][c] = "│"; styles[r][c] = rect_color
                    elif dr.fill:
                        chars[r][c] = " "; styles[r][c] = fill_style
        if dr.label:
            lr = (tl_r + br_r) // 2
            lc = tl_c + ((br_c - tl_c) - len(dr.label)) // 2
            for i, ch in enumerate(dr.label):
                cc = lc + i
                if 0 <= lr < height and 0 <= cc < width:
                    chars[lr][cc] = ch
                    styles[lr][cc] = f"bold {safe}"

    # 4c. Circles (smooth braille sub-pixel rendering)
    for dc in (draw_circles or []):
        ccx, ccy = pct2s(dc.cx, dc.cy)
        rx = max(1, int(dc.r / 100.0 * width))
        ry = max(1, int(dc.r / 100.0 * height))
        safe = _safe_color(dc.color)
        circ_color = f"bold {safe}"
        if dc.fill:
            fill_style = "on grey15"
            for r in range(max(0, ccy - ry), min(height, ccy + ry + 1)):
                for c in range(max(0, ccx - rx), min(width, ccx + rx + 1)):
                    dx = (c - ccx) / max(rx, 1)
                    dy = (r - ccy) / max(ry, 1)
                    if dx * dx + dy * dy <= 1.0:
                        chars[r][c] = " "
                        styles[r][c] = fill_style
        _circle_braille(ccx, ccy, rx, ry, circ_color)
        if dc.label:
            lc = ccx - len(dc.label) // 2
            lr = ccy
            for i, ch in enumerate(dc.label):
                cc = lc + i
                if 0 <= lr < height and 0 <= cc < width:
                    chars[lr][cc] = ch
                    styles[lr][cc] = f"bold {safe}"

    # 4d. Arcs (smooth braille sub-pixel rendering)
    for da in (draw_arcs or []):
        acx, acy = pct2s(da.cx, da.cy)
        arx = max(1, int(da.r / 100.0 * width))
        ary = max(1, int(da.r / 100.0 * height))
        safe = _safe_color(da.color)
        arc_color = f"bold {safe}"
        _arc_braille(acx, acy, arx, ary, da.start_angle, da.end_angle, arc_color)
        if da.label:
            mid_angle = _math.radians((da.start_angle + da.end_angle) / 2)
            lc = acx + int(arx * _math.cos(mid_angle)) - len(da.label) // 2
            lr = acy + int(ary * _math.sin(mid_angle))
            for i, ch in enumerate(da.label):
                cc = lc + i
                if 0 <= lr < height and 0 <= cc < width:
                    chars[lr][cc] = ch
                    styles[lr][cc] = f"bold {safe}"

    # 4e. Text labels
    for dt in (draw_texts or []):
        tc, tr = pct2s(dt.x, dt.y)
        safe = _safe_color(dt.color)
        txt_style = ("bold " if dt.bold else "") + safe
        for i, ch in enumerate(dt.text):
            cc = tc + i
            if 0 <= tr < height and 0 <= cc < width:
                chars[tr][cc] = ch
                styles[tr][cc] = txt_style

    # ── 5. Dimension info overlay (bottom-right corner) ──────────
    if dim_info:
        dim_row = height - 1
        dim_col = max(0, width - len(dim_info) - 1)
        for i, ch in enumerate(dim_info):
            cc = dim_col + i
            if 0 <= cc < width:
                chars[dim_row][cc] = ch
                styles[dim_row][cc] = "dim italic"

    # ── 6. Build Rich markup string ──────────────────────────────
    result_lines: list[str] = []
    for row in range(height):
        parts: list[str] = []
        cur_style = ""
        buf: list[str] = []
        for col in range(width):
            s = styles[row][col]
            if s != cur_style:
                if buf:
                    text = "".join(buf)
                    if cur_style:
                        parts.append(f"[{cur_style}]{_escape(text)}[/]")
                    else:
                        parts.append(_escape(text))
                    buf = []
                cur_style = s
            buf.append(chars[row][col])
        if buf:
            text = "".join(buf)
            if cur_style:
                parts.append(f"[{cur_style}]{_escape(text)}[/]")
            else:
                parts.append(_escape(text))
        result_lines.append("".join(parts))

    return "\n".join(result_lines)


def _escape(text: str) -> str:
    """Escape Rich markup special chars."""
    return text.replace("[", r"\[")


# ── Colour safety ────────────────────────────────────────────────────

_INVISIBLE_COLOURS: dict[str, str] = {
    "black": "cyan",
    "#000000": "cyan",
    "#000": "cyan",
    "#111": "grey70",
    "#111111": "grey70",
    "": "cyan",
}


def _safe_color(color: str) -> str:
    """Map invisible / empty colours to visible alternatives."""
    return _INVISIBLE_COLOURS.get(color.lower().strip(), color) if color else "cyan"


# ── Status Bar ───────────────────────────────────────────────────────

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
        render_mode: str = "char",
    ) -> None:
        zoom_pct = int(zoom * 100)
        grid_str = "ON" if grid else "OFF"
        snap_str = "ON" if snap else "OFF"
        sel_str = f" | Selected: {selected}" if selected > 0 else ""
        name_str = f" [{blueprint_name}]" if blueprint_name else ""
        rmode_str = f" | Render: {render_mode.upper()}"

        self._status_text = (
            f"Mode: {mode.upper()} | Zoom: {zoom_pct}% | "
            f"Grid: {grid_str} | Snap: {snap_str} | "
            f"Components: {components}{sel_str}{name_str}{rmode_str}"
        )
        self.update(self._status_text)


# ── Viewport ─────────────────────────────────────────────────────────

class BlueprintViewport(Static):
    """The main grid/canvas viewport for the blueprint engine.

    Supports two render modes:
    - ``"char"``: Unicode character-based rendering (braille lines, box-drawing)
    - ``"pixel"``: Framebuffer pixel rendering shown via half-block chars (▀█)
    """

    viewport_width = reactive(60)
    viewport_height = reactive(20)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._pan_x = 0.0
        self._pan_y = 0.0
        self._zoom = 1.0
        self._components: list[_RenderComponent] = []
        self._connections: list[_RenderConnection] = []
        self._draw_lines: list[_RenderDrawLine] = []
        self._draw_circles: list[_RenderDrawCircle] = []
        self._draw_rects: list[_RenderDrawRect] = []
        self._draw_arcs: list[_RenderDrawArc] = []
        self._draw_texts: list[_RenderDrawText] = []
        self._dim_info: str = ""
        self._render_mode: str = "char"  # "char" or "pixel"
        self._blueprint: Any = None  # parsed Blueprint for pixel mode

    def set_view_state(
        self,
        pan_x: float = 0.0,
        pan_y: float = 0.0,
        zoom: float = 1.0,
    ) -> None:
        self._pan_x = pan_x
        self._pan_y = pan_y
        self._zoom = zoom

    def set_components(
        self,
        components: list[_RenderComponent],
        connections: list[_RenderConnection] | None = None,
    ) -> None:
        self._components = components
        self._connections = connections or []

    def set_drawings(
        self,
        lines: list[_RenderDrawLine] | None = None,
        circles: list[_RenderDrawCircle] | None = None,
        rects: list[_RenderDrawRect] | None = None,
        arcs: list[_RenderDrawArc] | None = None,
        texts: list[_RenderDrawText] | None = None,
        dim_info: str = "",
    ) -> None:
        """Set the percentage-based drawing overlays."""
        self._draw_lines = lines or []
        self._draw_circles = circles or []
        self._draw_rects = rects or []
        self._draw_arcs = arcs or []
        self._draw_texts = texts or []
        self._dim_info = dim_info

    def set_blueprint(self, blueprint: Any) -> None:
        """Store the parsed Blueprint object (needed for pixel render mode)."""
        self._blueprint = blueprint

    @property
    def render_mode(self) -> str:
        """Current render mode: 'char' or 'pixel'."""
        return self._render_mode

    def toggle_render_mode(self) -> str:
        """Toggle between char and pixel render modes. Returns new mode."""
        self._render_mode = "pixel" if self._render_mode == "char" else "char"
        self.refresh_view()
        return self._render_mode

    def refresh_view(self) -> None:
        """Re-render the grid with all current state."""
        if self._render_mode == "pixel" and self._blueprint is not None:
            self._refresh_pixel_view()
        else:
            self._refresh_char_view()

    def _refresh_char_view(self) -> None:
        """Character-based render (braille lines, box-drawing)."""
        markup = _render_grid_with_components(
            self.viewport_width,
            self.viewport_height,
            self._components,
            self._connections,
            grid_spacing=6,
            pan_x=self._pan_x,
            pan_y=self._pan_y,
            zoom=self._zoom,
            draw_lines=self._draw_lines,
            draw_circles=self._draw_circles,
            draw_rects=self._draw_rects,
            draw_arcs=self._draw_arcs,
            draw_texts=self._draw_texts,
            dim_info=self._dim_info,
        )
        self.update(markup)

    def _refresh_pixel_view(self) -> None:
        """Pixel-based render using half-block characters (▀█)."""
        try:
            from core.blueprint.framebuffer_tui import (
                render_blueprint_to_frame,
                frame_to_halfblock_markup,
            )
        except ImportError:
            # numpy not available — fall back to char mode
            self._refresh_char_view()
            return

        if self._blueprint is None:
            self._refresh_char_view()
            return

        # Render at higher pixel resolution, then downsample to terminal size
        # Each terminal column = 1 pixel wide, each row = 2 pixels tall
        px_w = max(self.viewport_width, 10)
        px_h = max(self.viewport_height, 5) * 2  # 2 pixels per char row

        # Use a larger internal buffer for quality, then it resamples down
        internal_w = max(px_w, 400)
        internal_h = max(px_h, 200)

        try:
            frame = render_blueprint_to_frame(
                self._blueprint,
                internal_w,
                internal_h,
                show_grid=True,
                line_thickness=max(2, internal_w // 200),
                text_scale=max(1, internal_w // 200),
            )
            markup = frame_to_halfblock_markup(frame, self.viewport_width, self.viewport_height)
            self.update(markup)
        except Exception:
            # If pixel rendering fails, fall back gracefully
            self._refresh_char_view()

    def on_mount(self) -> None:
        self.refresh_view()

    def on_resize(self, event: Any) -> None:
        self.viewport_width = event.size.width
        self.viewport_height = event.size.height - 1
        self.refresh_view()


# ── Toolbar ──────────────────────────────────────────────────────────

class BlueprintToolbar(Static):
    """Toolbar with mode indicators."""

    def compose(self) -> ComposeResult:
        yield Label(
            "▎ Pan  Zoom  Select  Undo  "
            "Grid  Snap  │  Ctrl+B toggle",
        )


# ── Main Widget ──────────────────────────────────────────────────────

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

        # ── Build render-component list from engine scene ────────
        render_comps: list[_RenderComponent] = []
        render_conns: list[_RenderConnection] = []
        bp = self._engine.state.blueprint
        selected_ids: set[str] = set()

        try:
            selected_ids = self._engine.selection.selected_ids
        except Exception:
            pass

        if bp:
            comp_positions: dict[str, tuple[float, float]] = {}

            # Determine normalisation range → percentage (0-100).
            # If the blueprint has explicit dimensions, use those.
            # Otherwise, compute the bounding-box of all components.
            dims = bp.dimensions
            range_x = float(dims.length) if dims and dims.length > 0 else 0.0
            range_y = float(dims.width) if dims and dims.width > 0 else 0.0

            if range_x == 0 or range_y == 0:
                # Auto-detect from positions
                xs = [c.position[0] for c in bp.components]
                ys = [c.position[1] for c in bp.components]
                if xs:
                    max_x = max(abs(v) for v in xs) or 1.0
                    max_y = max(abs(v) for v in ys) or 1.0
                    # If all values ≤ 100, assume already percentages
                    if max_x <= 100 and max_y <= 100:
                        range_x = range_x or 100.0
                        range_y = range_y or 100.0
                    else:
                        range_x = range_x or max_x
                        range_y = range_y or max_y
                else:
                    range_x, range_y = 100.0, 100.0

            for comp in bp.components:
                node = self._engine.scene.get_node_by_component(comp.id)
                if node:
                    wt = node.get_world_transform()
                    wx, wy = wt.x, wt.y
                    bw = node.bounds.max_x - node.bounds.min_x if node.bounds else 50
                    bh = node.bounds.max_y - node.bounds.min_y if node.bounds else 50
                else:
                    wx, wy = comp.position[0], comp.position[1]
                    bw, bh = 50, 50

                # Normalize to percentage (0-100) of blueprint extents
                pct_x = wx / range_x * 100.0
                pct_y = wy / range_y * 100.0
                # Keep component box size proportional (min 5% for label)
                sw = max(bw / range_x * 100.0, 5.0)
                sh = max(bh / range_y * 100.0, 5.0)

                comp_positions[comp.id] = (pct_x, pct_y)

                render_comps.append(_RenderComponent(
                    id=comp.id,
                    name=comp.name,
                    comp_type=comp.type,
                    x=pct_x,
                    y=pct_y,
                    w=sw,
                    h=sh,
                    selected=comp.id in selected_ids,
                ))

            # Build connections
            for conn in bp.connections:
                fid = conn.from_id
                tid = conn.to_id
                if fid in comp_positions and tid in comp_positions:
                    fx, fy = comp_positions[fid]
                    tx, ty = comp_positions[tid]
                    render_conns.append(_RenderConnection(fx, fy, tx, ty))

        # ── Build drawing overlays from blueprint ───────────────────
        _lines: list[_RenderDrawLine] = []
        _circles: list[_RenderDrawCircle] = []
        _rects: list[_RenderDrawRect] = []
        _arcs: list[_RenderDrawArc] = []
        _texts: list[_RenderDrawText] = []

        if bp:
            for ln in getattr(bp, "lines", []):
                _lines.append(_RenderDrawLine(
                    x1=ln.x1, y1=ln.y1, x2=ln.x2, y2=ln.y2,
                    color=ln.color, style=ln.style, label=ln.label,
                ))
            for ci in getattr(bp, "circles", []):
                _circles.append(_RenderDrawCircle(
                    cx=ci.cx, cy=ci.cy, r=ci.r,
                    color=ci.color, fill=ci.fill, label=ci.label,
                ))
            for rc in getattr(bp, "rects", []):
                _rects.append(_RenderDrawRect(
                    x=rc.x, y=rc.y, w=rc.w, h=rc.h,
                    color=rc.color, fill=rc.fill, label=rc.label,
                ))
            for ac in getattr(bp, "arcs", []):
                _arcs.append(_RenderDrawArc(
                    cx=ac.cx, cy=ac.cy, r=ac.r,
                    start_angle=ac.start_angle, end_angle=ac.end_angle,
                    color=ac.color, label=ac.label,
                ))
            for tx in getattr(bp, "texts", []):
                _texts.append(_RenderDrawText(
                    x=tx.x, y=tx.y, text=tx.text,
                    color=tx.color, bold=tx.bold,
                ))

        # ── Build dimension info string ────────────────────────────
        dim_info = ""
        if bp and bp.dimensions:
            d = bp.dimensions
            parts = []
            if d.length or d.width or d.height:
                parts.append(f"{d.length}x{d.width}x{d.height}{d.unit}")
            if parts:
                dim_info = " ".join(parts)

        # Push to viewport
        view = self._engine.view
        viewport.set_view_state(
            pan_x=view.pan_x,
            pan_y=view.pan_y,
            zoom=view.zoom,
        )
        viewport.set_components(render_comps, render_conns)
        viewport.set_drawings(_lines, _circles, _rects, _arcs, _texts, dim_info=dim_info)
        viewport.set_blueprint(bp)
        viewport.refresh_view()

        # Update status bar
        state = self._engine.state
        bp_name = state.blueprint.name if state.blueprint else ""
        component_count = len(bp.components) if bp else 0

        status.update_status(
            mode=state.interaction_mode.value,
            zoom=view.zoom,
            grid=state.grid_enabled,
            snap=state.snap_enabled,
            components=component_count,
            selected=self._engine.selection.count,
            blueprint_name=bp_name,
            render_mode=viewport._render_mode,
        )

        # Update header label in the parent pane
        self._update_header(bp_name)

    def _update_header(self, bp_name: str) -> None:
        """Update the blueprint pane header with the blueprint name."""
        try:
            header = self.app.query_one("#bp-header", Label)
            if bp_name:
                header.update(f"⬡ Blueprint Engine — {bp_name}")
            else:
                header.update("⬡ Blueprint Engine")
        except Exception:
            pass

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
