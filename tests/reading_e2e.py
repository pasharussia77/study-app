# Browser test of Reading projects (Test account only), in the app's mock mode.
# Run after `npm run build`:  python3 tests/reading_e2e.py [screenshot_dir]
import base64, subprocess, sys, time, urllib.request, os
from playwright.sync_api import sync_playwright

PORT = 4174
URL = f'http://localhost:{PORT}/?mock=1'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP8z4APMOGVHbHSAEEsAROxCnMTAAAAAElFTkSuQmCC')
fails = 0
def ok(c, name):
    global fails
    if not c: fails += 1; print('FAIL:', name)

TRANSCRIPT = {'kind': 'handwritten', 'lines': [
    {'text': 'Causes of WWI', 'x': 0.1, 'y': 0.05, 'w': 0.4, 'h': 0.03, 'marks': ['underline']},
    {'text': '- alliances', 'x': 0.15, 'y': 0.09, 'w': 0.25, 'h': 0.03},
    {'text': '- militarism', 'x': 0.15, 'y': 0.125, 'w': 0.25, 'h': 0.03},
    {'text': '1914 - Franz Ferdinand shot', 'x': 0.1, 'y': 0.4, 'w': 0.7, 'h': 0.03, 'marks': ['box']},
    {'text': 'war starts', 'x': 0.4, 'y': 0.7, 'w': 0.2, 'h': 0.03}], 'figures': []}
def blk(t, src, subj, q, v='', items=None, ordered=False, imp=False):
    return {'type': t, 'source': src, 'subject': subj, 'question': q, 'value': v, 'items': items or [], 'ordered': ordered, 'important': imp}
BLOCKS = {'blocks': [
    blk('date', 'The Treaty of Paris was signed in 1783.', 'Treaty of Paris', 'When was the Treaty of Paris signed?', '1783'),
    blk('date', 'The Declaration was adopted in 1776.', 'Declaration', 'When was the Declaration adopted?', '1776', imp=True),
    blk('date', 'The Constitution was written in 1787.', 'Constitution', 'When was the Constitution written?', '1787'),
    blk('date', 'The war began in 1775.', 'Revolutionary War', 'When did the war begin?', '1775'),
    blk('definition', 'A treaty is a formal agreement between countries.', 'treaty', 'What is a treaty?', 'a formal agreement between countries'),
    blk('list', 'Causes: alliances, militarism, imperialism, nationalism', 'Causes of WWI', 'What were the causes of WWI?', items=['alliances', 'militarism', 'imperialism', 'nationalism'])]}

