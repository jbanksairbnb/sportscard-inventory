"""Generate a branded Sports Collective Pilot Walkthrough PDF.

Run: python3 docs/build_pilot_walkthrough_pdf.py
Outputs: docs/Sports-Collective-Pilot-Walkthrough.pdf

Source content is the user's draft .docx, polished and reorganized:
  - cover page with logo + tagline
  - problem / solution two-column
  - 10-minute inventory walkthrough (numbered, time-boxed steps)
  - 15-minute selling walkthrough
  - closing pilot offer
"""
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle,
    KeepTogether,
)
from reportlab.pdfgen import canvas

PLUM    = HexColor('#3D1F4A')
ORANGE  = HexColor('#E25A1C')
INK     = HexColor('#2C1B33')
INK_SOFT = HexColor('#554260')
PAPER   = HexColor('#FBF3DD')
CREAM   = HexColor('#F8ECD0')
RULE    = HexColor('#C8B8D0')
TEAL    = HexColor('#2D7A6E')

REPO_ROOT = Path(__file__).resolve().parent.parent
LOGO_PATH = REPO_ROOT / 'public' / 'sports-collective-logo.png'
OUT_PATH  = REPO_ROOT / 'docs' / 'Sports-Collective-Pilot-Walkthrough.pdf'


def styles():
    return {
        'cover_brand':    ParagraphStyle('cover_brand', fontName='Helvetica-Bold',
                                          fontSize=42, leading=46, textColor=ORANGE,
                                          alignment=TA_CENTER),
        'cover_sub':      ParagraphStyle('cover_sub', fontName='Helvetica-Bold',
                                          fontSize=22, leading=26, textColor=PLUM,
                                          alignment=TA_CENTER),
        'cover_tagline':  ParagraphStyle('cover_tagline', fontName='Helvetica-Oblique',
                                          fontSize=14, leading=18, textColor=INK_SOFT,
                                          alignment=TA_CENTER),
        'cover_meta':     ParagraphStyle('cover_meta', fontName='Helvetica',
                                          fontSize=10, leading=12, textColor=INK_SOFT,
                                          alignment=TA_CENTER),
        'h1':             ParagraphStyle('h1', fontName='Helvetica-Bold',
                                          fontSize=20, leading=26, textColor=PLUM,
                                          spaceBefore=4, spaceAfter=8),
        'h2':             ParagraphStyle('h2', fontName='Helvetica-Bold',
                                          fontSize=14, leading=18, textColor=ORANGE,
                                          spaceBefore=10, spaceAfter=4,
                                          letterSpace=1.2),
        'eyebrow':        ParagraphStyle('eyebrow', fontName='Helvetica-Bold',
                                          fontSize=10, leading=12, textColor=ORANGE,
                                          spaceAfter=4),
        'body':           ParagraphStyle('body', fontName='Helvetica',
                                          fontSize=10.5, leading=15, textColor=INK,
                                          spaceAfter=4, alignment=TA_LEFT),
        'body_soft':      ParagraphStyle('body_soft', fontName='Helvetica',
                                          fontSize=10, leading=14, textColor=INK_SOFT,
                                          spaceAfter=3, alignment=TA_LEFT),
        'step_num':       ParagraphStyle('step_num', fontName='Helvetica-Bold',
                                          fontSize=11, leading=14, textColor=ORANGE,
                                          spaceAfter=2),
        'step_body':      ParagraphStyle('step_body', fontName='Helvetica',
                                          fontSize=10.5, leading=15, textColor=INK,
                                          leftIndent=18, spaceAfter=6),
        'callout':        ParagraphStyle('callout', fontName='Helvetica',
                                          fontSize=10, leading=14, textColor=INK,
                                          alignment=TA_LEFT),
        'footer':         ParagraphStyle('footer', fontName='Helvetica',
                                          fontSize=8.5, leading=10, textColor=INK_SOFT,
                                          alignment=TA_CENTER),
    }


# ── Page chrome ────────────────────────────────────────────────────────────

