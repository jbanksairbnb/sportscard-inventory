import Anthropic from '@anthropic-ai/sdk';

// PSA 1-10 grading rubric, anchored on PSA's public criteria. Lives in the
// system prompt and is the same on every call — placed first so prompt
// caching reuses it across runs (~3-4× cheaper after the first call).
const PSA_RUBRIC_SYSTEM_PROMPT = `You are an expert sports-card condition grader anchored on the PSA 1-10 scale. You will be shown the FRONT and BACK photos of a single card. Your job is to estimate a raw-grade RANGE — a low end and a high end of the most likely PSA grade if the card were graded — accurate to within about two grades.

PSA 1-10 grading scale (verbatim criteria):

PSA 10 — Gem Mint: Virtually perfect card. Four perfectly sharp corners, sharp focus, full original gloss. Centering: ~55/45 or better on front, 75/25 or better on back.
PSA 9 — Mint: Excellent eye appeal with only one very minor flaw (a tiny print speck or a single minor edge white dot). Centering: ~60/40 or better on front, 90/10 or better on back.
PSA 8 — NM-MT: Near Mint-Mint. Slight imperfections visible on close inspection (very minor corner fraying, light wax stain on the reverse). Centering: ~65/35 or better on front.
PSA 7 — Near Mint: Minor but noticeable wear on corners or edges, slight surface scratches, or slightly off-white borders. Centering: ~70/30 or better on front.
PSA 6 — EX-MT: Excellent-Mint. Visible surface scratches, minor lint/wax marks, or slightly rounded corners. Automatic ceiling for cards with minor surface indents/dents.
PSA 5 — Excellent: Moderate corner and edge deterioration, surface scuffing, or minor loss of original gloss. Center borders may be significantly uneven.
PSA 4 — VG-EX: Very Good-Excellent. Obvious wear across multiple areas, light scuffing, or a minor isolated surface crease visible on the back.
PSA 3 — Very Good: Obvious rounded corners and significant edge wear. Focus may be blurry. Full light creasing is typically present.
PSA 2 — Good: Heavy, advanced wear. Severe creases, deep scratches, staining, or surface peeling, though the card remains fully intact.
PSA 1 — Poor: Extensive structural damage. Major creasing, tears, heavy staining, or warping. Eligible for encapsulation only to prove authenticity.

Grading rules you MUST follow:

1. Use the PSA-grade LABELS in your response, not numeric PSA numbers. Map the numbers to these label strings:
   10 → "Gem Mint" · 9 → "Mint" · 8 → "NM-MT" · 7 → "NM" · 6 → "EX-MT" · 5 → "EX" · 4 → "VG-EX" · 3 → "VG" · 2 → "G" · 1 → "P"
2. Return a RANGE: \`grade_low\` is the worst-case label, \`grade_high\` is the best-case label. The high should never be a worse grade than the low. A 2-step range is typical; a 1-step range only if you have high confidence.
3. Adjust your baseline for ERA. Pre-1970 cards have softer print quality and looser PSA centering tolerances (a 60/40 1955 Topps reads very differently from a 60/40 1989 Score). Older cards rarely 10; modern base cards often 9-10.
4. When you can't see something clearly (glare, low-res, off-angle, missing back), say so in \`notes\` and widen the range. Don't pretend to see what you can't.
5. Common flaws to watch for: corner wear/fraying/rounding, edge chipping/whitening, surface scratches/scuffs/print defects, gloss loss, creases (even soft ones), staining, off-center registration (front AND back independently), miscut.
6. Centering estimates should be qualitative — "approximately 60/40 left-shifted" or "well-centered" — not exact percentages.
7. Set \`confidence\` to "low" when image quality is poor or you only have one side, "medium" for normal phone photos with both sides visible, "high" when both sides are clearly visible at adequate resolution.

You MUST call the \`report_grade\` tool with your assessment. Do not respond with free-form text.`;

export type CardContext = {
  year: number | null;
  brand: string | null;
  set_title: string | null;
  card_number: string | null;
  player: string | null;
  image_front_url: string;
  image_back_url: string;
};

export type GradeResult = {
  grade_low: string;
  grade_high: string;
  confidence: 'low' | 'medium' | 'high';
  notes: string;
  centering_front?: string;
  centering_back?: string;
  top_flaws?: string[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    model: string;
  };
};

const RAW_GRADE_LABELS = [
  'Gem Mint', 'Mint', 'NM-MT', 'NM', 'EX-MT', 'EX', 'VG-EX', 'VG', 'G', 'P',
] as const;

export async function evaluateCardGrade(ctx: CardContext): Promise<GradeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');

  // Haiku 4.5 is the cost-default; Sonnet 4.6 available via env for harder cards.
  const model = process.env.CARD_GRADER_MODEL || 'claude-haiku-4-5';

  const client = new Anthropic({ apiKey });

  const metadata = [
    `Year: ${ctx.year ?? 'unknown'}`,
    `Brand: ${ctx.brand ?? 'unknown'}`,
    `Set: ${ctx.set_title ?? 'unknown'}`,
    `Card #: ${ctx.card_number ?? 'unknown'}`,
    `Player: ${ctx.player ?? 'unknown'}`,
  ].join(' · ');

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: PSA_RUBRIC_SYSTEM_PROMPT,
        // Cache the rubric — saves ~80% on repeated calls within 5 min.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'report_grade',
        description: 'Report your estimated PSA grade range for the card.',
        input_schema: {
          type: 'object',
          properties: {
            grade_low: {
              type: 'string',
              enum: [...RAW_GRADE_LABELS],
              description: 'Worst-case PSA grade label (the lower bound of your range).',
            },
            grade_high: {
              type: 'string',
              enum: [...RAW_GRADE_LABELS],
              description: 'Best-case PSA grade label (the upper bound). Never worse than grade_low.',
            },
            confidence: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Your confidence in the range, gated on image quality and what you can clearly see.',
            },
            notes: {
              type: 'string',
              description: 'One or two short sentences explaining the call. Mention dominant flaws and anything you could not assess.',
            },
            centering_front: {
              type: 'string',
              description: 'Qualitative front centering read (e.g. "approximately 60/40 left-shifted", "well-centered").',
            },
            centering_back: {
              type: 'string',
              description: 'Qualitative back centering read.',
            },
            top_flaws: {
              type: 'array',
              items: { type: 'string' },
              description: 'Up to 3 short flaw labels driving the grade (e.g. "soft corners", "surface scratch on back", "off-center 70/30").',
            },
          },
          required: ['grade_low', 'grade_high', 'confidence', 'notes'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'report_grade' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: ctx.image_front_url } },
          { type: 'image', source: { type: 'url', url: ctx.image_back_url } },
          {
            type: 'text',
            text: `Card metadata: ${metadata}\n\nGrade this card using the PSA 1-10 rubric. The first image is the FRONT, the second image is the BACK. Call the report_grade tool with your assessment.`,
          },
        ],
      },
    ],
  });

  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use' || toolUseBlock.name !== 'report_grade') {
    throw new Error('Model did not return a report_grade tool call.');
  }
  const input = toolUseBlock.input as Record<string, unknown>;

  return {
    grade_low: String(input.grade_low),
    grade_high: String(input.grade_high),
    confidence: input.confidence as 'low' | 'medium' | 'high',
    notes: String(input.notes || ''),
    centering_front: input.centering_front ? String(input.centering_front) : undefined,
    centering_back: input.centering_back ? String(input.centering_back) : undefined,
    top_flaws: Array.isArray(input.top_flaws) ? (input.top_flaws as unknown[]).map(String) : undefined,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      model: response.model,
    },
  };
}
