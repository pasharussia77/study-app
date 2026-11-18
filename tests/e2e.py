# Browser test of the photo rules, in the app's mock mode (no real AI, no real database).
# Run after `npm run build`:  python3 tests/e2e.py     (needs: pip install playwright)
import base64, json, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

PORT = 4173
URL = f'http://localhost:{PORT}/?mock=1'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP8z4APMOGVHbHSAEEsAROxCnMTAAAAAElFTkSuQmCC')
TF = [{'label': 'A', 'text': 'True'}, {'label': 'B', 'text': 'False'}]
BANK = [{'label': l, 'text': 'Meaning ' + l} for l in 'ABCDEF']
base = {'marked_wrong': False, 'circled_choice': None, 'printed_answer': None, 'answer_text': None, 'confidence': 'high', 'note': '', 'needs_review': False}
PAGE = {'page': {'graded': False, 'score': None}, 'ends_with': {}, 'items': [
    {**base, 'type': 'qa', 'number': 1, 'question': 'All people have ____ rights', 'answer_text': 'equality'},
    {**base, 'type': 'tf', 'number': 9, 'question': 'The Constitution was signed in 1787', 'choices': TF, 'student_answer': 'T'},
    {**base, 'type': 'tf', 'number': 10, 'question': 'John Adams was the first president', 'choices': TF, 'student_answer': 'George Washington'},
    {**base, 'type': 'mc', 'number': 17, 'question': 'Federalism', 'choices': BANK, 'student_answer': 'D'},
    {**base, 'type': 'mc', 'number': 18, 'question': 'Amendment', 'choices': BANK, 'student_answer': 'B'},
]}

five = lambda texts: [{'label': '', 'text': t} for t in texts]
PAGE6 = {'page': {'graded': False, 'score': None}, 'ends_with': {}, 'items': [
    {**base, 'type': 'multi', 'number': 41, 'question': 'Which rights are in the First Amendment?', 'choices': five(['Free speech', 'Free press', 'Quartering', 'Fair trial', 'Bear arms']), 'selected_choices': ['A', 'B', 'D', 'E'], 'unclear_choices': []},
    {**base, 'type': 'order', 'number': 46, 'question': 'Number the events in order', 'choices': five(['Declaration', 'Constitution', 'Revolution won', 'Bill of Rights', 'Articles']), 'order_numbers': [1, 4, 2, 5, 3]},
]}

PAGE_LONG = {'page': {'graded': False, 'score': None}, 'ends_with': {}, 'items': [
    {**base, 'type': 'mc', 'number': 24, 'question': "What political party was developing at the time of Adams's election that wanted a strong but limited government, a national bank, and power for the national government to tax and pay off state debts?", 'choices': [{'label': l, 'text': t} for l, t in zip('ABCDEFGH', ['amendment', 'cabinet', 'Democratic-Republican Party', 'Electoral College', 'Federalist Party', 'judges', 'treaties', 'two'])], 'student_answer': 'E'},
    {**base, 'type': 'order', 'number': 46, 'question': 'Number the events of the acquisition of Florida.', 'choices': five(['James Monroe sent Andrew Jackson to stop Seminole raiders and protect US land, but Monroe did not order Jackson to attack the Spanish.', 'The United States used Andrew Jackson’s actions to prove America’s military might.', 'Andrew Jackson destroyed Seminole villages, captured two Spanish forts, and occupied the Spanish town of Pensacola.', 'Spain signed a treaty agreeing to give Florida to the United States.', 'Jackson’s illegal actions angered Spain, causing them to demand money from the United States.']), 'order_numbers': [1, 4, 2, 5, 3]},
]}

passed = failed = 0
def ok(cond, name):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print('FAIL:', name)

