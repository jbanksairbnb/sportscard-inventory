function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Replace the scan background of an image with the chosen color. We flood-fill
// from the canvas edges so only the connected outer region is recolored — the
// card itself stays pristine. If the edge sample isn't clearly black or white,
// we leave the image alone.
export function replaceImageBg(img: HTMLImageElement, targetHex: string): HTMLCanvasElement | HTMLImageElement {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return img;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch {
    return img;
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
  if (!isBlack && !isWhite) return img;

  const target = hexToRgb(targetHex);
  const targetLum = (target.r + target.g + target.b) / 3;
  if (isBlack && targetLum < 30) return img;
  if (isWhite && targetLum > 230) return img;

  const tolerance = isBlack ? 70 : 55;
  const tolSq = tolerance * tolerance;
  const visited = new Uint8Array(w * h);
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
  while (head < queue.length) {
    const idx = queue[head++];
    if (visited[idx]) continue;
    visited[idx] = 1;
    const i = idx * 4;
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    if (dr * dr + dg * dg + db * db > tolSq) continue;
    data[i] = target.r;
    data[i + 1] = target.g;
    data[i + 2] = target.b;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0 && !visited[idx - 1]) queue.push(idx - 1);
    if (x < w - 1 && !visited[idx + 1]) queue.push(idx + 1);
    if (y > 0 && !visited[idx - w]) queue.push(idx - w);
    if (y < h - 1 && !visited[idx + w]) queue.push(idx + w);
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
