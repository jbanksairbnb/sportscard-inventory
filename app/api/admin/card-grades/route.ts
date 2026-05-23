import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const BOOTSTRAP_ADMIN_EMAIL = 'jbanks@sports-collective.com';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function isAdminUser(admin: SupabaseClient, user: User): Promise<boolean> {
  if (user.email === BOOTSTRAP_ADMIN_EMAIL) return true;
  const { data } = await admin
    .from('user_profiles').select('is_admin').eq('user_id', user.id).maybeSingle();
  return !!data?.is_admin;
}

export async function GET(req: NextRequest) {
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
  const admin = adminClient();
  if (!(await isAdminUser(admin, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const source = url.searchParams.get('source');
  const status = url.searchParams.get('status'); // 'success' | 'fail' | null

  let q = admin
    .from('card_grades')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (source) q = q.eq('source', source);
  if (status === 'fail') q = q.not('error_message', 'is', null);
  if (status === 'success') q = q.is('error_message', null);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate stats over the unfiltered last-7-days for the dashboard.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: agg } = await admin
    .from('card_grades')
    .select('error_message, ai_cost_dollars, ai_latency_ms, ai_confidence')
    .gte('created_at', sevenDaysAgo);
  type AggRow = { error_message: string | null; ai_cost_dollars: number | null; ai_latency_ms: number | null; ai_confidence: string | null };
  const aggRows: AggRow[] = (agg || []) as AggRow[];
  const failed = aggRows.filter(r => r.error_message).length;
  const total = aggRows.length;
  const totalCost = aggRows.reduce((s, r) => s + Number(r.ai_cost_dollars || 0), 0);
  const successLatencies = aggRows
    .filter(r => !r.error_message && r.ai_latency_ms)
    .map(r => r.ai_latency_ms as number);
  const avgLatency = successLatencies.length > 0
    ? Math.round(successLatencies.reduce((s, n) => s + n, 0) / successLatencies.length)
    : 0;
  const confidenceCounts: Record<string, number> = { low: 0, medium: 0, high: 0 };
  for (const r of aggRows) {
    if (r.ai_confidence) confidenceCounts[r.ai_confidence] = (confidenceCounts[r.ai_confidence] || 0) + 1;
  }

  // Assessment counts across the 7-day window (separate from filtered table).
  type AssessRow = { seller_assessment: string | null };
  const { data: assessAgg } = await admin
    .from('card_grades')
    .select('seller_assessment')
    .gte('created_at', sevenDaysAgo)
    .not('seller_assessment', 'is', null);
  const assessmentCounts: Record<string, number> = { correct: 0, too_high: 0, too_low: 0 };
  for (const r of (assessAgg || []) as AssessRow[]) {
    if (r.seller_assessment) assessmentCounts[r.seller_assessment] = (assessmentCounts[r.seller_assessment] || 0) + 1;
  }

  return NextResponse.json({
    rows: data || [],
    stats: {
      window_days: 7,
      total,
      failed,
      failure_rate: total > 0 ? failed / total : 0,
      total_cost_dollars: totalCost,
      avg_latency_ms: avgLatency,
      confidence_counts: confidenceCounts,
      assessment_counts: assessmentCounts,
    },
  });
}

// PATCH: rate a specific card_grade row from the dashboard. Updates
// seller_assessment (correct/too_high/too_low) and/or user_final_grade
// (the precise grade the seller thinks is right). Admin-only.
export async function PATCH(req: NextRequest) {
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
  const admin = adminClient();
  if (!(await isAdminUser(admin, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || '').trim();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ('seller_assessment' in body) {
    const v = body.seller_assessment;
    if (v === null) patch.seller_assessment = null;
    else if (v === 'correct' || v === 'too_high' || v === 'too_low') patch.seller_assessment = v;
    else return NextResponse.json({ error: 'invalid seller_assessment' }, { status: 400 });
  }
  if ('user_final_grade' in body) {
    const v = body.user_final_grade;
    patch.user_final_grade = v === null || v === '' ? null : String(v);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no patchable fields' }, { status: 400 });
  }

  const { error } = await admin.from('card_grades').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
