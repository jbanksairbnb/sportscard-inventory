import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { evaluateCardGrade } from '@/lib/ai/card-grading';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const image_front_url = String(body?.image_front_url || '').trim();
  const image_back_url = String(body?.image_back_url || '').trim();
  if (!image_front_url || !image_back_url) {
    return NextResponse.json({ error: 'image_front_url and image_back_url are required' }, { status: 400 });
  }

  try {
    const result = await evaluateCardGrade({
      image_front_url,
      image_back_url,
      year: body?.year ? Number(body.year) : null,
      brand: body?.brand ? String(body.brand) : null,
      set_title: body?.set_title ? String(body.set_title) : null,
      card_number: body?.card_number ? String(body.card_number) : null,
      player: body?.player ? String(body.player) : null,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Evaluation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
