"""Framebuffer-in-TUI renderer.

Renders blueprint drawing primitives to a numpy pixel buffer, then converts
to Rich markup using Unicode half-block characters (▀/▄/█).  Each terminal
cell encodes **two** vertical pixels (top = foreground, bottom = background),
giving 2× vertical resolution with full 24-bit colour.

No OpenCV dependency — all drawing is pure numpy + math.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray


# ── Colour helpers ───────────────────────────────────────────────────

# Named-colour table (Rich/CSS names → BGR tuples)
_NAMED_COLOURS: dict[str, tuple[int, int, int]] = {
    "cyan":    (0, 255, 255),
    "red":     (255, 60, 60),
    "green":   (60, 220, 60),
    "blue":    (80, 120, 255),
    "yellow":  (60, 230, 255),
    "magenta": (220, 60, 220),
    "orange":  (40, 160, 255),
    "white":   (220, 220, 220),
    "grey70":  (180, 180, 180),
    "black":   (0, 255, 255),  # remap to cyan (invisible otherwise)
    "":        (0, 255, 255),
}


def _parse_colour(name: str) -> tuple[int, int, int]:
    """Parse a colour name or hex string to an RGB tuple."""
    if not name:
        return (0, 255, 255)
    name = name.strip().lower()
    # Remove Rich modifiers like "bold "
    for prefix in ("bold ", "dim ", "italic "):
        if name.startswith(prefix):
            name = name[len(prefix):]
    if name in _NAMED_COLOURS:
        return _NAMED_COLOURS[name]
    if name.startswith("#"):
        h = name.lstrip("#")
        if len(h) == 3:
            h = h[0]*2 + h[1]*2 + h[2]*2
        if len(h) == 6:
            try:
                r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
                return (r, g, b)
            except ValueError:
                pass
    return (0, 255, 255)  # fallback cyan


# ── Pure-numpy drawing primitives ────────────────────────────────────

def _draw_line(
    frame: NDArray[np.uint8],
    x0: int, y0: int, x1: int, y1: int,
    colour: tuple[int, int, int],
    thickness: int = 1,
    style: str = "solid",
) -> None:
    """Bresenham line with optional thickness, dash, dot."""
    h, w = frame.shape[:2]
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    steps = max(dx, dy, 1)

    for i in range(steps + 1):
        if style == "dashed" and (i // 6) % 2 == 1:
            continue
        if style == "dotted" and (i // 3) % 2 == 1:
            continue

        t = i / steps
        px = int(x0 + (x1 - x0) * t + 0.5)
        py = int(y0 + (y1 - y0) * t + 0.5)

        # Apply thickness (square brush)
        half = thickness // 2
        for ty in range(py - half, py + half + 1):
            for tx in range(px - half, px + half + 1):
                if 0 <= ty < h and 0 <= tx < w:
                    frame[ty, tx] = colour


def _draw_circle(
    frame: NDArray[np.uint8],
    cx: int, cy: int, rx: int, ry: int,
    colour: tuple[int, int, int],
    fill: bool = False,
    thickness: int = 1,
) -> None:
    """Draw an ellipse (circle when rx==ry)."""
    h, w = frame.shape[:2]
    if fill:
        for y in range(max(0, cy - ry), min(h, cy + ry + 1)):
            for x in range(max(0, cx - rx), min(w, cx + rx + 1)):
                dx = (x - cx) / max(rx, 1)
                dy = (y - cy) / max(ry, 1)
                if dx * dx + dy * dy <= 1.0:
                    frame[y, x] = colour
    # Outline
    for angle in range(360):
        rad = math.radians(angle)
        for t in range(max(1, thickness)):
            r_offset = t - thickness // 2
            px = int(cx + (rx + r_offset) * math.cos(rad) + 0.5)
            py = int(cy + (ry + r_offset) * math.sin(rad) + 0.5)
            if 0 <= py < h and 0 <= px < w:
                frame[py, px] = colour


def _draw_rect(
    frame: NDArray[np.uint8],
    x: int, y: int, x2: int, y2: int,
    colour: tuple[int, int, int],
    fill: bool = False,
    thickness: int = 1,
) -> None:
    """Draw a rectangle."""
    h, w = frame.shape[:2]
    if fill:
        fy0 = max(0, min(y, y2))
        fy1 = min(h, max(y, y2) + 1)
        fx0 = max(0, min(x, x2))
        fx1 = min(w, max(x, x2) + 1)
        frame[fy0:fy1, fx0:fx1] = colour

    # Edges
    _draw_line(frame, x, y, x2, y, colour, thickness)
    _draw_line(frame, x2, y, x2, y2, colour, thickness)
    _draw_line(frame, x2, y2, x, y2, colour, thickness)
    _draw_line(frame, x, y2, x, y, colour, thickness)


def _draw_arc(
    frame: NDArray[np.uint8],
    cx: int, cy: int, rx: int, ry: int,
    start_deg: float, end_deg: float,
    colour: tuple[int, int, int],
    thickness: int = 1,
) -> None:
    """Draw an arc between start and end angles."""
    h, w = frame.shape[:2]
    if end_deg < start_deg:
        end_deg += 360
    for angle_10 in range(int(start_deg * 10), int(end_deg * 10) + 1):
        rad = math.radians(angle_10 / 10.0)
        for t in range(max(1, thickness)):
            r_offset = t - thickness // 2
            px = int(cx + (rx + r_offset) * math.cos(rad) + 0.5)
            py = int(cy + (ry + r_offset) * math.sin(rad) + 0.5)
            if 0 <= py < h and 0 <= px < w:
                frame[py, px] = colour


def _draw_text(
    frame: NDArray[np.uint8],
    x: int, y: int,
    text: str,
    colour: tuple[int, int, int],
    scale: int = 1,
) -> None:
    """Draw text using a simple 3×5 bitmap font."""
    _FONT: dict[str, list[str]] = {
        "A": ["010","101","111","101","101"], "B": ["110","101","110","101","110"],
        "C": ["011","100","100","100","011"], "D": ["110","101","101","101","110"],
        "E": ["111","100","110","100","111"], "F": ["111","100","110","100","100"],
        "G": ["011","100","101","101","011"], "H": ["101","101","111","101","101"],
        "I": ["111","010","010","010","111"], "J": ["111","001","001","101","010"],
        "K": ["101","110","100","110","101"], "L": ["100","100","100","100","111"],
        "M": ["101","111","111","101","101"], "N": ["101","111","111","111","101"],
        "O": ["010","101","101","101","010"], "P": ["110","101","110","100","100"],
        "Q": ["010","101","101","011","001"], "R": ["110","101","110","101","101"],
        "S": ["011","100","010","001","110"], "T": ["111","010","010","010","010"],
        "U": ["101","101","101","101","010"], "V": ["101","101","101","010","010"],
        "W": ["101","101","111","111","101"], "X": ["101","101","010","101","101"],
        "Y": ["101","101","010","010","010"], "Z": ["111","001","010","100","111"],
        "0": ["010","101","101","101","010"], "1": ["010","110","010","010","111"],
        "2": ["110","001","010","100","111"], "3": ["110","001","010","001","110"],
        "4": ["101","101","111","001","001"], "5": ["111","100","110","001","110"],
        "6": ["011","100","110","101","010"], "7": ["111","001","010","010","010"],
        "8": ["010","101","010","101","010"], "9": ["010","101","011","001","110"],
        " ": ["000","000","000","000","000"], "-": ["000","000","111","000","000"],
        ".": ["000","000","000","000","010"], ":": ["000","010","000","010","000"],
        "(": ["010","100","100","100","010"], ")": ["010","001","001","001","010"],
        "/": ["001","001","010","100","100"], "_": ["000","000","000","000","111"],
        "!": ["010","010","010","000","010"],
    }
    h_frame, w_frame = frame.shape[:2]
    cursor_x = x
    for ch in text:
        glyph = _FONT.get(ch.upper(), _FONT.get(" ", ["000"]*5))
        for row_idx, row in enumerate(glyph):
            for col_idx, pixel in enumerate(row):
                if pixel == "1":
                    for sy in range(scale):
                        for sx in range(scale):
                            py = y + row_idx * scale + sy
                            px = cursor_x + col_idx * scale + sx
                            if 0 <= py < h_frame and 0 <= px < w_frame:
                                frame[py, px] = colour
        cursor_x += (len(glyph[0]) + 1) * scale  # +1 char spacing


# ── Grid drawing ─────────────────────────────────────────────────────

def _draw_grid(
    frame: NDArray[np.uint8],
    grid_colour: tuple[int, int, int] = (40, 40, 45),
    spacing: int = 20,
) -> None:
    """Draw a subtle grid."""
    h, w = frame.shape[:2]
    # Vertical lines
    for x in range(0, w, spacing):
        frame[:, x] = grid_colour
    # Horizontal lines
    for y in range(0, h, spacing):
        frame[y, :] = grid_colour


# ── Main render entry point ──────────────────────────────────────────

def render_blueprint_to_frame(
    bp: Any,
    width: int,
    height: int,
    *,
    bg_colour: tuple[int, int, int] = (20, 22, 26),
    show_grid: bool = True,
    line_thickness: int = 2,
    text_scale: int = 2,
) -> NDArray[np.uint8]:
    """Render a parsed Blueprint's drawing primitives to a pixel frame.

    Args:
        bp: A parsed Blueprint object (from ``core.blueprint.parser``).
        width: Frame width in pixels.
        height: Frame height in pixels.
        bg_colour: Background RGB.
        show_grid: Draw a subtle grid.
        line_thickness: Thickness for lines/outlines.
        text_scale: Scale factor for bitmap text.

    Returns:
        RGB frame as ``(H, W, 3)`` uint8 numpy array.
    """
    frame = np.full((height, width, 3), bg_colour, dtype=np.uint8)

    if show_grid:
        _draw_grid(frame, spacing=max(20, width // 20))

    def pct2px_x(pct: float) -> int:
        return int(pct / 100.0 * width)

    def pct2px_y(pct: float) -> int:
        return int(pct / 100.0 * height)

    # Lines
    for ln in getattr(bp, "lines", []):
        col = _parse_colour(getattr(ln, "color", "cyan"))
        style = getattr(ln, "style", "solid")
        _draw_line(
            frame,
            pct2px_x(ln.x1), pct2px_y(ln.y1),
            pct2px_x(ln.x2), pct2px_y(ln.y2),
            col, line_thickness, style,
        )
        label = getattr(ln, "label", "")
        if label:
            mx = (pct2px_x(ln.x1) + pct2px_x(ln.x2)) // 2 - len(label) * 2 * text_scale
            my = (pct2px_y(ln.y1) + pct2px_y(ln.y2)) // 2 - 3 * text_scale
            _draw_text(frame, mx, my, label, col, text_scale)

    # Circles
    for ci in getattr(bp, "circles", []):
        col = _parse_colour(getattr(ci, "color", "cyan"))
        rx = pct2px_x(ci.r)
        ry = pct2px_y(ci.r)
        _draw_circle(
            frame,
            pct2px_x(ci.cx), pct2px_y(ci.cy), rx, ry,
            col, getattr(ci, "fill", False), line_thickness,
        )
        label = getattr(ci, "label", "")
        if label:
            lx = pct2px_x(ci.cx) - len(label) * 2 * text_scale
            ly = pct2px_y(ci.cy) - 3 * text_scale
            _draw_text(frame, lx, ly, label, col, text_scale)

    # Rectangles
    for rc in getattr(bp, "rects", []):
        col = _parse_colour(getattr(rc, "color", "cyan"))
        x1 = pct2px_x(rc.x)
        y1 = pct2px_y(rc.y)
        x2 = pct2px_x(rc.x + rc.w)
        y2 = pct2px_y(rc.y + rc.h)
        _draw_rect(frame, x1, y1, x2, y2, col, getattr(rc, "fill", False), line_thickness)
        label = getattr(rc, "label", "")
        if label:
            lx = (x1 + x2) // 2 - len(label) * 2 * text_scale
            ly = (y1 + y2) // 2 - 3 * text_scale
            _draw_text(frame, lx, ly, label, col, text_scale)

    # Arcs
    for ac in getattr(bp, "arcs", []):
        col = _parse_colour(getattr(ac, "color", "cyan"))
        _draw_arc(
            frame,
            pct2px_x(ac.cx), pct2px_y(ac.cy),
            pct2px_x(ac.r), pct2px_y(ac.r),
            getattr(ac, "start_angle", 0),
            getattr(ac, "end_angle", 180),
            col, line_thickness,
        )
        label = getattr(ac, "label", "")
        if label:
            mid_ang = math.radians((ac.start_angle + ac.end_angle) / 2)
            lx = pct2px_x(ac.cx) + int(pct2px_x(ac.r) * math.cos(mid_ang))
            ly = pct2px_y(ac.cy) + int(pct2px_y(ac.r) * math.sin(mid_ang))
            _draw_text(frame, lx, ly, label, col, text_scale)

    # Text labels
    for tx in getattr(bp, "texts", []):
        col = _parse_colour(getattr(tx, "color", "white"))
        s = text_scale + (1 if getattr(tx, "bold", False) else 0)
        _draw_text(frame, pct2px_x(tx.x), pct2px_y(tx.y), tx.text, col, s)

    # Blueprint name overlay (top-left)
    name = getattr(bp, "name", "")
    if name:
        _draw_text(frame, 4, 4, name, (150, 150, 150), text_scale)

    return frame


# ── Frame → Rich half-block markup conversion ────────────────────────

def frame_to_halfblock_markup(
    frame: NDArray[np.uint8],
    term_width: int,
    term_height: int,
) -> str:
    """Convert an RGB pixel frame to Rich markup using half-block chars.

    Each terminal cell encodes two vertical pixels:
    - Foreground colour → top pixel  (▀)
    - Background colour → bottom pixel

    This gives 2× vertical resolution. Horizontal resolution = term_width.

    Args:
        frame: RGB ``(H, W, 3)`` uint8 array.
        term_width: Available terminal columns.
        term_height: Available terminal rows.

    Returns:
        Rich-markup string ready for ``Static.update()``.
    """
    src_h, src_w = frame.shape[:2]

    # Target pixel dimensions: each column = 1 pixel wide, each row = 2 pixels tall
    px_w = term_width
    px_h = term_height * 2  # 2 pixels per row

    # Resample frame to target pixel dimensions using nearest-neighbour
    resampled = _resample_nearest(frame, px_w, px_h)

    lines: list[str] = []
    for row in range(term_height):
        top_row_idx = row * 2
        bot_row_idx = row * 2 + 1
        if bot_row_idx >= px_h:
            break

        parts: list[str] = []
        prev_fg = (-1, -1, -1)
        prev_bg = (-1, -1, -1)
        buf: list[str] = []

        for col in range(px_w):
            tr, tg, tb = int(resampled[top_row_idx, col, 0]), int(resampled[top_row_idx, col, 1]), int(resampled[top_row_idx, col, 2])
            br, bg_, bb = int(resampled[bot_row_idx, col, 0]), int(resampled[bot_row_idx, col, 1]), int(resampled[bot_row_idx, col, 2])

            fg = (tr, tg, tb)
            bg = (br, bg_, bb)

            if fg == bg:
                # Both pixels same colour → use █ with fg only
                if fg != prev_fg or bg != prev_bg:
                    if buf:
                        parts.append("".join(buf))
                        buf = []
                    parts.append(f"[rgb({fg[0]},{fg[1]},{fg[2]})]")
                    prev_fg = fg
                    prev_bg = bg
                buf.append("█")
            else:
                # Different → ▀ with fg=top, bg=bottom
                if fg != prev_fg or bg != prev_bg:
                    if buf:
                        parts.append("".join(buf))
                        buf = []
                    parts.append(
                        f"[rgb({fg[0]},{fg[1]},{fg[2]}) on rgb({bg[0]},{bg[1]},{bg[2]})]"
                    )
                    prev_fg = fg
                    prev_bg = bg
                buf.append("▀")

        if buf:
            parts.append("".join(buf))
        parts.append("[/]")
        lines.append("".join(parts))

    return "\n".join(lines)


def _resample_nearest(
    frame: NDArray[np.uint8], target_w: int, target_h: int
) -> NDArray[np.uint8]:
    """Nearest-neighbour resize using pure numpy (no cv2)."""
    src_h, src_w = frame.shape[:2]
    if src_h == target_h and src_w == target_w:
        return frame

    row_indices = (np.arange(target_h) * src_h / target_h).astype(int)
    col_indices = (np.arange(target_w) * src_w / target_w).astype(int)
    row_indices = np.clip(row_indices, 0, src_h - 1)
    col_indices = np.clip(col_indices, 0, src_w - 1)

    return frame[row_indices][:, col_indices]
