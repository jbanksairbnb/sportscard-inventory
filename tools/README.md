# Card Collage Builder

Combine individual card scans into grid sheets where **fronts go on the top row
and backs on the bottom row**, N cards per row (default 4 → 8 images per sheet).

Two ways to use it — pick whichever you like:

## 1. Browser tool (no install)

Open [`card-collage.html`](./card-collage.html) in any browser (double-click the
file). Then:

1. Drag your scans onto the drop zone (or click to choose them).
2. Files are sorted by name. Each thumbnail is tagged **F**/**B** so you can
   confirm the front/back split before building.
3. Set cards-per-row, cell size, gap, and background, then **Build sheets**.
4. **Download PNG** for each sheet.

Everything runs locally in the browser — no images are uploaded anywhere.

## 2. Python CLI (batch / automation)

Requires [Pillow](https://pillow.readthedocs.io): `pip install pillow`

```bash
# All images in a folder, 4 cards per row, white background
python tools/card_collage.py ./scans -o ./out

# Explicit files, 3 per row, transparent background
python tools/card_collage.py a.jpg b.jpg c.jpg d.jpg -o out --cols 3 --transparent
```

| Option           | Default                 | Meaning                                       |
| ---------------- | ----------------------- | --------------------------------------------- |
| `inputs`         | —                       | Image files and/or folders (required)         |
| `-o, --out`      | `collage_out`           | Output directory                              |
| `--cols`         | `4`                     | Cards per row                                 |
| `--cell-width`   | `700`                   | Cell width in px                              |
| `--gap`          | `24`                    | Gap between cells in px                        |
| `--bg`           | `#ffffff`               | Background color                              |
| `--transparent`  | off                     | Transparent background (overrides `--bg`)     |
| `--order`        | `interleaved`           | `interleaved` or `frontsThenBacks`            |
| `--prefix`       | `card-collage-sheet-`   | Output filename prefix                        |

## Image ordering

Both tools sort by filename and, by default, assume scans are **interleaved**
front/back/front/back — e.g. `0019` (front), `0020` (back), `0021` (front),
`0022` (back), … That matches scanning a card front then immediately its back.

If instead you scanned all fronts first and all backs after, use
`--order frontsThenBacks` (CLI) or the "All fronts, then all backs" option
(browser).

If you give more cards than fit in one row, the tools paginate into multiple
sheets automatically. Each card's front and back always line up in the same
column.
