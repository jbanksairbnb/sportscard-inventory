function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Replace the scan background of an image with the chosen color and crop to
// the card's bounding box. We flood-fill from the canvas edges so only the
// connected outer region is recolored (the card itself stays pristine), then
// trim the canvas to the bbox of un-filled pixels so collage layout doesn't
// inherit the scan's padding.
export function replaceImageBg(img: HTMLImageElement, targetHex: string): HTMLCanvasElement {
  const w = img.naturalWidth, h = img.naturalHeight;
  const original = document.createElement('canvas');
  original.width = Math.max(1, w);
  original.height = Math.max(1, h);
  const ctx = original.getContext('2d');
  if (!ctx || !w || !h) {
    if (ctx) ctx.drawImage(img, 0, 0);
    return original;
  }
  ctx.drawImage(img, 0, 0);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch {
    return original;
  }
  const data = imgData.data;

  const stepX = Math.max(1, Math.floor(w / 64));
  const stepY = Math.max(1, Math.floor(h / 64));
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let x = 0; x < w; x += stepX) {
    const top = x * 4;
    const bot = ((h - 1) * w + x) * 4;
    rSum += data[top] + data[bot];
    gSum += data[top + 1] + data[bot + 1];
    bSum += data[top + 2] + data[bot + 2];
    count += 2;
  }
  for (let y = 0; y < h; y += stepY) {
    const left = (y * w) * 4;
    const right = (y * w + w - 1) * 4;
    rSum += data[left] + data[right];
    gSum += data[left + 1] + data[right + 1];
    bSum += data[left + 2] + data[right + 2];
    count += 2;
  }
  const bgR = rSum / count;
  const bgG = gSum / count;
  const bgB = bSum / count;
  const lum = (bgR + bgG + bgB) / 3;

  const isBlack = lum < 60;
  const isWhite = lum > 215;
  if (!isBlack && !isWhite) return original;

  const target = hexToRgb(targetHex);
  const targetLum = (target.r + target.g + target.b) / 3;
  if (isBlack && targetLum < 30) return original;
  if (isWhite && targetLum > 230) return original;

  const tolerance = isBlack ? 70 : 55;
  const tolSq = tolerance * tolerance;
  const filled = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let x = 0; x < w; x++) {
    queue.push(x);
    queue.push((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    queue.push(y * w);
    queue.push(y * w + (w - 1));
  }

  let head = 0;
  let filledCount = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    if (filled[idx]) continue;
    const i = idx * 4;
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    if (dr * dr + dg * dg + db * db > tolSq) continue;
    filled[idx] = 1;
    filledCount++;
    data[i] = target.r;
    data[i + 1] = target.g;
    data[i + 2] = target.b;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0 && !filled[idx - 1]) queue.push(idx - 1);
    if (x < w - 1 && !filled[idx + 1]) queue.push(idx + 1);
    if (y > 0 && !filled[idx - w]) queue.push(idx - w);
    if (y < h - 1 && !filled[idx + w]) queue.push(idx + w);
  }

  // If the flood ran past the scan padding and into the card body, the
  // card's own border is the same color as the scan bg (1971 Topps black
  // borders on a black scan mat is the canonical case). Re-painting in
  // that situation would erase the card's border, so bail out and leave
  // the image untouched — the scan padding survives but so does the
  // card. `data` was mutated in-place but we never putImageData'd, so
  // `original` is still the pristine scan.
  if (filledCount > 0.6 * w * h) return original;

  ctx.putImageData(imgData, 0, 0);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!filled[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return original;

  const pad = 12;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  if (cw === w && ch === h) return original;

  const cropped = document.createElement('canvas');
  cropped.width = cw;
  cropped.height = ch;
  const cctx = cropped.getContext('2d');
  if (!cctx) return original;
  cctx.fillStyle = targetHex;
  cctx.fillRect(0, 0, cw, ch);
  cctx.drawImage(original, minX, minY, cw, ch, 0, 0, cw, ch);
  return cropped;
}
