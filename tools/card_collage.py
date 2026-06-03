#!/usr/bin/env python3
"""Combine individual card scans into grid sheets.

Each sheet places card fronts on the top row and backs on the bottom row,
N cards per row (default 4 -> 8 images per sheet). Input images are sorted
by filename. By default they're treated as interleaved front/back/front/back
(e.g. 0019=front, 0020=back, 0021=front, ...). Use --order frontsThenBacks if
your scans are all fronts followed by all backs.

Examples
--------
  # All images in a folder, 4 cards per row, white background:
  python tools/card_collage.py ./scans -o ./out

  # Explicit files, 3 per row, transparent background:
  python tools/card_collage.py a.jpg b.jpg c.jpg d.jpg -o out --cols 3 --transparent

Requires Pillow:  pip install pillow
"""

from __future__ import annotations

import argparse
import os
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


def pair_up(paths: list[Path], order: str) -> list[tuple[Path | None, Path | None]]:
    """Return [(front, back), ...] pairs based on input ordering."""
    pairs: list[tuple[Path | None, Path | None]] = []
    if order == "interleaved":
        for i in range(0, len(paths), 2):
            front = paths[i]
            back = paths[i + 1] if i + 1 < len(paths) else None
            pairs.append((front, back))
    else:  # frontsThenBacks
        half = (len(paths) + 1) // 2
        fronts, backs = paths[:half], paths[half:]
        for i in range(half):
            pairs.append((fronts[i], backs[i] if i < len(backs) else None))
    return pairs


def draw_contain(canvas: Image.Image, src: Path | None, x: int, y: int,
                 cw: int, ch: int) -> None:
    """Paste an image scaled to fit (cw, ch), preserving aspect, centered."""
    if src is None:
        return
    with Image.open(src) as im:
        im = im.convert("RGBA")
        scale = min(cw / im.width, ch / im.height)
        w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
        im = im.resize((w, h), Image.LANCZOS)
        canvas.alpha_composite(im, (x + (cw - w) // 2, y + (ch - h) // 2))


def cell_height(paths: list[Path], cell_w: int) -> int:
    """Uniform cell height from the tallest card aspect ratio."""
    max_ratio = 1.4  # typical card height/width
    for p in paths:
        try:
            with Image.open(p) as im:
                max_ratio = max(max_ratio, im.height / im.width)
        except Exception:
            pass
    return round(cell_w * max_ratio)


def build(paths: list[Path], out_dir: Path, cols: int, cell_w: int, gap: int,
          bg: str, transparent: bool, order: str, prefix: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    pairs = pair_up(paths, order)
    cell_h = cell_height(paths, cell_w)
    fill = (0, 0, 0, 0) if transparent else (*hex_to_rgb(bg), 255)

    sheet_no = 0
    for s in range(0, len(pairs), cols):
        group = pairs[s:s + cols]
        n = len(group)
        width = n * cell_w + (n + 1) * gap
        height = 2 * cell_h + 3 * gap
        canvas = Image.new("RGBA", (width, height), fill)

        for c, (front, back) in enumerate(group):
            x = gap + c * (cell_w + gap)
            draw_contain(canvas, front, x, gap, cell_w, cell_h)               # top row
            draw_contain(canvas, back, x, gap * 2 + cell_h, cell_w, cell_h)   # bottom row

        sheet_no += 1
        out = out_dir / f"{prefix}{sheet_no:02d}.png"
        if not transparent:
            canvas = canvas.convert("RGB")
        canvas.save(out)
        print(f"  wrote {out}  ({width}x{height}, {n} card{'s' if n != 1 else ''})")

    if sheet_no == 0:
        print("  no images found — nothing to do.")


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="Image files and/or folders.")
    ap.add_argument("-o", "--out", default="collage_out", help="Output directory.")
    ap.add_argument("--cols", type=int, default=4, help="Cards per row (default 4).")
    ap.add_argument("--cell-width", type=int, default=700, dest="cell_w",
                    help="Cell width in px (default 700).")
    ap.add_argument("--gap", type=int, default=24, help="Gap in px (default 24).")
    ap.add_argument("--bg", default="#ffffff", help="Background color (default white).")
    ap.add_argument("--transparent", action="store_true", help="Transparent background.")
    ap.add_argument("--order", choices=["interleaved", "frontsThenBacks"],
                    default="interleaved", help="Input image ordering.")
    ap.add_argument("--prefix", default="card-collage-sheet-",
                    help="Output filename prefix.")
    args = ap.parse_args(argv)

    paths = gather_images(args.inputs)
    if not paths:
        print("No images found.", file=sys.stderr)
        return 1
    print(f"Found {len(paths)} image(s); {args.cols} card(s) per row, "
          f"order={args.order}.")
    build(paths, Path(args.out), args.cols, args.cell_w, args.gap,
          args.bg, args.transparent, args.order, args.prefix)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
