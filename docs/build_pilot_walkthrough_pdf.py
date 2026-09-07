"""Generate a branded Sports Collective Pilot Walkthrough PDF.

Run: python3 docs/build_pilot_walkthrough_pdf.py
Outputs: docs/Sports-Collective-Pilot-Walkthrough.pdf

Text is preserved verbatim from the user's draft .docx. The Wingdings
F0E0 arrow characters (→) used inside Word have been restored to real
unicode arrows so they render in the PDF. The selling-section bullets
have been numbered for clarity (so the reader has obvious steps to
follow), but no wording has been edited.
"""
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT
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


# ── Page chrome ─────────────────────────────────────────────────────────────

def draw_page_chrome(canv: canvas.Canvas, doc):
    width, height = LETTER

    canv.setFillColor(CREAM)
    canv.rect(0, height - 56, width, 56, stroke=0, fill=1)
    canv.setStrokeColor(PLUM)
    canv.setLineWidth(2)
    canv.line(0, height - 56, width, height - 56)

    if LOGO_PATH.exists():
        try:
            canv.drawImage(str(LOGO_PATH), 36, height - 50, width=36, height=36,
                           mask='auto', preserveAspectRatio=True)
        except Exception:
            pass

    canv.setFillColor(ORANGE)
    canv.setFont('Helvetica-Bold', 16)
    canv.drawString(82, height - 28, 'SPORTS')
    canv.setFillColor(PLUM)
    canv.setFont('Helvetica-Bold', 9)
    canv.drawString(82, height - 42, 'COLLECTIVE')

    canv.setFillColor(ORANGE)
    canv.setFont('Helvetica-Bold', 9)
    canv.drawRightString(width - 36, height - 30, 'PILOT  WALKTHROUGH')
    canv.setFillColor(INK_SOFT)
    canv.setFont('Helvetica', 8.5)
    canv.drawRightString(width - 36, height - 44, 'sports-collective.com')

    canv.setStrokeColor(RULE)
    canv.setLineWidth(0.5)
    canv.line(36, 36, width - 36, 36)
    canv.setFillColor(INK_SOFT)
    canv.setFont('Helvetica', 8.5)
    canv.drawString(36, 22, 'Built by a collector, for the collection.')
    canv.drawRightString(width - 36, 22, f'Page {canv.getPageNumber()}')


# ── Styles ──────────────────────────────────────────────────────────────────

S = {
    'h1':         ParagraphStyle('h1', fontName='Helvetica-Bold',
                                  fontSize=18, leading=22, textColor=PLUM,
                                  spaceBefore=0, spaceAfter=8),
    'h2':         ParagraphStyle('h2', fontName='Helvetica-Bold',
                                  fontSize=13, leading=17, textColor=ORANGE,
                                  spaceBefore=8, spaceAfter=4),
    'eyebrow':    ParagraphStyle('eyebrow', fontName='Helvetica-Bold',
                                  fontSize=10, leading=12, textColor=ORANGE,
                                  spaceAfter=4),
    'body':       ParagraphStyle('body', fontName='Helvetica',
                                  fontSize=10.5, leading=14.5, textColor=INK,
                                  spaceAfter=4),
    'body_soft':  ParagraphStyle('body_soft', fontName='Helvetica',
                                  fontSize=10, leading=14, textColor=INK_SOFT,
                                  spaceAfter=3),
    'step_num':   ParagraphStyle('step_num', fontName='Helvetica-Bold',
                                  fontSize=11, leading=13, textColor=ORANGE,
                                  spaceAfter=2),
    'step_body':  ParagraphStyle('step_body', fontName='Helvetica',
                                  fontSize=10, leading=14, textColor=INK,
                                  leftIndent=18, spaceAfter=6),
}


# ── Helpers ─────────────────────────────────────────────────────────────────

