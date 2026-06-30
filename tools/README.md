# Card Collage Builder

Combine individual card scans into grid sheets where **fronts go on the top row
and backs on the bottom row**, N cards per row (default 4 → 8 images per sheet).

> **Just want a sheet of fronts?** See
> [Fronts-only 6-up collage](#fronts-only-6-up-collage) below — it skips the
> backs, packs 6 cards per sheet, and trims the dark border around each card by
> half.

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

## Fronts-only 6-up collage

`front_collage.py` is a focused variant for when you only want the **fronts**,
laid out **6 cards per sheet** (3 across × 2 down by default), with the dark
border around each card **reduced by half**.

Requires [Pillow](https://pillow.readthedocs.io): `pip install pillow`

```bash
# All fronts in a folder, 6 per sheet (3x2), border halved, white background:
python tools/front_collage.py ./scans -o ./out

# 4 fronts per row, keep only 25% of the border, transparent background:
python tools/front_collage.py ./scans -o out --cols 4 --trim-fraction 0.75 --transparent
```

How it picks fronts and trims borders:

- **Fronts only.** Scans are interleaved front/back/front/back, where the number
  in each filename is **odd for fronts** and **even for backs** (`0007`=front,
  `0008`=back, `0009`=front, …). Only odd-numbered images are used. Flip this
  with `--evens-are-fronts`, or include every image with `--all`.
- **Reduce borders by half.** Each scan is auto-trimmed so only **half** of the
  dark border margin remains on every side. Tune with `--trim-fraction` (`0`
  keeps the full border, `0.5` halves it, `1` crops right to the card edge) or
  turn it off with `--no-trim`. If a scan's border is lighter or darker than
  expected, adjust `--border-threshold` (0–255; pixels brighter than this count
  as card rather than border).

| Option               | Default                | Meaning                                          |
| -------------------- | ---------------------- | ------------------------------------------------ |
| `inputs`             | —                      | Image files and/or folders (required)            |
| `-o, --out`          | `front_collage_out`    | Output directory                                 |
| `--cols`             | `3`                    | Cards per row                                    |
| `--rows`             | `2`                    | Rows per sheet (3 × 2 = 6 cards)                 |
| `--cell-width`       | `700`                  | Cell width in px                                 |
| `--gap`              | `24`                   | Gap between cells in px                          |
| `--bg`               | `#ffffff`              | Background color                                 |
| `--transparent`      | off                    | Transparent background (overrides `--bg`)        |
| `--trim-fraction`    | `0.5`                  | Fraction of each card's border to remove         |
| `--no-trim`          | off                    | Disable border trimming                          |
| `--border-threshold` | `40`                   | Brightness above which a pixel counts as card    |
| `--evens-are-fronts` | off                    | Treat even-numbered files as fronts              |
| `--all`              | off                    | Use every image (don't filter to fronts only)    |
| `--prefix`           | `front-collage-sheet-` | Output filename prefix                           |

Cards beyond the per-sheet count paginate into additional sheets automatically.
