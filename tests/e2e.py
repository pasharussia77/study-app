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
        btn('Voice quiz').click(); pg.get_by_text('Shuffle', exact=False).first.click(); btn('Start talking').click()
        pg.get_by_text('Round complete').wait_for()
        ok('0 right, 2 missed' in text(), 'voice: wrong letters are marked wrong')
        pg.evaluate("window.__mockSpeech = ['A, B and D', 'C, A, E, B, D']")
        btn('Practice missed').click()
        pg.get_by_text('You got all 2 cards right').wait_for()
        ok('2 Correct' in text().replace('\n', ' ') or 'All mastered' in text(), 'voice: right letters answered right, in any order for select all')
        pg.go_back(); pg.get_by_role('button', name='Start talking').wait_for(); pg.go_back()

        # Written quiz, not shuffled: select all first, then put in order.
        btn('Written quiz').click()
        pg.get_by_text('Shuffle the questions').click(); btn('Start').click()
        ok('Select all that apply' in text(), 'quiz: select-all label')
        for t in ['Free speech', 'Free press', 'Fair trial']: pg.locator('button.opt', has_text=t).click()
        btn('Check').click()
        ok('Correct' in pg.inner_text('[data-testid=feedback]'), 'quiz: select all answered right')
        pg.locator('[data-testid=next]').click()
        ok('Put these in order' in text(), 'quiz: put-in-order label')
        ok(btn('Check').is_disabled(), 'quiz: order cannot be checked until all are tapped')
        for t in ['Revolution won', 'Declaration', 'Articles', 'Constitution', 'Bill of Rights']: pg.locator('button.opt', has_text=t).click()
        btn('Check').click()
        ok('Correct' in pg.inner_text('[data-testid=feedback]'), 'quiz: order answered right')
        pg.locator('[data-testid=next]').click()
        # again, wrong this time
        pg.go_back(); btn('Start').click()
        pg.locator('button.opt', has_text='Free speech').click(); btn('Check').click()
        fb = pg.inner_text('[data-testid=feedback]')
        ok('Not quite' in fb and 'Free speech; Free press; Fair trial' in fb, 'quiz: wrong select all shows the answers')
        pg.locator('[data-testid=next]').click()
        for t in ['Declaration', 'Revolution won', 'Articles', 'Constitution', 'Bill of Rights']: pg.locator('button.opt', has_text=t).click()
        btn('Check').click()
        fb = pg.inner_text('[data-testid=feedback]')
        ok('Not quite' in fb and '1. Revolution won' in fb, 'quiz: wrong order shows the right order')
        pg.locator('[data-testid=next]').click(); pg.go_back(); pg.get_by_role('button', name='Start').wait_for(); pg.go_back()

        # Flashcards show the new types.
        btn('Flashcards').click(); pg.get_by_text('Shuffle the cards').click(); btn('Start').click()
        ok('SELECT ALL THAT APPLY' in text().upper() and 'E. Bear arms' in text(), 'flashcards: select all front lists the choices')
        pg.locator('[data-testid=card]').click()
        ok('C. Fair trial' not in pg.locator('.face-back b').inner_text() and 'D. Fair trial' in pg.locator('.face-back b').inner_text(), 'flashcards: select all back lists the answers')
        ok(not errors, 'no page errors: ' + '; '.join(errors))
        b.close()
finally:
    server.terminate()
print(f'e2e: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