def callout_box(content, fill_hex='F8ECD0', border_hex='3D1F4A', pad=10):
    t = Table([[content]], colWidths=['*'])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HexColor('#' + fill_hex)),
        ('BOX', (0, 0), (-1, -1), 1.5, HexColor('#' + border_hex)),
        ('LEFTPADDING', (0, 0), (-1, -1), pad),
        ('RIGHTPADDING', (0, 0), (-1, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), pad),
        ('BOTTOMPADDING', (0, 0), (-1, -1), pad),
    ]))
    return t


def two_col(left, right, gap=14):
    t = Table([[left, '', right]], colWidths=['*', gap, '*'])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    return t


def step(num: str, time_hint: str | None, body_html: str):
    """Numbered step: orange '#. (time)' header, body indented below."""
    if time_hint:
        head_html = f'<b>{num}. <font color="#E25A1C">({time_hint})</font></b>'
    else:
        head_html = f'<b>{num}.</b>'
    head = Paragraph(head_html, S['step_num'])
    body = Paragraph(body_html, S['step_body'])
    return KeepTogether([head, body])


# ── Verbatim content (text preserved from the user's draft) ────────────────
# Wingdings F0E0 arrows in the source have been replaced with → so they
# render correctly. Typos and casing are preserved as written ("drop done",
# "The click", "scan to the right on the table", etc.).

INVENTORY_STEPS = [
    ('1', '60 sec',
     'Add a cover + avatar. From the home feed, hover the cover area / round '
     'avatar and drop in any photos with the badges. Keeps the page from '
     'looking empty later.'),
    ('2', None,
     'Click MY SHELF in the top nav. Empty for now — about to change.'),
    ('3', '45 sec',
     'Click + NEW UPLOAD → Select a set from the dropdown. Pick a year + '
     "brand you actually collect — 1971 Topps, 1955 Bowman, whatever you've "
     'got going. Click the Save &amp; Edit Set button.'),
    ('4', '2 min',
     "You're in the set table — one row per card. Top-row checkbox to select "
     'all → in the bulk-edit bar set Owned → Yes → Apply to N rows. Now go '
     'through and flip 5–10 cards you don’t own to "No" with the drop '
     "done. Don't be precise yet; just enough to feel it."),
    ('5', '~2 min',
     "Click DEFAULT TARGET at the top. Pick the condition you'd actually buy "
     '— Raw, VG–EX to EX-MT works for most vintage. Click “Save '
     'Target”.'),
    ('6', '15 sec',
     'Click ADD SCANS. The click “Add Scans to Set Inventory”, '
     'select the set you created by clicking on it. Select one of the cards '
     'from the list, Click “Start Scanning”, drop 2 photos in the '
     'box or select “Choose Files” to pull them from your computer. '
     'Click “Save All”, Click View Set → you will see the images '
     'associated with the card if you scan to the right on the table (you '
     'may have to scroll to the bottom of the page first). This function '
     'works for batches too. You just need to have your scans in the same '
     'order as the cards you selected.'),
    ('7', '5 sec',
     'Click the SC logo top-left to go home. Scroll down to YOUR FEED.'),
    ('8', '~2 min, mostly waiting',
     "Click eBay HITS → pick your set → SEARCH EBAY. This pulls active eBay "
     "listings for every card you don't own, filtered to your target "
     'condition. Watch the matches roll in. Click a hit; opens straight to '
     'the listing.'),
    ('9', '30 sec',
     'Back to your set → MY SHELF link in upper left → Click your set → '
     'click “Want List Pdf” → take a look at your download.'),
    ('10', '90 sec — explore',
     'Go back to homepage – Click logo on upper left → Click MARKETPLACE in '
     "the top nav. Click MEMBERS. If you've got card scans handy, try ADD "
     'SCANS on your set.'),
]

INVENTORY_CLOSER = (
    "That's the inventory loop. Hit me when you're done — I want to know "
    "what felt good and what felt confusing."
)