def draw_page_chrome(canv: canvas.Canvas, doc):
    # Skip chrome on the cover (page 1).
    if canv.getPageNumber() == 1:
        return

    width, height = LETTER

    # Top band
    canv.setFillColor(CREAM)
    canv.rect(0, height - 56, width, 56, stroke=0, fill=1)
    canv.setStrokeColor(PLUM)
    canv.setLineWidth(2)
    canv.line(0, height - 56, width, height - 56)

    # Logo
    if LOGO_PATH.exists():
        try:
            canv.drawImage(str(LOGO_PATH), 36, height - 50, width=36, height=36,
                           mask='auto', preserveAspectRatio=True)
        except Exception:
            pass

    # Wordmark
    canv.setFillColor(ORANGE)
    canv.setFont('Helvetica-Bold', 16)
    canv.drawString(82, height - 28, 'SPORTS')
    canv.setFillColor(PLUM)
    canv.setFont('Helvetica-Bold', 9)
    canv.drawString(82, height - 42, 'COLLECTIVE')

    # Right-side eyebrow
    canv.setFillColor(ORANGE)
    canv.setFont('Helvetica-Bold', 9)
    canv.drawRightString(width - 36, height - 30, 'PILOT  WALKTHROUGH')
    canv.setFillColor(INK_SOFT)
    canv.setFont('Helvetica', 8.5)
    canv.drawRightString(width - 36, height - 44, 'sports-collective.com')

    # Footer
    canv.setStrokeColor(RULE)
    canv.setLineWidth(0.5)
    canv.line(36, 36, width - 36, 36)
    canv.setFillColor(INK_SOFT)
    canv.setFont('Helvetica', 8.5)
    canv.drawString(36, 22, 'Built by a collector, for the collection.')
    canv.drawRightString(width - 36, 22, f'Page {canv.getPageNumber() - 1}')


def draw_cover(canv: canvas.Canvas, doc):
    """Cover page background + logo. Drawn before flow content."""
    if canv.getPageNumber() != 1:
        return
    width, height = LETTER

    # Cream wash background
    canv.setFillColor(PAPER)
    canv.rect(0, 0, width, height, stroke=0, fill=1)

    # Plum band across the top third
    canv.setFillColor(PLUM)
    canv.rect(0, height * 0.66, width, height * 0.34, stroke=0, fill=1)

    # Orange accent bar
    canv.setFillColor(ORANGE)
    canv.rect(0, height * 0.66 - 4, width, 4, stroke=0, fill=1)

    # Logo, big, centered in the plum band
    if LOGO_PATH.exists():
        try:
            logo_size = 110
            canv.drawImage(str(LOGO_PATH),
                           (width - logo_size) / 2,
                           height * 0.78,
                           width=logo_size, height=logo_size,
                           mask='auto', preserveAspectRatio=True)
        except Exception:
            pass


# ── Content helpers ────────────────────────────────────────────────────────

S = styles()


def callout_box(content_flowables, fill_hex='F8ECD0', border_hex='3D1F4A', pad=10):
    t = Table([[content_flowables]], colWidths=['*'])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HexColor('#' + fill_hex)),
        ('BOX', (0, 0), (-1, -1), 1.5, HexColor('#' + border_hex)),
        ('LEFTPADDING', (0, 0), (-1, -1), pad),
        ('RIGHTPADDING', (0, 0), (-1, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), pad),
        ('BOTTOMPADDING', (0, 0), (-1, -1), pad),
    ]))
    return t


def two_col(left_block, right_block, gap=14):
    t = Table([[left_block, '', right_block]],
              colWidths=['*', gap, '*'])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    return t


def step(num, time_hint, body_html):
    """Numbered step: bold orange '1. (60 sec)' header on its own line, body indented below."""
    head = Paragraph(f'<b>{num}. <font color="#E25A1C">({time_hint})</font></b>', S['step_num'])
    body = Paragraph(body_html, S['step_body'])
    return KeepTogether([head, body, Spacer(1, 2)])


# ── Content ────────────────────────────────────────────────────────────────

