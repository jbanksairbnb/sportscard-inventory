#!/usr/bin/env python3
"""Combine card *front* scans into 6-up collage sheets.

This is a focused companion to ``card_collage.py``. Where that tool lays
fronts on a top row and backs on a bottom row, this one does **fronts only**
and arranges them in a simple grid (default 3 columns x 2 rows = 6 cards per
sheet).

Two extra behaviours tailored to these scans:

* **Fronts only.** Scans are interleaved front/back/front/back, where the
  number embedded in each filename is *odd for fronts* and *even for backs*
  (e.g. 0007=front, 0008=back, 0009=front, ...). By default only the
  odd-numbered images are used. Flip this with ``--evens-are-fronts`` or
  include everything with ``--all``.

* **Reduce borders by half.** Every scan has a consistent dark border around
  the card. Each image is auto-trimmed so that only *half* of that border
  margin remains on every side, tightening the cards before they are placed
  on the sheet. Tune with ``--trim-fraction`` (0 keeps the full border, 1
  crops right to the card edge) or disable with ``--no-trim``.

Examples
--------
  # All fronts in a folder, 6 per sheet (3x2), white background:
  python tools/front_collage.py ./scans -o ./out

  # 4 fronts per row, keep 25% of the border, transparent background:
  python tools/front_collage.py ./scans -o out --cols 4 --trim-fraction 0.75 --transparent

Requires Pillow:  pip install pillow
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required. Install it with:  pip install pillow")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif"}


def natural_key(path: Path):
    """Sort like a human: 0009 before 0010, 2 before 10."""
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r"(\d+)", path.name)]


def last_number(path: Path) -> int | None:
    """Return the last integer found in the filename stem, or None."""
    nums = re.findall(r"\d+", path.stem)
    return int(nums[-1]) if nums else None


def gather_images(inputs: list[str]) -> list[Path]:
    paths: list[Path] = []
    for item in inputs:
        p = Path(item)
        if p.is_dir():
            paths.extend(f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXTS)
        elif p.is_file():
            paths.append(p)
        else:
            print(f"  ! skipping (not found): {item}", file=sys.stderr)
    return sorted(paths, key=natural_key)


def select_fronts(paths: list[Path], evens_are_fronts: bool) -> list[Path]:
    """Keep only front scans, identified by the parity of the filename number.

    Files with no number fall back to their position in the sorted list
    (every other one, starting from the first), so the tool still does
    something sensible on oddly-named inputs.
    """
    fronts: list[Path] = []
    for i, p in enumerate(paths):
        n = last_number(p)
        is_front = (n % 2 == 0) if evens_are_fronts else (n % 2 == 1)
        if n is None:
            is_front = (i % 2 == 0)
        if is_front:
            fronts.append(p)
    return fronts


def trim_border(im: Image.Image, fraction: float, threshold: int) -> Image.Image:
    """Crop away ``fraction`` of the dark border around the card.

    Auto-detects the card bounding box (the region brighter than
    ``threshold``) and keeps ``1 - fraction`` of the original margin on each
    side. ``fraction=0.5`` halves the border. Returns the image unchanged if
    no border is detected.
    """
    if fraction <= 0:
        return im
    rgb = im.convert("RGB")
    # Difference from pure black; anything above the threshold is "card".
    gray = rgb.convert("L")
    mask = gray.point(lambda v: 255 if v > threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        return im
    left, top, right, bottom = bbox
    w, h = im.width, im.height
    # Margin widths on each side, and how much of each to crop off the outside.
    cut = min(1.0, fraction)
    new_left = round(left * cut)
    new_top = round(top * cut)
    new_right = w - round((w - right) * cut)
    new_bottom = h - round((h - bottom) * cut)
    # Guard against degenerate crops.
    if new_right <= new_left or new_bottom <= new_top:
        return im
    return im.crop((new_left, new_top, new_right, new_bottom))


def load_card(src: Path, trim_fraction: float, threshold: int) -> Image.Image:
    im = Image.open(src)
    im.load()
    im = trim_border(im, trim_fraction, threshold)
    return im.convert("RGBA")


def draw_contain(canvas: Image.Image, card: Image.Image | None, x: int, y: int,
                 cw: int, ch: int) -> None:
    """Paste a card scaled to fit (cw, ch), preserving aspect, centered."""
    if card is None:
        return
    scale = min(cw / card.width, ch / card.height)
    w, h = max(1, round(card.width * scale)), max(1, round(card.height * scale))
    resized = card.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(resized, (x + (cw - w) // 2, y + (ch - h) // 2))


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def build(cards: list[Image.Image], out_dir: Path, cols: int, rows: int,
          cell_w: int, gap: int, bg: str, transparent: bool, prefix: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    fill = (0, 0, 0, 0) if transparent else (*hex_to_rgb(bg), 255)

    # Uniform cell height from the tallest card aspect ratio.
    max_ratio = max((c.height / c.width for c in cards), default=1.4)
    cell_h = round(cell_w * max_ratio)

    per_sheet = cols * rows
    sheet_no = 0
    for s in range(0, len(cards), per_sheet):
        group = cards[s:s + per_sheet]
        n_rows = (len(group) + cols - 1) // cols
        width = cols * cell_w + (cols + 1) * gap
        height = n_rows * cell_h + (n_rows + 1) * gap
        canvas = Image.new("RGBA", (width, height), fill)

        for idx, card in enumerate(group):
            r, c = divmod(idx, cols)
            x = gap + c * (cell_w + gap)
            y = gap + r * (cell_h + gap)
            draw_contain(canvas, card, x, y, cell_w, cell_h)

        sheet_no += 1
        out = out_dir / f"{prefix}{sheet_no:02d}.png"
        if not transparent:
            canvas = canvas.convert("RGB")
        canvas.save(out)
        print(f"  wrote {out}  ({width}x{height}, {len(group)} card"
              f"{'s' if len(group) != 1 else ''})")

    if sheet_no == 0:
        print("  no images found — nothing to do.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="Image files and/or folders.")
    ap.add_argument("-o", "--out", default="front_collage_out", help="Output directory.")
    ap.add_argument("--cols", type=int, default=3, help="Cards per row (default 3).")
    ap.add_argument("--rows", type=int, default=2, help="Rows per sheet (default 2 -> 6 per sheet).")
    ap.add_argument("--cell-width", type=int, default=700, dest="cell_w",
                    help="Cell width in px (default 700).")
    ap.add_argument("--gap", type=int, default=24, help="Gap in px (default 24).")
    ap.add_argument("--bg", default="#ffffff", help="Background color (default white).")
    ap.add_argument("--transparent", action="store_true", help="Transparent background.")
    ap.add_argument("--trim-fraction", type=float, default=0.5, dest="trim_fraction",
                    help="Fraction of each card's border to remove "
                         "(default 0.5 = halve the border; 0 keeps it, 1 crops to the card).")
    ap.add_argument("--no-trim", action="store_true",
                    help="Disable border trimming (same as --trim-fraction 0).")
    ap.add_argument("--border-threshold", type=int, default=40, dest="threshold",
                    help="Brightness (0-255) above which a pixel counts as card, "
                         "not border (default 40).")
    ap.add_argument("--evens-are-fronts", action="store_true",
                    help="Treat even-numbered files as fronts instead of odd.")
    ap.add_argument("--all", action="store_true",
                    help="Use every image (don't filter to fronts only).")
    ap.add_argument("--prefix", default="front-collage-sheet-",
                    help="Output filename prefix.")
    args = ap.parse_args(argv)

    paths = gather_images(args.inputs)
    if not paths:
        print("No images found.", file=sys.stderr)
        return 1

    selected = paths if args.all else select_fronts(paths, args.evens_are_fronts)
    if not selected:
        print("No front images selected.", file=sys.stderr)
        return 1

    trim_fraction = 0.0 if args.no_trim else args.trim_fraction
    per_sheet = args.cols * args.rows
    print(f"Found {len(paths)} image(s); using {len(selected)} front(s); "
          f"{args.cols}x{args.rows} = {per_sheet} per sheet; "
          f"trim={trim_fraction:g}.")

    cards = [load_card(p, trim_fraction, args.threshold) for p in selected]
    build(cards, Path(args.out), args.cols, args.rows, args.cell_w, args.gap,
          args.bg, args.transparent, args.prefix)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