server = subprocess.Popen(['npx', 'vite', 'preview', '--port', str(PORT), '--strictPort'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try: urllib.request.urlopen(URL); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 384, 'height': 854})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        btn = lambda name, exact=False: pg.get_by_role('button', name=name, exact=exact).first
        text = lambda: pg.inner_text('body')
        def shot(name):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{name}.png')

        pg.goto(URL)
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()

        # A. The children's accounts are unchanged: no choice of project type.
        btn('Anna').click(); btn('New project').click()
        ok('What kind of study material' not in text(), 'other accounts do not see the project type choice')
        ok(pg.get_by_label('Project name').count() == 1, 'other accounts go straight to naming the project')
        btn('Cancel').click()
        pg.go_back() if False else None
        btn('Family').click()

        # B. Test account
        btn('Family settings').click(); btn('Add a testing account').click()
        pg.go_back(); pg.wait_for_timeout(300)
        btn('Test').click()
        for d in '1308': btn(d, True).click()
        btn('New project').click()
        pg.get_by_test_id('type-choice').wait_for()
        t = pg.get_by_test_id('type-choice').inner_text()
        ok('Questions' in t and 'Reading' in t, 'the Test account is asked: Questions or Reading')
        ok(all(w in t for w in ['Worksheets', 'Quizzes', 'Matching', 'Word list', 'Term and definition lists']), 'Questions lists its examples')
        ok(all(w in t for w in ['Textbook pages', 'Class notes', 'Articles', 'Pasted text']), 'Reading lists its examples')
        shot('1-choose-type')
        pg.get_by_test_id('type-reading').click()
        pg.get_by_label('Reading project name').fill('History notes'); btn('Create project').click()
        pg.get_by_text('No pages yet.').wait_for()
        ok(pg.get_by_label('Other number of questions').count() == 0, 'no project-wide count on the project screen')

        # C. Add a photo: it is typed up
        pg.evaluate('(d) => { window.__mockAI = [d]; }', TRANSCRIPT)
        pg.set_input_files('[data-testid=in-photos]', {'name': 'page.png', 'mimeType': 'image/png', 'buffer': PNG})
        try: pg.get_by_text('Typed up 1 page').wait_for(timeout=8000)
        except Exception: print('PAGE TEXT:', text()[-600:]); print('ERRORS:', errors); raise
        ok('Check the typed copy' in text(), 'a typed page waits for the student to check it')
        ok(not btn('Make questions').is_enabled() if pg.get_by_test_id('make-questions').count() else True, 'questions cannot be made before a page is checked')
        shot('2-pages')

        # D. The editor: layout, chunks, edit, tick
        btn('Open page 1').click()
        pg.get_by_test_id('page-copy').wait_for()
        ok(pg.get_by_test_id('piece').count() == 5, 'five pieces on the typed copy')
        ok(pg.get_by_test_id('chunk').count() == 3, 'three chunks (big gaps start a new one)')
        xs = pg.evaluate("() => [...document.querySelectorAll('[data-testid=piece]')].map(e => e.style.left + '|' + e.style.top)")
        ok(xs[0] == '10%|5%' and xs[4] == '40%|70%', 'pieces sit where the page had them')
        pg.get_by_test_id('piece').nth(1).click()
        pg.get_by_label('Words of the selected piece').fill('- alliances (treaties)')
        btn('Done').click()
        ok('alliances (treaties)' in pg.get_by_test_id('page-copy').inner_text(), 'a piece can be fixed in place')
        pg.get_by_label('Use part 3').uncheck()
        ok(pg.locator('.rd-piece.off').count() == 1, 'an unticked part is greyed out on the page')
        pg.get_by_label('Show part 1 on the page').click()
        ok(pg.locator('.rd-hl').count() == 1, 'tapping a part highlights it on the page')
        # moving: select, then drag
        pg.get_by_test_id('piece').nth(4).click()
        box = pg.get_by_test_id('piece').nth(4).bounding_box()
        pg.mouse.move(box['x'] + 5, box['y'] + 5); pg.mouse.down(); pg.mouse.move(box['x'] + 5, box['y'] - 40, steps=5); pg.mouse.up()
        ys = pg.evaluate("() => document.querySelectorAll('[data-testid=piece]')[4].style.top")
        ok(float(ys[:-1]) < 70, 'a selected piece can be dragged (top ' + ys + ')')
        btn('Done').click()
        shot('3-editor')
        pg.get_by_label('Fade between the original and the typed copy').fill('50')
        shot('3b-fade')
        pg.get_by_label('Fade between the original and the typed copy').fill('100')
        btn('Add missing text').click()
        pg.get_by_label('Words of the selected piece').fill('extra note'); btn('Done').click()
        ok(pg.get_by_test_id('piece').count() == 6, 'missing text can be added')
        # E. Count for this page: a suggestion, a choice, a typed number
        ok(pg.locator('.rd-chip.on').inner_text() == '5' and 'Suggested for how much this page has: 5' in text(), 'a short page suggests 5')
        btn('10', True).click()
        ok(pg.locator('.rd-chip.on').inner_text() == '10', 'the count choice 10 works')
        pg.get_by_label('Other number of questions').fill('7'); pg.keyboard.press('Enter')
        pg.wait_for_timeout(200)
        ok('Up to 7 questions.' in text(), 'a typed number like 7 works')
        shot('3c-count')
        pg.get_by_test_id('confirm-page').click()
        pg.get_by_text('Ready · up to 7 questions').wait_for()

        # F. Make the questions
        pg.evaluate('(d) => { window.__mockAI = [d]; }', BLOCKS)
        pg.get_by_test_id('make-questions').click()
        pg.get_by_text('Made 7 questions from 1 page').wait_for()
        ok(pg.evaluate('() => window.__allMessages.length') == 2, 'one AI call to type up, one to find the information')
        last = pg.evaluate('() => JSON.stringify(window.__lastMessages)')
        ok('extra note' in last and 'war starts' not in last, 'only ticked parts go to the AI (and edits are included)')
        ok('[1914' in last and '_Causes of WWI_' in last, 'marks are passed on (box and underline)')
        ok('29 questions' not in text() and pg.get_by_text('Flashcards').count() >= 1, 'study modes appear')
        ok('7 questions (up to 7)' in text(), 'page shows its questions and its count')
        shot('4-made')

        # G. Count change rebuilds without another AI call
        btn('Open page 1').click()
        btn('5', True).click()
        pg.get_by_test_id('confirm-page').click()
        pg.get_by_text('Make questions again').wait_for()
        n_before = pg.evaluate('() => window.__allMessages.length')
        btn('Make the questions again').click()
        pg.get_by_text('Made 5 questions from 1 page').wait_for()
        ok(pg.evaluate('() => window.__allMessages.length') == n_before, 'a smaller count reuses the information already found (no new AI call)')

        # H. Review screen
        btn('Review questions').click()
        pg.get_by_text('Study items').first.wait_for()
        ok(pg.get_by_test_id('item').count() == 5, 'review lists the questions')
        ok(pg.get_by_test_id('item-src').count() == 5, 'each question shows where on the page it came from')
        ok('Page 1' in text(), 'review groups by page')
        ok(pg.get_by_test_id('reapply').count() == 0, 'the photo re-apply button is not shown for reading questions')
        shot('5-review')
        pg.go_back()

        # I. Study works with these cards
        btn('Flashcards').click()
        pg.wait_for_timeout(400)
        ok('Something went wrong' not in text(), 'flashcards open')
        shot('6-flashcards')
        ok(not errors, 'no page errors: ' + '; '.join(errors[:2]))
        b.close()
finally:
    server.terminate()
print('reading e2e:', 'all passed' if not fails else f'{fails} failed')
sys.exit(1 if fails else 0)
