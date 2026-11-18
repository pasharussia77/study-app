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
        try: pg.get_by_text('Read 1 page').wait_for(timeout=8000)
        except Exception: print('PAGE TEXT:', text()[-600:]); print('ERRORS:', errors); raise
        ok('Check the page text' in text(), 'a typed page waits for the student to check it')
        ok(not btn('Make questions').is_enabled() if pg.get_by_test_id('make-questions').count() else True, 'questions cannot be made before a page is checked')
        shot('2-pages')

        # D. The editor: layout, chunks, edit, select, lock, zoom
        btn('Open page 1').click()
        pg.get_by_test_id('page-copy').wait_for()
        ok(pg.get_by_test_id('piece').count() == 5, 'five pieces on the typed copy')
        ok(pg.get_by_test_id('chunk').count() == 3, 'three chunks (big gaps start a new one)')
        ok(pg.get_by_role('button', name='Only this').count() == 0, '"Only this" is gone')
        xs = pg.evaluate("() => [...document.querySelectorAll('[data-testid=piece]')].map(e => e.style.left + '|' + e.style.top)")
        ok(xs[0] == '10%|5%' and xs[4] == '40%|70%', 'pieces sit where the page had them')
        fits = pg.evaluate("() => [...document.querySelectorAll('[data-testid=piece]')].every(e => { const p = e.closest('.rd-page').getBoundingClientRect(), r = e.getBoundingClientRect(); return r.right <= p.right + 1; })")
        ok(fits, 'no text runs off the right edge')
        pg.get_by_test_id('piece').nth(1).click()
        pg.get_by_label('Words of the selected piece').fill('- alliances (treaties)')
        btn('Done').click()
        ok('alliances (treaties)' in pg.get_by_test_id('page-copy').inner_text(), 'a piece can be fixed in place')
        pg.get_by_label('Use part 3').uncheck()
        ok(pg.locator('.rd-piece.off').count() == 1, 'an unselected part is greyed out on the page')
        pg.get_by_label('Show part 1 on the page').click()
        ok(pg.locator('.rd-hl').count() == 1, 'tapping a part highlights it on the page')
        # locked by default: dragging a selected piece does not move it
        ok(pg.locator('.rd-hint').count() == 1, 'a short how-to shows over the page at first')
        ok(pg.get_by_role('button', name='Zoom in').count() == 0 and pg.get_by_role('button', name='Zoom out').count() == 0, 'no - / + buttons')
        ok('Pieces locked' in pg.get_by_test_id('lock').get_attribute('aria-label'), 'pieces are locked by default')
        ok(pg.get_by_role('button', name='Add missing text').count() == 0, 'adding text is hidden while locked')
        vb0 = pg.get_by_test_id('viewport').bounding_box()
        ok(vb0['width'] >= 383, 'the page goes edge to edge (' + str(vb0['width']) + ')')
        def drag_piece(i, dy):
            pg.get_by_test_id('piece').nth(i).click()
            box = pg.get_by_test_id('piece').nth(i).bounding_box()
            pg.mouse.move(box['x'] + 5, box['y'] + 5); pg.mouse.down(); pg.mouse.move(box['x'] + 5, box['y'] + dy, steps=6); pg.mouse.up()
            return float(pg.evaluate(f"() => document.querySelectorAll('[data-testid=piece]')[{i}].style.top")[:-1])
        ok(drag_piece(4, -40) == 70, 'a locked piece does not move')
        pg.get_by_test_id('lock').click()
        ok(drag_piece(4, -40) < 70, 'after unlocking, a selected piece can be dragged')
        pg.get_by_test_id('lock').click()
        btn('Done').click()
        # zoom with buttons, then move around by dragging, then pinch
        vb = pg.get_by_test_id('viewport').bounding_box()
        pg.mouse.dblclick(vb['x'] + vb['width'] * 0.8, vb['y'] + vb['height'] * 0.9)
        pg.wait_for_timeout(150)
        ok(pg.get_by_test_id('zoom').inner_text() == '250%', 'double-tap zooms in (' + pg.get_by_test_id('zoom').inner_text() + ')')
        tr0 = pg.get_by_test_id('page-copy').evaluate('e => e.style.transform')
        vb = pg.get_by_test_id('viewport').bounding_box()
        pg.mouse.move(vb['x'] + vb['width'] - 20, vb['y'] + vb['height'] - 20); pg.mouse.down(); pg.mouse.move(vb['x'] + 40, vb['y'] + 40, steps=8); pg.mouse.up()
        tr1 = pg.get_by_test_id('page-copy').evaluate('e => e.style.transform')
        ok(tr0 != tr1, 'dragging moves around the zoomed page (' + tr1 + ')')
        ok(pg.locator('.rd-hint').count() == 0, 'the how-to goes away after the first move')
        pg.get_by_label('Fade between the original and the page text').fill('50')
        shot('3-editor-zoomed')
        pg.get_by_label('Fade between the original and the page text').fill('100')
        btn('Fit').click()
        pg.evaluate("""() => { const v = document.querySelector('[data-testid=viewport]'); const r = v.getBoundingClientRect();
          const ev = (type, id, x, y) => v.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 11 }));
          ev('pointerdown', 11, 150, 150); ev('pointerdown', 12, 190, 150);
          for (let i = 1; i <= 5; i++) { ev('pointermove', 11, 150 - i * 20, 150); ev('pointermove', 12, 190 + i * 20, 150); }
          ev('pointerup', 11, 50, 150); ev('pointerup', 12, 290, 150); }""")
        pg.wait_for_timeout(200); z = int(pg.get_by_test_id('zoom').inner_text()[:-1])
        ok(z > 300, 'pinching zooms in (' + str(z) + '%)')
        btn('Fit').click()
        shot('3-editor')
        pg.get_by_test_id('read-again').scroll_into_view_if_needed(); shot('3b-keep'); pg.evaluate('() => window.scrollTo(0, 0)')
        vb = pg.get_by_test_id('viewport').bounding_box()
        pg.mouse.dblclick(vb['x'] + vb['width'] * 0.8, vb['y'] + vb['height'] * 0.9); pg.wait_for_timeout(150)
        pg.mouse.dblclick(vb['x'] + vb['width'] * 0.8, vb['y'] + vb['height'] * 0.9); pg.wait_for_timeout(150)
        ok(pg.get_by_test_id('zoom').inner_text() == '100%', 'double-tap again goes back to fit')
        pg.get_by_test_id('full').click()
        ok(pg.locator('.rd-stage.full').count() == 1 and pg.get_by_test_id('viewport').bounding_box()['height'] > 700, 'full screen gives the page the whole phone')
        shot('3d-full')
        pg.go_back(); pg.wait_for_timeout(200)
        ok(pg.locator('.rd-stage.full').count() == 0 and pg.get_by_test_id('page-copy').count() == 1, 'Back closes full screen and stays on the page')
        pg.get_by_test_id('lock').click()
        btn('Add missing text').click()
        pg.get_by_label('Words of the selected piece').fill('extra note'); btn('Done').click()
        pg.get_by_test_id('lock').click()
        ok(pg.get_by_test_id('piece').count() == 6, 'missing text can be added')
        ok(pg.get_by_label('Other number of questions').count() == 0, 'no question count on the page any more')
        pg.get_by_test_id('confirm-page').click()
        pg.get_by_text('Approved · find blocks next').wait_for()

        # E. Find the information blocks
        pg.evaluate('(d) => { window.__mockAI = [d]; }', BLOCKS)
        pg.get_by_test_id('find-blocks').click()
        pg.get_by_text('6 information blocks found.').wait_for()
        ok(pg.evaluate('() => window.__allMessages.length') == 2, 'one AI call to type up, one to find the blocks')
        last = pg.evaluate('() => JSON.stringify(window.__lastMessages)')
        ok('extra note' in last and 'war starts' not in last, 'only selected parts go to the AI (and edits are included)')
        ok('[1914' in last and '_Causes of WWI_' in last, 'marks are passed on (box and underline)')
        card = pg.get_by_test_id('blocks-card').inner_text()
        ok('6 information blocks found' in card and '6 selected' in card, 'the count of blocks is shown: ' + card[:60])
        ok(pg.get_by_test_id('make-questions').inner_text().strip().endswith('Make 6 questions'), 'one question per block by default')
        shot('4-blocks-found')

        # F. Review the blocks: unselect one
        pg.get_by_test_id('review-blocks').click()
        ok(pg.get_by_test_id('block').count() == 6, 'all blocks are listed')
        pg.get_by_test_id('block').nth(0).get_by_role('checkbox').uncheck()
        pg.get_by_text('5 selected · 5 questions').wait_for()
        ok(True, 'unselecting a block lowers the count of questions')
        shot('5-blocks')
        btn('Done').click()

        # G. Questions per fact
        btn('2', True).click()
        n2 = int(pg.get_by_test_id('make-questions').inner_text().split('Make ')[1].split(' ')[0])
        ok(5 < n2 <= 10, 'two per fact adds questions (' + str(n2) + ')')
        btn('1', True).click()
        pg.get_by_test_id('make-questions').click()
        pg.get_by_text('Made 5 questions from 5 information blocks').wait_for()
        ok(pg.evaluate('() => window.__allMessages.length') == 3, 'making questions makes exactly one AI check call')
        ok(pg.evaluate("() => JSON.stringify(window.__lastMessages).includes('CHECK THESE QUESTIONS')"), 'that call is the question check')
        ok(pg.get_by_test_id('make-questions').inner_text().strip() == 'Remake', 'when up to date the middle button says Remake')
        ok('5 questions · Detail: normal' in pg.get_by_test_id('q-line').inner_text(), 'one short line shows the count and detail level')
        ok(pg.get_by_test_id('less').is_visible() and pg.get_by_test_id('more').is_visible(), 'Less and More sit beside Remake')
        ok('· 5' in pg.get_by_test_id('review-tile').inner_text() and pg.get_by_role('button', name='Review questions (5)').count() == 0, 'one Review questions tile with the count, no second button')
        pg.get_by_test_id('make-questions').scroll_into_view_if_needed(); shot('6b-card')
        pg.get_by_test_id('review-tile').scroll_into_view_if_needed(); shot('6c-tile')
        ok('5 of 6 blocks selected · 5 questions' in text(), 'page shows its blocks and questions')
        shot('6-made')

        # H. Review screen
        btn('Review questions').click()
        pg.get_by_text('Study items').first.wait_for()
        ok(pg.get_by_test_id('item').count() == 5, 'review lists the questions')
        ok(pg.get_by_test_id('item-src').count() == 5, 'each question shows where on the page it came from')
        srcs = pg.get_by_test_id('item-src').all_inner_texts()
        ok(len(set(srcs)) == 5, 'no fact is asked twice')
        ok(pg.get_by_test_id('reapply').count() == 0, 'the photo re-apply button is not shown for reading questions')
        shot('7-review')
        pg.go_back()

        # Testing tools
        pg.get_by_text('Testing tools').wait_for()
        ok(btn('Run the speech test').count() == 1, 'speech test is in reading projects too')
        btn('Create diagnostic report').click()
        rep = pg.get_by_test_id('report').input_value()
        ok('READING PROJECT' in rep and 'blocks: 6 found, 5 selected' in rep and 'extra note' in rep, 'the report includes the reading part')
        shot('8-report')
        pg.get_by_role('dialog', name='Diagnostic report').get_by_role('button', name='Close').click()

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
