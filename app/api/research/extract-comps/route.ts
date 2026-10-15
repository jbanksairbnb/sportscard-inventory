import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { extractComps } from '@/lib/ai/comp-extraction';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
// Base64 of a ~3.5MB image; the client downsizes well below this.
const MAX_BASE64_CHARS = 4_800_000;

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const image_base64 = String(body?.image_base64 || '');
  const media_type = String(body?.media_type || '');
  if (!image_base64) return NextResponse.json({ error: 'image_base64 is required' }, { status: 400 });
  if (image_base64.length > MAX_BASE64_CHARS) return NextResponse.json({ error: 'Image is too large.' }, { status: 413 });
  if (!(TYPES as readonly string[]).includes(media_type)) {
    return NextResponse.json({ error: 'Unsupported image type.' }, { status: 400 });
  }

  try {
    const result = await extractComps({ image_base64, media_type: media_type as (typeof TYPES)[number] });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Extraction failed' }, { status: 500 });
  }
}
