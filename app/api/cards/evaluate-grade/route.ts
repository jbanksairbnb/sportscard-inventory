import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { evaluateCardGrade, type GradeResult } from '@/lib/ai/card-grading';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Haiku 4.5 = $1/M in, $5/M out. Cached input @ 0.1x rate, write @ 1.25x.
// Logged per-call so the admin dashboard can show cumulative + per-card cost.
function costFromUsage(u: GradeResult['usage']): number {
  return (
    u.input_tokens * 1.0 +
    u.cache_read_input_tokens * 0.1 +
    u.cache_creation_input_tokens * 1.25 +
    u.output_tokens * 5.0
  ) / 1_000_000;
}

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
  if (!image_front_url) {
    return NextResponse.json({ error: 'image_front_url is required' }, { status: 400 });
  }
  const source = String(body?.source || 'unknown').trim();
  const year = body?.year ? Number(body.year) : null;
  const brand = body?.brand ? String(body.brand) : null;
  const set_title = body?.set_title ? String(body.set_title) : null;
  const card_number = body?.card_number ? String(body.card_number) : null;
  const player = body?.player ? String(body.player) : null;

  const startedAt = Date.now();
  try {
    const result = await evaluateCardGrade({
      image_front_url,
      image_back_url: image_back_url || null,
      year,
      brand,
      set_title,
      card_number,
      player,
    });
    const latency_ms = Date.now() - startedAt;
    const cost = costFromUsage(result.usage);

    // Log success. Best-effort: failure to log shouldn't break the grade.
    let log_id: string | null = null;
    try {
      const { data: ins } = await supabase.from('card_grades').insert({
        user_id: user.id,
        source,
        year, brand, set_title, card_number, player,
        image_front_url, image_back_url: image_back_url || null,
        ai_model: result.usage.model,
        ai_grade_low: result.grade_low,
        ai_grade_high: result.grade_high,
        ai_confidence: result.confidence,
        ai_notes: result.notes,
        ai_corners: result.corners ?? null,
        ai_edges: result.edges ?? null,
        ai_surface: result.surface ?? null,
        ai_centering_front: result.centering_front ?? null,
        ai_centering_back: result.centering_back ?? null,
        ai_top_flaws: result.top_flaws ?? null,
        ai_cost_dollars: cost,
        ai_latency_ms: latency_ms,
      }).select('id').single();
      log_id = ins?.id ?? null;
    } catch { /* logging is best-effort */ }

    return NextResponse.json({ ...result, log_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Evaluation failed';
    const latency_ms = Date.now() - startedAt;
    // Log failure too — these drive the failure-pattern admin view.
    try {
      await supabase.from('card_grades').insert({
        user_id: user.id,
        source,
        year, brand, set_title, card_number, player,
        image_front_url, image_back_url: image_back_url || null,
        error_message: msg,
        ai_latency_ms: latency_ms,
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