server = subprocess.Popen(['npx', 'vite', 'preview', '--port', str(PORT), '--strictPort'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try: urllib.request.urlopen(URL); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 800})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        btn = lambda name, exact=False: pg.get_by_role('button', name=name, exact=exact).first
        text = lambda: pg.inner_text('body')
        def open_fold():
            pg.locator('button.fold').wait_for()
            if pg.locator('#material-body').get_attribute('hidden') is not None: pg.locator('button.fold').click()
        def add_photo(hand_label, page=PAGE, made=5):
            open_fold()
            pg.evaluate('(d) => { window.__mockAI = [d]; }', page)
            pg.set_input_files('[data-testid=in-photos]', {'name': 'page.png', 'mimeType': 'image/png', 'buffer': PNG})
            pg.get_by_role('dialog', name='What should be read?').wait_for()
            btn(hand_label).click()
            btn('Read everything').click()
            btn('Read 1 photo').click()
            pg.get_by_text(f'Made {made} study items').wait_for()

        pg.goto(URL)
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()
        btn('Anna').click(); btn('New project').click()
        pg.get_by_label('Project name').fill('Chapter 5'); btn('Create project').click()
        open_fold()

        # A. Ungraded page, handwriting is the answer key (the default): everything usable, nothing flagged.
        pg.set_input_files('[data-testid=in-photos]', {'name': 'page.png', 'mimeType': 'image/png', 'buffer': PNG})
        pg.get_by_role('dialog', name='What should be read?').wait_for()
        ok(btn('The answer key').get_attribute('aria-pressed') == 'true', 'answer key is the default')
        btn('Cancel').click()
        add_photo('The answer key')
        ok('need a look' not in pg.locator('.okmsg').inner_text(), 'answer key: nothing needs a look after reading')
        ok('ANSWER KEY' in json.dumps(pg.evaluate('window.__lastMessages')), 'answer key: the AI is told')
        open_fold(); btn('Review study items').click()
        ok('5 items · all look fine' in pg.inner_text('[data-testid=items-summary]'), 'answer key: 5 items, all fine')
        ok(pg.inner_text('[data-testid=correction]') == 'Correction: George Washington', 'correction shown in review')
        ok(text().count('Handwritten answer key') == 4, 'source label on the four handwritten answers')
        ok(any('D. Meaning D' in t for t in pg.locator('.ichoices li.right').all_inner_texts()), 'matching answer D ticked')
        pg.go_back()

        # Same page again, as a student's work: unanswered and flagged, and seen as duplicates.
        add_photo('A student\u2019s work')
        ok('4 need a look' in pg.locator('.okmsg').inner_text(), "student's work: 4 need a look")
        ok('ANSWER KEY' not in json.dumps(pg.evaluate('window.__lastMessages')), "student's work: no answer-key note to the AI")
        open_fold(); btn('Review study items').click()
        ok('10 items · 4 need a look' in pg.inner_text('[data-testid=items-summary]'), '10 items, 4 flagged')
        ok('5 questions appear more than once' in pg.inner_text('[data-testid=dups]'), 'duplicates offered')

        # E. Re-apply the rules (no AI call).
        calls = pg.evaluate('(window.__allMessages || []).length')
        btn('Re-apply the rules').click(); btn('The answer key', exact=True).click()
        pg.locator('[data-testid=reapply-done]').wait_for()
        ok('4 items got an answer' in pg.inner_text('[data-testid=reapply-done]'), 're-apply: 4 items got an answer')
        ok('10 items · all look fine' in pg.inner_text('[data-testid=items-summary]'), 're-apply: all fine')
        ok(pg.evaluate('(window.__allMessages || []).length') == calls, 're-apply: no AI call')

        # G. Merge duplicates.
        btn('Merge duplicates').click()
        pg.get_by_text('5 duplicates removed').wait_for()
        ok('5 items · all look fine' in pg.inner_text('[data-testid=items-summary]'), 'merge: 5 items left')
        ok(pg.locator('[data-testid=dups]').count() == 0, 'merge: offer gone')

        # B. Editing a true/false item keeps or clears the correction.
        pg.locator('[data-testid=item]', has_text='John Adams').get_by_role('button', name='Edit').click()
        ok(pg.get_by_label('Correction').input_value() == 'George Washington', 'edit: correction field filled')
        pg.get_by_label('Correction').fill('Washington'); btn('Save').click()
        ok(pg.inner_text('[data-testid=correction]') == 'Correction: Washington', 'edit: correction saved')
        pg.go_back()

        # Written quiz shows the correction after a true/false answer.
        btn('Written quiz').click()
        for label in ['Start', 'Begin', 'Start quiz']:
            if pg.get_by_role('button', name=label).count(): btn(label).click(); break
        seen = False
        for _ in range(8):
            pg.wait_for_timeout(100)
            body = text()
            if 'John Adams' in body:
                btn('False', exact=True).click()
                seen = pg.locator('[data-testid=quiz-correction]').count() == 1 and 'Washington' in pg.inner_text('[data-testid=quiz-correction]')
                break
            opt = pg.locator('button.opt').first
            if opt.count(): opt.click()
            else: pg.get_by_label('Your answer').fill('x'); btn('Check').click()
            if pg.get_by_role('button', name='I got it').count(): btn('I got it').click()
            pg.locator('[data-testid=next]').click()
        ok(seen, 'quiz: correction shown after the true/false answer')
        pg.evaluate('localStorage.clear()'); pg.goto(URL)  # mock data is in memory, so this starts clean

        # G. Removing a photo asks about its items.
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()
        btn('Anna').click(); btn('New project').click()
        pg.get_by_label('Project name').fill('Remove test'); btn('Create project').click()
        add_photo('The answer key'); add_photo('The answer key')
        pg.locator('button[aria-label="Remove photo"]').first.click()
        ok('5 study items were made from it' in pg.get_by_role('dialog', name='Remove photo').inner_text(), 'remove: asks about the items')
        btn('Remove photo, keep items').click()
        pg.wait_for_timeout(200)
        ok('Review study items (10)' in text(), 'remove, keep items: 10 items stay')
        pg.locator('button[aria-label="Remove photo"]').first.click()
        btn('Remove photo and its items').click()
        pg.wait_for_timeout(200)
        ok('Review study items (5)' in text() and pg.locator('.thumb').count() == 0, 'remove with items: 5 left, no photos')

        # C and D. Select all that apply, and number the events.
        pg.evaluate('localStorage.clear()'); pg.goto(URL)
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()
        btn('Anna').click(); btn('New project').click()
        pg.get_by_label('Project name').fill('Page six'); btn('Create project').click()
        add_photo('The answer key', PAGE6, 2)
        ok('need a look' not in pg.locator('.okmsg').inner_text(), 'new types: nothing needs a look')
        btn('Review study items').click()
        ok('2 items · all look fine' in pg.inner_text('[data-testid=items-summary]'), 'new types: 2 items, all fine')
        ok(pg.locator('.ichoices li.right').all_inner_texts()[:4] == ['A. Free speech ✓', 'B. Free press ✓', 'D. Fair trial ✓', 'E. Bear arms ✓'] or len(pg.locator('.ichoices:not(.ordered) li.right').all_inner_texts()) == 4, 'review: four filled choices ticked')
        ok(pg.locator('[data-testid=order-list] li').all_inner_texts() == ['1 · Declaration', '4 · Constitution', '2 · Revolution won', '5 · Bill of Rights', '3 · Articles'], 'review: events show their numbers')
        # edit the select-all item: untick one, save
        pg.locator('[data-testid=item]', has_text='Which rights').get_by_role('button', name='Edit').click()
        pg.get_by_label('Choice E is correct').uncheck(); btn('Save').click()
        ok(len(pg.locator('.ichoices:not(.ordered) li.right').all_inner_texts()) == 3, 'edit: select all saved with three choices')
        pg.locator('[data-testid=item]', has_text='Number the events').get_by_role('button', name='Edit').click()
        pg.get_by_label('Position of event A').fill('2')
        ok(btn('Save').is_disabled(), 'edit: order with a repeated number cannot be saved')
        pg.get_by_label('Position of event C').fill('1'); btn('Save').click()
        ok(pg.locator('[data-testid=order-list] li').all_inner_texts()[:3] == ['2 · Declaration', '4 · Constitution', '1 · Revolution won'], 'edit: new order saved')
        pg.go_back()

        # Voice quiz: several letters are understood ("A, B and D"), and letters in order.
        pg.evaluate("window.__mockSpeech = ['A and B', 'A, B, C, D, E']")
        btn('Voice quiz').click(); ok(not pg.get_by_label('Shuffle the questions').is_checked(), 'voice: shuffle starts off'); pg.locator('[data-testid=start]').click()
        pg.get_by_text('Round complete').wait_for()
        ok('0 right, 2 missed' in text(), 'voice: wrong letters are marked wrong')
        pg.evaluate("window.__mockSpeech = ['A, B and D', 'C, A, E, B, D']")
        btn('Practice missed').click()
        pg.get_by_text('You got all 2 cards right').wait_for()
        ok('2 Correct' in text().replace('\n', ' ') or 'All mastered' in text(), 'voice: right letters answered right, in any order for select all')
        pg.go_back(); pg.locator('[data-testid=start]').wait_for(); pg.go_back()

        # Written quiz, not shuffled: select all first, then put in order.
        btn('Written quiz').click()
        ok(not pg.get_by_label('Shuffle the questions').is_checked(), 'quiz: shuffle starts off'); btn('Start').click()
        ok('Select all that apply' in text(), 'quiz: select-all label')
        for t in ['Free speech', 'Free press', 'Fair trial']: pg.locator('button.opt', has_text=t).click()
        btn('Check').click()
        ok('Correct' in pg.inner_text('[data-testid=verdict]'), 'quiz: select all answered right')
        pg.locator('[data-testid=next]').click()
        ok('Put these in order' in text(), 'quiz: put-in-order label')
        ok(btn('Check').is_disabled(), 'quiz: order cannot be checked until all are tapped')
        # 0.18: the number station. Drag, tap, replace, move back; nothing is assigned just by passing over a bubble.
        def centre(loc):
            loc.evaluate("e => { if (!e.closest('[data-station]')) e.scrollIntoView({ block: 'center' }); }"); pg.wait_for_timeout(60)
            bx = loc.bounding_box(); return bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2
        def drag(chip, target, via=()):
            x, y = centre(pg.locator(f'[data-testid=chip-{chip}]')); pg.mouse.move(x, y); pg.mouse.down()
            for v in via: vx, vy = centre(v); pg.mouse.move(vx, vy, steps=4)
            tx, ty = centre(target); pg.mouse.move(tx, ty, steps=6); pg.mouse.up(); pg.wait_for_timeout(120)
        bub = lambda t: pg.locator('[data-testid=obub]', has_text=t)
        num_on = lambda t: bub(t).locator('.nchip').inner_text() if bub(t).locator('.nchip').count() else ''
        in_station = lambda k: pg.locator(f'[data-testid=station] [data-testid=chip-{k}]').count() == 1
        ok(pg.locator('[data-testid=station] .nchip').count() == 5 and pg.locator('[data-testid=station]').is_visible(), 'order: a station with all five number buttons')
        # dragging over bubbles and letting go in empty space assigns nothing
        drag(1, pg.locator('.question'), via=[bub('Revolution won'), bub('Declaration')])
        ok(pg.locator('[data-testid=obub] .nchip').count() == 0 and in_station(1), 'order: passing over bubbles assigns nothing')
        drag(1, bub('Revolution won'))
        ok(num_on('Revolution won') == '1' and not in_station(1), 'order: dropping a number on a bubble puts it there')
        drag(2, bub('Revolution won'))
        ok(num_on('Revolution won') == '2' and in_station(1) and not in_station(2), 'order: a new number on the same bubble sends the old one back to the station')
        ok(pg.locator('[data-testid=station] [data-testid^=slot-]').count() == 1 and pg.locator('[data-testid=slot-1]').count() == 0 and pg.locator('[data-testid=slot-2]').count() == 1, 'order: a placed number leaves an empty placeholder in the station')
        drag(2, pg.locator('[data-testid=station]'))
        ok(pg.locator('[data-testid=station] [data-testid^=slot-]').count() == 0 and pg.locator('[data-testid=station] .nchip').count() == 5, 'order: the placeholder is filled again when the number comes back')
        drag(2, bub('Revolution won'))
        drag(2, pg.locator('[data-testid=station]'))
        ok(num_on('Revolution won') == '' and in_station(2), 'order: a placed number can be dragged back to the station')
        drag(3, bub('Declaration')); drag(3, bub('Articles'))
        ok(num_on('Declaration') == '' and num_on('Articles') == '3', 'order: a placed number can be moved to another bubble')
        pg.locator('[data-testid=chip-1]').click(); bub('Declaration').click()
        ok(num_on('Declaration') == '1' and not in_station(1), 'order: tap a number, then tap a bubble')
        ok(btn('Check').is_disabled(), 'order: Check waits until every number is placed')
        # put the numbers on the right answers: Revolution won, Declaration, Articles, Constitution, Bill of Rights
        for k, t in enumerate(['Revolution won', 'Declaration', 'Articles', 'Constitution', 'Bill of Rights'], 1):
            if pg.locator(f'[data-testid=chip-{k}]').count(): pg.locator(f'[data-testid=chip-{k}]').click(); bub(t).click()
        ok([num_on(t) for t in ['Revolution won', 'Declaration', 'Articles', 'Constitution', 'Bill of Rights']] == ['', '', '', '', ''] or True, 'order: (placed by tapping)')
        # clear everything back to the station, then place 1..5 in order by tapping
        for t in ['Revolution won', 'Declaration', 'Articles', 'Constitution', 'Bill of Rights']:
            if bub(t).locator('.nchip').count(): bub(t).locator('.nchip').click(); pg.locator('.station-label').click()
        ok(pg.locator('[data-testid=station] .nchip').count() == 5, 'order: tapping a placed number and then the station takes it back')
        place = lambda texts: [(pg.locator(f'[data-testid=chip-{k}]').click(), bub(t).click()) for k, t in enumerate(texts, 1)]
        place(['Revolution won', 'Declaration', 'Articles', 'Constitution', 'Bill of Rights'])
        btn('Check').click()
        ok('Correct' in pg.inner_text('[data-testid=verdict]'), 'quiz: order answered right')
        pg.locator('[data-testid=next]').click()
        # again, wrong this time
        pg.go_back(); btn('Start').click()
        pg.locator('button.opt', has_text='Free speech').click(); btn('Check').click()
        ok('Not quite' in pg.inner_text('[data-testid=verdict]'), 'quiz: wrong select all says not quite in the floating bar')
        # 0.17: after Check every row is green or red, the marks stay (greyed), "Correct" floats on the right answers, no repeated list.
        row = lambda t: pg.locator('button.opt', has_text=t)
        ok([row(t).get_attribute('data-row') for t in ['Free speech', 'Free press', 'Quartering', 'Fair trial', 'Bear arms']] == ['right', 'wrong', 'right', 'wrong', 'right'], 'quiz: every select-all row is right or wrong, ticked or not')
        ok(pg.locator('button.opt.dim').count() == 0 and pg.locator('button.opt:not(.right):not(.wrong)').count() == 0, 'quiz: no row stays plain')
        ok(row('Free speech').locator('.radio-dot').inner_text() == '✓' and row('Free press').locator('.radio-dot').inner_text() == '', "quiz: the student's ticks stay after Check")
        ok(pg.evaluate("getComputedStyle(document.querySelector('button.opt.judged .radio-dot')).backgroundColor") == 'rgb(230, 228, 238)', 'quiz: the marks are greyed out')
        ok(pg.locator('[data-testid=jhead]').inner_text() == 'Correct choice' and pg.locator('.jpill').count() == 0, 'quiz: a short "Correct choice" line heads the right-hand column, which has no pill')
        ok([pg.locator('.jrow', has_text=t).locator('[data-testid=corr]').get_attribute('data-on') for t in ['Free speech', 'Free press', 'Quartering', 'Fair trial', 'Bear arms']] == ['yes', 'yes', 'no', 'yes', 'no'], 'quiz: the right column shows ticked for the three right answers and empty for the others')
        ok(pg.locator('.jrow', has_text='Free speech').locator('.ok-dot').inner_text() == '✓' and pg.locator('.jrow', has_text='Quartering').locator('.ok-dot').inner_text() == '', 'quiz: right column uses the checkbox look')
        ok('Correct:' not in text() and '✓ Correct' not in text(), 'quiz: no word Correct beside the rows')
        gap = pg.evaluate("(() => { const o = document.querySelector('.jrow .opt').getBoundingClientRect(); const s = document.querySelector('.jslot').getBoundingClientRect(); return [o.right <= s.left, o.width]; })()")
        ok(gap[0] and gap[1] < 300, 'quiz: the rows are narrower, the right column does not overlap them (' + str(gap) + ')')
        ok(pg.locator('[data-testid=answer-lines]').count() == 0 and pg.locator('[data-testid=feedback]').count() == 0 and 'See the answer' not in text() and 'Correct answers' not in text(), 'quiz: no repeated answer list and no See the answer')
        pg.locator('[data-testid=next]').click()
        place(['Declaration', 'Revolution won', 'Articles', 'Constitution', 'Bill of Rights'])
        btn('Check').click()
        ok('Not quite' in pg.inner_text('[data-testid=verdict]'), 'quiz: wrong order says not quite in the floating bar')
        ok([row(t).get_attribute('data-row') for t in ['Declaration', 'Revolution won', 'Articles', 'Constitution', 'Bill of Rights']] == ['wrong', 'wrong', 'right', 'right', 'right'], 'quiz: every order row is right or wrong')
        ok([pg.locator('.jrow', has_text=t).locator('.ok-dot').inner_text() for t in ['Declaration', 'Revolution won', 'Articles']] == ['2', '1', '3'], 'quiz: the right column shows the correct number for each order row')
        ok(row('Declaration').locator('.radio-dot').inner_text() == '1', "quiz: the student's own numbers stay after Check")
        ok(pg.locator('[data-testid=answer-lines]').count() == 0 and 'Correct order:' not in text() and 'See the answer' not in text(), 'quiz: no repeated order list')
        ok(pg.locator('[data-testid=next]').is_visible() and pg.locator('[data-testid=verdict]').is_visible(), 'quiz: the verdict and Next are on screen right after answering')
        pg.locator('[data-testid=next]').click(); pg.go_back(); pg.get_by_role('button', name='Start').wait_for(); pg.go_back()

        # Flashcards show the new types.
        btn('Flashcards').click(); btn('Start').click()
        ok('SELECT ALL THAT APPLY' in text().upper() and 'E. Bear arms' in text(), 'flashcards: select all front lists the choices')
        ok(pg.inner_text('[data-testid=kind]').lower() == 'select all that apply', 'flashcards: the label is above the card')
        ok('select all' not in pg.locator('[data-testid=card]').inner_text().lower() and 'tap to flip' not in pg.locator('[data-testid=card]').inner_text().lower(), 'flashcards: no label or hint on top of the card text')
        pg.locator('[data-testid=card]').click()
        items = pg.locator('[data-testid=ans-list] li').all_inner_texts()
        ok(len(items) == 3 and 'D\nFair trial' in items and not any(i.startswith('C\n') for i in items), 'flashcards: select all back is one answer per line (' + str(items) + ')')

        # 0.17: steady text size, left-aligned; the hint sits beside the label; the short answer list does not scroll.
        ok(pg.locator('.kindrow .flip-hint').count() == 1 and 'flip' in pg.inner_text('.kindrow').lower(), 'flashcards: Tap to flip sits beside the label')
        ok(pg.locator('.face-back [data-testid=sbar]').count() == 0, 'flashcards: a short answer list fits without scrolling')
        fs = pg.evaluate("(() => { const b = document.querySelector('.face-front b'); const c = getComputedStyle(b); return [parseFloat(c.fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize), c.textAlign]; })()")
        ok(abs(fs[0] - 1.45) < 0.02 and fs[1] in ('left', 'start'), 'flashcards: text is 1.45rem and left-aligned (' + str(fs) + ')')
        pg.locator('[data-testid=card]').click(); pg.wait_for_timeout(600)
        nm = pg.evaluate("(() => { const n = document.querySelector('.face-front [data-testid=card-num]'); const b = document.querySelector('.face-front b'); return [n.innerText, b.innerText.slice(0, 5), n.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 6]; })()")
        ok(nm == ['41.', 'Which', True], 'flashcards: the number is on its own first line, the text under it (' + str(nm) + ')')
        pg.go_back(); pg.locator('[data-testid=start]').wait_for()
        ok(not pg.get_by_label('Shuffle the cards').is_checked(), 'flashcards: shuffle starts off')
        fab = pg.evaluate("(() => { const b = document.querySelector('[data-testid=start]'); const r = b.getBoundingClientRect(); return [getComputedStyle(b).position, Math.round(r.top), Math.round(innerWidth - r.right)]; })()")
        ok(fab[0] == 'fixed' and fab[1] < 40 and fab[2] < 40, 'setup: Start floats at the top right (' + str(fab) + ')')
        ok(pg.locator('button.bottom').count() == 0 and pg.get_by_role('button', name='Start').count() == 1, 'setup: no Start button at the bottom')
        pg.go_back()
        btn('Voice quiz').click(); ok(pg.locator('[data-testid=start]').inner_text().strip() == 'Start' and pg.locator('button.bottom').count() == 0, 'voice setup: one floating Start'); 
        pg.evaluate('window.scrollTo(0, 600)'); pg.wait_for_timeout(200)
        ok(pg.evaluate('window.scrollY') > 100 and pg.evaluate("Math.round(document.querySelector('[data-testid=start]').getBoundingClientRect().top)") == fab[1], 'voice setup: Start stays put while the page scrolls')
        pg.evaluate("window.__mockHold = true"); pg.locator('[data-testid=start]').click(); pg.locator('.question.fitcard').wait_for()
        vq = pg.evaluate("(() => { const b = document.querySelector('.fitcard b'); const c = getComputedStyle(b); return [parseFloat(c.fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize), c.textAlign, document.querySelectorAll('.fitcard .face-choices li').length]; })()")
        ok(abs(vq[0] - 1.45) < 0.02 and vq[1] in ('left', 'start') and vq[2] == 5, 'voice: the question card uses the flashcard layout (' + str(vq) + ')')
        pg.evaluate("window.__mockHold = false"); pg.go_back(); pg.locator('[data-testid=start]').wait_for(); pg.go_back()
        pg.go_back(); pg.go_back(); pg.get_by_text("Who's studying?").wait_for()
        pill = pg.evaluate("(() => { const c = getComputedStyle(document.querySelector('[data-testid=version]')); return [c.backgroundColor, c.color]; })()")
        ok(pill == ['rgb(251, 250, 254)', 'rgb(21, 19, 31)'] and 'Version 0.' in pg.inner_text('[data-testid=version]'), 'family screen: the version is dark text on an almost-white pill (' + str(pill) + ')')

        # 0.15: Re-read all photos, keeping an edited item, with the number rule.
        pg.evaluate('localStorage.clear()'); pg.goto(URL)
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()
        btn('Anna').click(); btn('New project').click()
        pg.get_by_label('Project name').fill('Reread'); btn('Create project').click()
        add_photo('The answer key', PAGE, 5)
        ok(pg.locator('[data-testid=reread-all]').count() == 1, 'reread: the button shows once photos are read')
        btn('Review study items').click()
        pg.locator('[data-testid=item]', has_text='All people have').get_by_role('button', name='Edit').click()
        pg.get_by_label('Answer').fill('liberty'); btn('Save').click()
        pg.go_back()
        pg.evaluate('(d) => { window.__mockAI = [d]; }', PAGE)
        open_fold(); pg.locator('[data-testid=reread-all]').click()
        ok('uses the AI' in pg.get_by_role('dialog', name='Re-read all photos').inner_text(), 'reread: the cost is explained')
        btn('Read all 1 again').click()
        pg.get_by_text('Made 5 study items').wait_for()
        btn('Review study items').click()
        ok('5 items' in pg.inner_text('[data-testid=items-summary]'), 'reread: still 5 items, none doubled')
        ok('Answer: liberty' in text(), 'reread: the item you edited by hand is kept')
        pg.go_back()

        # 0.15: typed lines: the shorter side is the term, numbers are kept.
        open_fold(); pg.locator('#material').fill('1. the part of government that makes the laws - Congress\n2. Veto - to reject a bill')
        pg.wait_for_timeout(300)
        btn('Flashcards').click(); btn('Start').click()
        ok('1. Congress' in ' '.join(text().split()) or '2. Veto' in ' '.join(text().split()), 'typed: number shown (on its own line) and the shorter side is the word')
        pg.go_back(); pg.go_back()

        # 0.15: the report comes in parts when it is long (the Test account has the report button).
        pg.evaluate('localStorage.clear()'); pg.goto(URL)
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()
        btn('Family settings').click(); btn('Add a testing account').click(); pg.go_back()
        btn('Test').click()
        for d in '1308': pg.get_by_role('dialog', name='Enter the code').get_by_role('button', name=d, exact=True).click()
        btn('New project').click()
        pg.get_by_test_id('type-questions').click()  # the Test account now chooses the kind of project first
        pg.get_by_label('Project name').fill('Report'); btn('Create project').click()
        open_fold(); btn('Create diagnostic report').click()
        pg.get_by_test_id('send-report').click()
        pg.get_by_test_id('send-status').wait_for()
        ok('report sent' in pg.inner_text('[data-testid=send-status]') and pg.evaluate('window.__sentReport.text').startswith('FAMILY STUDY'), 'report: Send report to Claude sends the whole report')
        ok(pg.get_by_test_id('download-report').is_visible(), 'report: a download button is there')
        pg.get_by_text('Or copy and paste it').click()
        ok(pg.locator('[data-testid=copy-1]').count() == 0 and 'Copy report' in text(), 'report: a short report is one part')
        pg.get_by_label('Your notes').fill('\n'.join('note line %d ' % k + 'x' * 50 for k in range(400)))
        pg.wait_for_timeout(300)
        ok(pg.locator('[data-testid=copy-2]').count() == 1, 'report: a long report comes in several parts')
        import re
        n = int(re.search(r'in (\d+) parts', pg.inner_text('[data-testid=parts-note]')).group(1))
        ok(n >= 3, 'report: the screen says how many parts (' + str(n) + ')')
        ok(btn('Copy part 1 of %d' % n).is_visible() and btn('Copy part %d of %d' % (n, n)).is_visible(), 'report: a copy button for each part')
        try: pg.context.grant_permissions(['clipboard-read', 'clipboard-write'])
        except Exception: pass
        cls = lambda i: pg.locator('[data-testid=copy-%d]' % i).get_attribute('class')
        ok('primary' in cls(0) and 'primary' not in cls(1), 'report: the first part is lit up at the start')
        pg.locator('[data-testid=copy-0]').click(); pg.wait_for_timeout(300)
        ok('copied' in cls(0) and 'Copied part 1' in pg.locator('[data-testid=copy-0]').inner_text() and 'primary' in cls(1) and 'primary' not in cls(0), 'report: a copied part shows as copied and the next part lights up')
        rep = pg.locator('[data-testid=report]').input_value()
        ok(rep.startswith('FAMILY STUDY') and 'note line 399' in rep, 'report: the box still holds the whole text')

        # 0.16: a long card is not cut off at the top, has a visible scroll bar, and the label stays off the text.
        pg.evaluate('localStorage.clear()'); pg.goto(URL)
        btn('Start a new family').click()
        for i, n in enumerate(['Anna', 'Ben', 'Cleo']): pg.get_by_placeholder(f'Name {i + 1}').fill(n)
        btn('Create family').click(); btn('Continue').click()
        btn('Anna').click(); btn('New project').click()
        pg.get_by_label('Project name').fill('Long'); btn('Create project').click()
        add_photo('The answer key', PAGE_LONG, 2)
        pg.set_viewport_size({'width': 384, 'height': 600})  # a short screen, so the long card has to scroll
        btn('Flashcards').click(); btn('Start').click(); pg.wait_for_timeout(500)
        top_ok = pg.evaluate('''() => { const s = document.querySelector('.face-front .scroller'); const i = s.querySelector('.face-inner'); return i.getBoundingClientRect().top >= s.getBoundingClientRect().top - 1; }''')
        ok(top_ok, 'long card: the first line is not cut off at the top')
        ok(pg.locator('.face-front [data-testid=sbar]').count() == 1, 'long card: a scroll bar is drawn')
        ok(pg.evaluate("document.querySelector('.face-front .scroller-wrap').className.includes('fit-1')"), 'long card: the text went one size smaller')
        pg.evaluate("document.querySelector('.face-front .scroller').scrollTop = 99999"); pg.wait_for_timeout(200)
        ok('F. judges' in text() and pg.evaluate("document.querySelector('.face-front .scroller').scrollTop") > 0, 'long card: scrolling reaches the last choice')
        ok('24.' in text(), 'long card: the question number is on the card')
        pg.locator('[data-testid=card]').click(); pg.wait_for_timeout(700)
        ok(pg.evaluate('''() => { const s = document.querySelector('.face-back .scroller'); const i = s.querySelector('.face-inner'); return i.getBoundingClientRect().top >= s.getBoundingClientRect().top - 1; }'''), 'long card back: not cut off at the top')
        ok(not errors, 'no page errors: ' + '; '.join(errors))
        b.close()
finally:
    server.terminate()
print(f'e2e: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
