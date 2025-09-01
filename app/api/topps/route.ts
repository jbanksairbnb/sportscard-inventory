import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';       // ✅ required if using fs on Vercel/edge
export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'data', 'topps');

async function readJson<T = any>(file: string): Promise<T> {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as T;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const set = url.searchParams.get('set');

    if (!set) {
      const sets = await readJson(path.join(DATA_DIR, 'sets.json'));
      return NextResponse.json(sets);
    }

    const filePath = path.join(DATA_DIR, `${set}.json`);
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: `Set '${set}' not found` }, { status: 404 });
    }

    const rows = await readJson(filePath);
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('API error:', err);   // ✅ watch terminal for details
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 });
  }
}