def build_story():
    story = []

    # ── Cover ──────────────────────────────────────────────────────────────
    story.append(Spacer(1, 1.0 * inch))
    story.append(Paragraph('SPORTS COLLECTIVE', S['cover_brand']))
    story.append(Spacer(1, 0.05 * inch))
    story.append(Paragraph('PILOT  WALKTHROUGH', S['cover_sub']))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph('Built by a collector, for the collection.', S['cover_tagline']))
    story.append(Spacer(1, 1.4 * inch))
    story.append(Paragraph('A 25-minute hands-on tour:<br/>'
                           'inventory → market research → marketplace → FB auction.',
                           S['cover_meta']))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph('sports-collective.com  ·  v1.0', S['cover_meta']))
    story.append(PageBreak())

    # ── Problem / Solution ─────────────────────────────────────────────────
    story.append(Paragraph('Why this exists', S['h1']))

    left = [
        Paragraph('THE PROBLEM', S['eyebrow']),
        Paragraph('Most vintage collectors are running their hobby out of '
                  'spreadsheets, screenshots, and Facebook DMs:', S['body_soft']),
        Spacer(1, 4),
        Paragraph('•&nbsp;&nbsp;Inventory in spreadsheets, screenshots, and DMs.', S['body']),
        Paragraph('•&nbsp;&nbsp;Chasing payments and tagging prior bidders by hand.', S['body']),
        Paragraph('•&nbsp;&nbsp;Searching eBay one card at a time — slow and error-prone.', S['body']),
        Paragraph('•&nbsp;&nbsp;Scrolling FB feeds, hoping a card on your want list shows up.', S['body']),
    ]
    right = [
        Paragraph('OUR SOLUTION', S['eyebrow']),
        Paragraph('One workspace for the vintage collector and small-volume FB seller:',
                  S['body_soft']),
        Spacer(1, 4),
        Paragraph('•&nbsp;&nbsp;Set tracking, bulk import, scan tools, want-list matching.', S['body']),
        Paragraph('•&nbsp;&nbsp;eBay scanning across every card you don\'t own yet.', S['body']),
        Paragraph('•&nbsp;&nbsp;FB auction & claim-sale runner with bidder history.', S['body']),
        Paragraph('•&nbsp;&nbsp;Marketplace + future matchmaking surfaces cards to the '
                  'members who actually need them.', S['body']),
    ]
    story.append(two_col(left, right))
    story.append(Spacer(1, 16))

    # Intro card
    intro = [
        Paragraph('Getting in', S['eyebrow']),
        Paragraph('Open <b>sports-collective.com</b>, sign up with email + password — '
                  'you\'ll land directly on the home feed during the pilot.', S['body']),
        Paragraph('In the production release, this will sit behind a short '
                  'application form. We\'ll only admit members with proven '
                  'collecting feedback and references.', S['body_soft']),
    ]
    story.append(callout_box(intro, fill_hex='FBF3DD', border_hex='C8B8D0', pad=12))
    story.append(PageBreak())

    # ── Walkthrough I — Inventory (10 min) ─────────────────────────────────
    story.append(Paragraph('10-minute walkthrough — your first set', S['h1']))
    story.append(Paragraph('Card inventory management — set tracking, scans, '
                           'default target, and the eBay want-list scanner.',
                           S['body_soft']))
    story.append(Spacer(1, 8))

    inv_steps = [
        ('1', '60 sec',
         '<b>Add a cover + avatar.</b> From the home feed, hover the cover area / round '
         'avatar and drop in any photos with the badges. Keeps the page from looking '
         'empty later.'),
        ('2', '5 sec',
         'Click <b>MY SHELF</b> in the top nav. Empty for now — about to change.'),
        ('3', '45 sec',
         '<b>Click + NEW UPLOAD → Select a set</b> from the dropdown. Pick a year + brand '
         'you actually collect — 1971 Topps, 1955 Bowman, whatever you\'ve got going. '
         'Click <b>Save &amp; Edit Set</b>.'),
        ('4', '2 min',
         '<b>You\'re in the set table — one row per card.</b> Top-row checkbox to select all '
         '→ in the bulk-edit bar set <b>Owned → Yes → Apply to N rows</b>. Now go through '
         'and flip 5–10 cards you don\'t own to <b>No</b> with the dropdown. Don\'t be '
         'precise yet — just enough to feel it.'),
        ('5', '~2 min',
         'Click <b>DEFAULT TARGET</b> at the top. Pick the condition you\'d actually buy — '
         'Raw, VG–EX to EX-MT works for most vintage. Click <b>Save Target</b>.'),
        ('6', '~2 min',
         '<b>Click ADD SCANS</b>, then <b>Add Scans to Set Inventory</b>. Pick the set you just '
         'created. Select one of the cards from the list, click <b>Start Scanning</b>, drop '
         '2 photos in the box (or click <b>Choose Files</b>). Click <b>Save All</b> → <b>View Set</b>. '
         'Scroll right on the table to see the images attached. Works for batches too — '
         'just keep your scans in the same order as the cards you selected.'),
        ('7', '5 sec',
         'Click the <b>SC logo</b> top-left to go home. Scroll down to <b>Your Feed</b>.'),
        ('8', '~2 min',
         '<b>Click eBay HITS → pick your set → Search eBay.</b> This pulls active eBay listings '
         'for every card you don\'t own, filtered to your target condition. Watch the matches '
         'roll in. Click any hit — opens straight to the eBay listing.'),
        ('9', '30 sec',
         'Back to your set: <b>MY SHELF</b> top-left → click your set → <b>Want List PDF</b>. '
         'Take a look at the download — that\'s the checklist you\'d carry to a card show.'),
        ('10', '90 sec',
         '<b>Explore.</b> Logo → top nav → <b>Marketplace</b>, then <b>Members</b>. If you have card '
         'scans handy, try <b>Add Scans</b> on your set.'),
    ]
    for num, t, html in inv_steps:
        story.append(step(num, t, html))

    story.append(Spacer(1, 6))
    story.append(callout_box(
        [
            Paragraph('That\'s the inventory loop.', S['eyebrow']),
            Paragraph('Hit me when you\'re done — I want to know what felt good and what '
                      'felt confusing.', S['body']),
        ],
        fill_hex='FBF3DD', border_hex='E25A1C', pad=12,
    ))
    story.append(PageBreak())

    # ── Walkthrough II — Selling (15 min) ──────────────────────────────────
    story.append(Paragraph('15-minute walkthrough — selling', S['h1']))
    story.append(Paragraph('Build a single listing, research a price, then run a '
                           'mock Facebook auction end-to-end.', S['body_soft']))
    story.append(Spacer(1, 8))

    sell_steps = [
        ('1', 'Listing', 'Click <b>My Listings</b> in the top nav → <b>+ New Listing</b> → <b>Blank Listing</b>.'),
        ('2', 'Form',
         'Fill out the card info, pick <b>Raw</b> or <b>Graded</b> with the badges, choose the '
         'condition from the dropdown.'),
        ('3', 'Price',
         '<b>Enter your asking price.</b> Click <b>Research Prices</b> to pop the comp form, '
         'or type a number directly. Add your cost (so the site can calculate your '
         'profit later) and any details about the card.'),
        ('4', 'Research',
         '<b>Research Prices</b> lets you log recent sales to benchmark your pricing. Each '
         'entry is saved per card — revisit it any time. Weight comps by how comparable '
         'they look (centering, corners, eye appeal); weights total 100%.'),
        ('5', 'Shipping',
         'Pick the shipping options you want by clicking the × next to options you\'re '
         'removing, and edit the amount you charge.'),
        ('6', 'Photos &amp; activate',
         'Click <b>Draft</b> to find your listing → <b>Edit</b> → <b>Photos</b> box → load up to 5 '
         'photos in the order you want them shown → <b>Save Changes</b>. Click <b>Activate</b> — '
         'your listing is now live on the marketplace and available to any FB tool.'),
        ('7', 'FB template',
         '<b>FB Sales</b> in the top nav → <b>Auctions</b> → <b>Templates</b> → <b>+ New</b> next to '
         '<i>Single Card Templates</i>. Edit the body for your usual auction style — leave '
         'anything in <code>{}</code> alone, those are autofilled. Click <b>Create Template</b>.'),
        ('8', 'New auction',
         '<b>Auctions</b> badge → <b>+ New Auction</b> → pick <b>Single Card</b> (turns orange) → '
         'click the listing you created (highlights, table appears). Scroll to <b>Edit Post '
         'Body</b>, tweak as needed → <b>Generate Auction</b>.'),
        ('9', 'Suggested bidders',
         '<b>Suggested Past Bidders</b> populates from your historical bidding data. Nothing '
         'to do today — but worth knowing the feature is there for later.'),
        ('10', 'Post to FB',
         'Copy the post text → pick a background color → <b>Download Side-by-Side Image</b> → '
         'paste both into your FB post → click <b>Go Live</b> here.'),
        ('11', 'Run the auction',
         '<b>Paste your live FB post URL</b> for quick access. Use this page to enter the bids '
         'you receive — the system autosaves on click-out, builds bidder history, and '
         'updates the small "N bids · M unique bidders" counter on the listing.'),
        ('12', 'Bidder data',
         'Click <b>Bidders</b> in the top nav → click any bid count → see exactly what they\'ve '
         'bid on, shipping info, contact details. Your data only — never shared with '
         'other members.'),
        ('13', 'Settle the auction',
         '<b>FB Auctions</b> → switch the listing dropdown from <b>LIVE</b> → <b>ENDED</b> '
         '(snapshot totals update). Click <b>Manage</b> → scroll to <b>Settlement / Buyer '
         'Invoices</b> → <b>Copy Messenger Invoice</b> → paste in FB Messenger.'),
        ('14', 'Mark sold',
         'When payment lands, repeat the dropdown — switch to <b>SOLD</b>. The system '
         'organizes auctions across <b>Live / Ended / Sold / Paid</b> tabs so you can keep '
         'track at a glance.'),
    ]
    for num, t, html in sell_steps:
        story.append(step(num, t, html))

    story.append(Spacer(1, 6))
    story.append(callout_box(
        [
            Paragraph('Beyond this walkthrough', S['eyebrow']),
            Paragraph('There are multi-card auctions, claim sales, and a flow built for '
                      'large set-break runs that this 15-minute tour skips. Same shape, '
                      'more cards. Ask me to show those whenever.', S['body']),
        ],
        fill_hex='FBF3DD', border_hex='C8B8D0', pad=12,
    ))
    story.append(PageBreak())

    # ── Pilot offer ────────────────────────────────────────────────────────
    story.append(Paragraph('A note on the pilot', S['h1']))
    offer = [
        Paragraph('Looking for the first 100 users.', S['eyebrow']),
        Paragraph('If you\'re reading this you\'re one of them. Here\'s the deal:', S['body']),
        Spacer(1, 6),
        Paragraph('•&nbsp;&nbsp;<b>You\'ll never pay anything to use the site for as long as it '
                  'exists.</b> No subscription, no marketplace fees, nothing — for you, '
                  'forever.', S['body']),
        Paragraph('•&nbsp;&nbsp;<b>Your data is exportable.</b> If at any point you decide to '
                  'leave, I\'ll set up a clean export so nothing gets stranded.', S['body']),
        Paragraph('•&nbsp;&nbsp;<b>I want your feedback.</b> What broke, what felt awkward, what '
                  'was actually delightful — every note shapes what ships next.', S['body']),
        Spacer(1, 10),
        Paragraph('Thanks for being here.', S['body_soft']),
    ]
    story.append(callout_box(offer, fill_hex='FBF3DD', border_hex='E25A1C', pad=14))

    return story


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT_PATH),
        pagesize=LETTER,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.95 * inch,
        bottomMargin=0.7 * inch,
        title='Sports Collective — Pilot Walkthrough',
        author='Sports Collective',
    )

    def first_page(canv, doc):
        draw_cover(canv, doc)

    def later_page(canv, doc):
        draw_page_chrome(canv, doc)

    doc.build(build_story(), onFirstPage=first_page, onLaterPages=later_page)
    print(f'Wrote {OUT_PATH}')


if __name__ == '__main__':
    main()