PILOT_FYI = (
    'Also, an FYI – I am looking for 100 users to get this started. You '
    'will never pay anything to use the site for as long as it exists. '
    "I will also setup exports for your data so you won’t lose any "
    'of your information.'
)

SELLING_STEPS = [
    ('1', None,
     'Click the My Listings link in the top navigation bar → Click the '
     'Orange +New Listing Badge at the top of the page – Select “ '
     'Blank Listing”'),
    ('2', None,
     'Fill out the form – Card information, Select Raw or Graded with the '
     'badges → select condition with the drop down.'),
    ('3', None,
     'Enter asking price – you can pop open a research form by clicking '
     '“research prices” or just enter a price. Enter your cost '
     '(so the site can calculate your profit). Add any details to the '
     'card.'),
    ('4', None,
     'Research prices enable you to enter recent sales to benchmark your '
     'pricing. The system will save your work so you can update when '
     'necessary.'),
    ('5', None,
     'Select the shipping option you want by clicking the x next to the '
     'one you want to remove and change the amount you want to charge.'),
    ('6', None,
     'Click the Draft badge to see your listing → click Edit for the '
     'listing you created → Click the “Photos” box → Load up to '
     '5 photos (one at a time) in the order you want them to show on your '
     'listing → Click Save Changes when done. → Click the '
     '“Activate” Button next to your listing. Your listing is '
     'now live on the marketplace and can be imported into your Facebook '
     'Tools.'),
    ('7', None,
     'Click FB Sales Badge in top Nav Bar → Click Auction → Click '
     'Templates in the top nav bar → Click +New badge next to Single Card '
     'Templates → Edit the auction information in the bottom text field '
     "for the type of auction you run (don’t touch anything in top "
     'box surrounding in {} these autofill) → Click Create Template'),
    ('8', None,
     'Click Auctions badge at the top → Click +New Auction either in the '
     'body of the page or in top Nav bar → select Single Card (it will '
     'turn orange) → Click the listing you created - it will become '
     'highlighted &amp; a table will appear below it → scroll down to '
     '“Edit Post Body” &amp; make appropriate edits → click '
     'Generate Auction.'),
    ('9', None,
     'Suggested Past Bidders – when you add historical bidding and '
     'buying information it will populate an area with bidders and '
     'buyers that have been interested in cards like the one you posted. '
     'Nothing to do now but this is a nice feature that I always '
     'struggled with.'),
    ('10', None,
     'Copy the text to past to FB post → Select a background color for '
     'your images and Download the Side – By – Side Image for your post '
     "→ Update your FB Post with this image that’s in your downloads "
     'and click “Go Live”'),
    ('11', None,
     'You will see your live auction here – paste in the URL so you have '
     'a quick link to manage the auction. Use this page to enter the bids '
     'you get. The system will autosave each bid so you have a bidding '
     'history → enter a few bids and bidders to test it out (click '
     'outside the box to have the system auto save → the # of bids and '
     '# of unique bidders will be added to the listing in small text '
     'under the small description.'),
    ('12', None,
     'Now Click the “Bidders” badge at the top → you will see '
     "the bids you entered with the person’s name and a bid count → "
     'click the number in the bids column → this shows you details about '
     'the bidder → what they bid on → shipping information, contact '
     'information, etc. The site will enable you to enter historical '
     'information if you decide to use it, but you get the idea of how it '
     'manages your bidder data – this data is not shared with anyone else '
     'on the site!!'),
    ('13', None,
     'Click FB Auctions badge again in the top nav bar → On your listing '
     'use the drop down selector that is marked LIVE and move it to '
     '“Ended” this ends your auction (totals are updated in '
     'Snapshot bar → Click Manage on the listing → scroll down to '
     '“Settlement – Buyer Invoices → Click the Copy Messenger '
     'Invoice → Paste in Messenger in FB'),
    ('14', None,
     'When the item is paid for you go through the same process except '
     'you click “Sold”'),
    ('15', None,
     'The system organizes all your auctions by these categories to help '
     'you keep track of everything.'),
]

