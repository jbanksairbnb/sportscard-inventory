import Anthropic from '@anthropic-ai/sdk';

// Reads a screenshot of a sold-comps list (Card Ladder, 130point, eBay sold…)
// and returns one entry per sale. Pure transcription: the model reports what
// is printed, the modal decides what to do with it.

export type ExtractedComp = {
  venue: string;                 // "Goldin", "eBay - mintink trading cards", "" when not shown
  title: string;                 // listing title as printed
  sale_date: string | null;      // YYYY-MM-DD
  sale_type: string | null;      // "Auction", "Best Offer", "Buy It Now", … as printed
  price: number | null;
  grade_company: string | null;  // parsed from the title, e.g. "PSA"
  grade_value: string | null;    // e.g. "5", "8.5"
};

export type CompExtraction = {
  comps: ExtractedComp[];
  notes: string;
  usage: { input_tokens: number; output_tokens: number; model: string };
};

const SYSTEM_PROMPT = `You transcribe screenshots of sold-listing lists for sports cards (Card Ladder, 130point, eBay sold results and similar).

Return EVERY sale row that is fully or mostly visible, top to bottom, exactly as printed. Rules:
- Never invent or estimate a number. If a price or date is cut off or unreadable, use null for it.
- price is the sold price in US dollars as a plain number (3720.00, not "$3,720.00").
- sale_date is the date sold as YYYY-MM-DD. Dates like "Oct 11, 2026" mean 2026-10-11.
- venue is the small label above the title (e.g. "GOLDIN", "FANATICS WEEKLY", "EBAY - MINTINK TRADING CARDS"). Keep the printed wording, in normal capitalization. Empty string if there is none.
- sale_type is the printed type ("Auction", "Best Offer", "Buy It Now", "Fixed Price"…), null if not shown.
- title is the listing title verbatim.
- grade_company / grade_value come from the TITLE only ("PSA 5 EX" -> PSA / 5; "SGC 4.5" -> SGC / 4.5; "BGS 9" -> BGS / 9). Leave both null for a raw/ungraded listing or when the title names no grade.
- Skip header rows, filters, result counts and ads. Do not duplicate a row.`;

export async function extractComps(args: {
  image_base64: string;
  media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}): Promise<CompExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  const model = process.env.COMP_EXTRACT_MODEL || 'claude-sonnet-4-6';
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'report_comps',
      description: 'Report every sale visible in the screenshot.',
      input_schema: {
        type: 'object',
        properties: {
          comps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                venue: { type: 'string' },
                title: { type: 'string' },
                sale_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
                sale_type: { type: ['string', 'null'] },
                price: { type: ['number', 'null'] },
                grade_company: { type: ['string', 'null'] },
                grade_value: { type: ['string', 'null'] },
              },
              required: ['venue', 'title', 'sale_date', 'sale_type', 'price', 'grade_company', 'grade_value'],
            },
          },
          notes: { type: 'string', description: 'Anything unreadable, cut off or ambiguous. Empty if none.' },
        },
        required: ['comps', 'notes'],
      },
    }],
    tool_choice: { type: 'tool', name: 'report_comps' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: args.media_type, data: args.image_base64 } },
        { type: 'text', text: 'Transcribe every sale in this screenshot by calling report_comps.' },
      ],
    }],
  });

  const block = response.content.find(b => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('Model did not return a report_comps call.');
  const input = block.input as { comps?: unknown; notes?: unknown };
  const comps = (Array.isArray(input.comps) ? input.comps : []).map(sanitize).filter((c): c is ExtractedComp => !!c);
  return {
    comps,
    notes: input.notes ? String(input.notes) : '',
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, model: response.model },
  };
}

function sanitize(raw: unknown): ExtractedComp | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 ? r.price : null;
  const date = typeof r.sale_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.sale_date) ? r.sale_date : null;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const title = s(r.title) ?? '';
  if (!title && price === null) return null;
  return {
    venue: s(r.venue) ?? '',
    title,
    sale_date: date,
    sale_type: s(r.sale_type),
    price,
    grade_company: s(r.grade_company)?.toUpperCase() ?? null,
    grade_value: s(r.grade_value),
  };
}
