export async function uploadImageToBlob(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  return String(data.url); // public URL to the photo
}
