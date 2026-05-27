// Scanner-padding auto-trim. Sellers commonly overscan their cards (the
// scanner needs the overscan to avoid clipping edges), so the uploaded
// file has a thick uniform border around the card. We can't see that
// border in the card editor or the side-by-side composite without
// stripping it, but stripping it ALL also looks wrong — the user said
// they want roughly half the border preserved.
//
// Heuristic:
//   1. Sample the four corners. If they're all within color tolerance
//      of each other, there's a uniform mat around the card.
//   2. Walk inward from each edge until the row/column mean color
//      significantly differs from the corner color. That distance is
//      the padding on that side.
//   3. Halve each side's padding and crop. Re-encode and return a new
//      File. If anything is off (corners aren't uniform, padding is
//      too small to meaningfully be "mat", crop would shrink the image
//      below a sanity threshold), return the original file unchanged.
//
// Safe by construction: never crops a scan that has no detectable mat,
// and never adds padding. Works the same for any mat color (black,
// white, cream, plum, etc.) because the heuristic is "corners are
// uniform," not tuned to a specific scanner setup.

const CORNER_PATCH = 16;          // px per corner sample
const CORNER_TOL = 30;            // RGB Euclidean distance — max corner-to-corner variance to consider the scan "has a uniform mat"
const DEPART_TOL = 40;            // RGB Euclidean distance — row/column mean distance from bg color that counts as "card content starts here"
const MIN_PAD_PCT = 0.05;         // at least one side must have ≥5% padding to trigger the crop (otherwise it's a tight scan / card border, leave it alone)
const MIN_OUTPUT_DIM = 100;       // never crop below this many pixels on either axis

type RGB = { r: number; g: number; b: number };

export async function cropScanPadding(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  let img: HTMLImageElement;
  const url = URL.createObjectURL(file);
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return file;
  }

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h || w < MIN_OUTPUT_DIM * 2 || h < MIN_OUTPUT_DIM * 2) {
    URL.revokeObjectURL(url);
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    return file;
  }
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas (cross-origin); we can't read the pixels so we
    // can't crop. Pass the file through untouched.
    return file;
  }
  const data = imgData.data;

  const corners: RGB[] = [
    samplePatch(data, w, 0, 0),
    samplePatch(data, w, w - CORNER_PATCH, 0),
    samplePatch(data, w, 0, h - CORNER_PATCH),
    samplePatch(data, w, w - CORNER_PATCH, h - CORNER_PATCH),
  ];
  const bg: RGB = {
    r: median(corners.map(c => c.r)),
    g: median(corners.map(c => c.g)),
    b: median(corners.map(c => c.b)),
  };
  for (const c of corners) {
    if (dist(c, bg) > CORNER_TOL) return file;
  }

  const topPad = findPadFromTop(data, w, h, bg);
  const bottomPad = findPadFromBottom(data, w, h, bg);
  const leftPad = findPadFromLeft(data, w, h, bg);
  const rightPad = findPadFromRight(data, w, h, bg);

  // If no side has at least MIN_PAD_PCT of the corresponding dimension,
  // we're looking at a tight scan whose corners happen to match (e.g.
  // a 1971 card scanned with no mat — the corners are the card's own
  // black border). Cropping into the card border would be wrong.
  const maxSideRatio = Math.max(
    topPad / h, bottomPad / h, leftPad / w, rightPad / w,
  );
  if (maxSideRatio < MIN_PAD_PCT) return file;

  const newTop = Math.floor(topPad / 2);
  const newBottom = Math.floor(bottomPad / 2);
  const newLeft = Math.floor(leftPad / 2);
  const newRight = Math.floor(rightPad / 2);

  const cropW = w - newLeft - newRight;
  const cropH = h - newTop - newBottom;
  if (cropW < MIN_OUTPUT_DIM || cropH < MIN_OUTPUT_DIM) return file;
  if (cropW === w && cropH === h) return file;

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) return file;
  octx.drawImage(canvas, -newLeft, -newTop);

  const isPng = file.type === 'image/png';
  const mime = isPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>(resolve =>
    out.toBlob(b => resolve(b), mime, 0.92),
  );
  if (!blob) return file;

  const stem = file.name.replace(/\.[^.]+$/, '');
  const newName = isPng ? `${stem}.png` : `${stem}.jpg`;
  return new File([blob], newName, { type: mime, lastModified: Date.now() });
}

function samplePatch(data: Uint8ClampedArray, w: number, x0: number, y0: number): RGB {
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let dy = 0; dy < CORNER_PATCH; dy++) {
    for (let dx = 0; dx < CORNER_PATCH; dx++) {
      const i = ((y0 + dy) * w + (x0 + dx)) * 4;
      rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
      n++;
    }
  }
  return { r: rSum / n, g: gSum / n, b: bSum / n };
}

function rowMeanDist(data: Uint8ClampedArray, w: number, y: number, bg: RGB): number {
  const step = Math.max(1, Math.floor(w / 64));
  let sum = 0, n = 0;
  for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4;
    const dr = data[i] - bg.r;
    const dg = data[i + 1] - bg.g;
    const db = data[i + 2] - bg.b;
    sum += Math.sqrt(dr * dr + dg * dg + db * db);
    n++;
  }
  return sum / Math.max(1, n);
}

function colMeanDist(data: Uint8ClampedArray, w: number, h: number, x: number, bg: RGB): number {
  const step = Math.max(1, Math.floor(h / 64));
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += step) {
    const i = (y * w + x) * 4;
    const dr = data[i] - bg.r;
    const dg = data[i + 1] - bg.g;
    const db = data[i + 2] - bg.b;
    sum += Math.sqrt(dr * dr + dg * dg + db * db);
    n++;
  }
  return sum / Math.max(1, n);
}

function findPadFromTop(data: Uint8ClampedArray, w: number, h: number, bg: RGB): number {
  for (let y = 0; y < h; y++) {
    if (rowMeanDist(data, w, y, bg) > DEPART_TOL) return y;
  }
  return h;
}

function findPadFromBottom(data: Uint8ClampedArray, w: number, h: number, bg: RGB): number {
  for (let y = h - 1; y >= 0; y--) {
    if (rowMeanDist(data, w, y, bg) > DEPART_TOL) return h - 1 - y;
  }
  return h;
}

function findPadFromLeft(data: Uint8ClampedArray, w: number, h: number, bg: RGB): number {
  for (let x = 0; x < w; x++) {
    if (colMeanDist(data, w, h, x, bg) > DEPART_TOL) return x;
  }
  return w;
}

function findPadFromRight(data: Uint8ClampedArray, w: number, h: number, bg: RGB): number {
  for (let x = w - 1; x >= 0; x--) {
    if (colMeanDist(data, w, h, x, bg) > DEPART_TOL) return w - 1 - x;
  }
  return w;
}

function dist(a: RGB, b: RGB): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