SELLING_CLOSER = (
    "There’s a way to do multi card auctions as well and claim "
    "sales but you get the idea of the flow with this example. There’s "
    'also a really good way to do large auction and claim sales for set '
    'breaks. This just gives you a basic example of functionality.'
)


# ── Story ───────────────────────────────────────────────────────────────────

def build_story():
    story = []

    # ── Page 1: Why this exists ────────────────────────────────────────────
    story.append(Paragraph('Why this exists', S['h1']))

    left = [
        Paragraph('THE PROBLEM', S['eyebrow']),
        Paragraph('I was managing my card inventory in spreadsheets, '
                  'screenshots, and Facebook DMs.', S['body']),
        Paragraph('I was always chasing payments and tagging prior bidders '
                  'by hand.', S['body']),
        Paragraph('I am searching Ebay for each card I need for my sets '
                  'individually – it’s time consuming!!', S['body']),
        Paragraph('I am scrolling through feeds hoping to spot a card on my '
                  'want list. I forget to bid on the cards I am interested '
                  'in.', S['body']),
    ]
    right = [
        Paragraph('OUR SOLUTION', S['eyebrow']),
        Paragraph('One workspace for the vintage collector and small-volume '
                  'FB seller.', S['body']),
        Paragraph('Set tracking, bulk import, scan tools, want-list '
                  'matching, eBay scanning.', S['body']),
        Paragraph('FB-auction and claim-sale runner with bidder history – '
                  'bidding and payment management', S['body']),
        Paragraph('If the site gets scale our marketplace &amp; Facebook '
                  'auctions surfaces listings to the exact members who need '
                  'them — algorithmically aligned with their want list.',
                  S['body']),
    ]
    story.append(two_col(left, right))
    story.append(Spacer(1, 14))

    intro = [
        Paragraph('Site Introduction &amp; Building a Set', S['eyebrow']),
        Paragraph('Login to the site at <font color="#E25A1C">'
                  '<u>http://www.sports-collective.com</u></font>',
                  S['body']),
        Paragraph('Fill out your e-mail and pick a password', S['body']),
        Paragraph('When I set this up for real it will have an application '
                  'form. I intend to only allow members that have proven '
                  'feedback and references.', S['body_soft']),
    ]
    story.append(callout_box(intro, fill_hex='FBF3DD', border_hex='C8B8D0', pad=12))
    story.append(PageBreak())

    # ── Page 2: 10-min walkthrough ─────────────────────────────────────────
    story.append(Paragraph(
        '10-min intro – Card Inventory Management — '
        'building your first set', S['h1']))

    for num, t, body in INVENTORY_STEPS:
        story.append(step(num, t, body))

    story.append(Spacer(1, 4))
    story.append(callout_box(
        [Paragraph(INVENTORY_CLOSER, S['body'])],
        fill_hex='FBF3DD', border_hex='E25A1C', pad=10,
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(PILOT_FYI, S['body_soft']))
    story.append(PageBreak())

    # ── Page 3+: 15-min selling walkthrough ───────────────────────────────
    story.append(Paragraph(
        '15 Minute Selling Walkthrough – Create a mock auction and '
        'Marketplace Listing', S['h1']))

    for num, t, body in SELLING_STEPS:
        story.append(step(num, t, body))

    story.append(Spacer(1, 4))
    story.append(callout_box(
        [Paragraph(SELLING_CLOSER, S['body'])],
        fill_hex='FBF3DD', border_hex='C8B8D0', pad=10,
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(PILOT_FYI, S['body_soft']))

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
    doc.build(
        build_story(),
        onFirstPage=draw_page_chrome,
        onLaterPages=draw_page_chrome,
    )
    print(f'Wrote {OUT_PATH}')


if __name__ == '__main__':
    main()
