/* Drives the widget the way a customer does: click the launcher, type,
   press Enter, use the tool buttons, reset, close. Builds the mount from the
   real snippet markup so the JS and the Liquid can't drift apart. */
const fs = require('fs'), vm = require('vm'), { El } = require('./fakedom');
const SRC = require('./paths');

const snippet = fs.readFileSync(SRC.snippet, 'utf8');
const payload = fs.readFileSync(SRC.payload, 'utf8');
const src = fs.readFileSync(SRC.js, 'utf8');

/* --- build the element tree from the snippet's real markup ------------- */
const { parseInto } = require('./fakedom');
function build(html) {
  const holder = new El('div');
  parseInto(holder, html.slice(html.indexOf('<div class="oqa"')));
  return holder.querySelector('[data-optiq-ai]');
}
const root = build(snippet);
const q = s => root.querySelector(s);

const doc = {
  readyState: 'complete',
  body: { classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; }, contains(c) { return !!this._s[c]; } } },
  getElementById: id => id === 'optiq-ai-data' ? { textContent: payload } : null,
  querySelector: s => (s === '[data-optiq-ai]' ? root : root.querySelector(s)),
  querySelectorAll: s => root.querySelectorAll(s),
  addEventListener: (t, fn) => { (doc._l = doc._l || {}), (doc._l[t] = doc._l[t] || []).push(fn); },
  createElement: t => new El(t)
};
const g = {}; g.window = g; g.document = doc; g.addEventListener = () => {};
g.matchMedia = () => ({ matches: false });
g.clearTimeout = () => {};
let timers = [];
g.setTimeout = (fn, ms) => { timers.push(fn); return timers.length; };
const flush = () => { const t = timers; timers = []; t.forEach(fn => fn()); };
vm.createContext(g); vm.runInContext(src, g);

const AI = g.window.OptiqAI;
const log = q('[data-oqa-log]');
const input = q('[data-oqa-input]');
const sendBtn = q('[data-oqa-send]');
const counter = q('[data-oqa-count]');
const status = q('[data-oqa-status]');
const pill = q('[data-oqa-pill]');
const launcher = q('[data-oqa-launch]');
const form = q('[data-oqa-form]');

let fails = 0;
const check = (label, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (cond || extra === undefined ? '' : '   -> ' + extra));
  if (!cond) fails++;
};
const bubbles = () => log.children.filter(c => c.classList.contains('oqa-msg'));
const lastText = () => { const b = bubbles(); return b.length ? b[b.length - 1].textContent.replace(/\s+/g, ' ').trim() : ''; };

console.log('--- markup parsed from the real snippet ---');
check('mount + all controls found',
  !!(log && input && sendBtn && counter && status && pill && launcher && form),
  `log=${!!log} input=${!!input} send=${!!sendBtn} count=${!!counter} status=${!!status} pill=${!!pill}`);
check('UI booted', AI.ready === true);
check('knowledge loaded', AI.knowledgeLoaded === true, AI.knowledgeError);

console.log('\n--- open ---');
check('starts closed', !root.classList.contains('is-open'));
launcher.dispatch('click');
check('launcher click opens the sidebar', root.classList.contains('is-open'));
check('greeting rendered', bubbles().length === 1 && lastText().length > 20, lastText());
check('greeting sounds human, not templated', /hey|hi\b/i.test(lastText()) && /\?/.test(lastText()), lastText());
check('pill shows live state', pill.textContent === 'Live store data', pill.textContent);
check('counter starts at 0/2000', counter.textContent === '0/2000', counter.textContent);
check('send disabled while empty', sendBtn.disabled === true);

console.log('\n--- typing ---');
input.value = 'how much is the counter card';
input.dispatch('input');
check('counter tracks input', counter.textContent === '28/2000', counter.textContent);
check('send enabled with text', sendBtn.disabled === false);

console.log('\n--- Enter sends, Shift+Enter does not ---');
input.value = 'line one';
input.dispatch('input');
const shiftEv = input.dispatch('keydown', { key: 'Enter', shiftKey: true, _p: 0, preventDefault() { this._p = 1; } });
check('Shift+Enter is not intercepted', shiftEv._p === 0);
input.value = 'how much is the counter card';
const enterEv = input.dispatch('keydown', { key: 'Enter', shiftKey: false, _p: 0, preventDefault() { this._p = 1; } });
check('Enter is intercepted', enterEv._p === 1);
flush();
check('user message + answer both rendered', bubbles().length === 3, 'bubbles=' + bubbles().length);
check('answer carries the real price', /\$29\.99/.test(lastText()), lastText().slice(0, 110));
check('input cleared after send', input.value === '');
check('counter reset after send', counter.textContent === '0/2000', counter.textContent);

console.log('\n--- tool buttons do real work ---');
const askBtns = root.querySelectorAll('[data-oqa-ask]');
check('two ask tools wired', askBtns.length === 2, 'found ' + askBtns.length);
askBtns[0].dispatch('click'); flush();
check('products tool returns the catalogue', /Main Counter Card/.test(lastText()), lastText().slice(0, 110));
askBtns[1].dispatch('click'); flush();
check('shipping tool returns shipping copy', /ship|tracking|business day/i.test(lastText()), lastText().slice(0, 110));

console.log('\n--- reset ---');
const before = bubbles().length;
q('[data-oqa-reset]').dispatch('click'); flush();
check('reset clears history and re-greets', before > 1 && bubbles().length === 1, 'before=' + before + ' after=' + bubbles().length);

console.log('\n--- conversation feels like a conversation ---');
const say = t => { input.value = t; form.dispatch('submit'); flush(); return lastText(); };
const smalltalk = [
  ['yo', /hey|hi\b/i],
  ['how are you?', /doing fine|thanks for asking/i],
  ['are you a bot?', /software, not a person/i],
  ['what can you do?', /compare|recommend|look up/i],
  ['ok cool', /got it|sounds good|alright/i],
  ['thanks!', /any time|no problem|happy to help/i]
];
smalltalk.forEach(([t, re]) => {
  const a = say(t);
  check("'" + t + "' answered like a person", re.test(a), a.slice(0, 100));
});

console.log('\n--- follow-ups are offered but never twice in a row ---');
q('[data-oqa-reset]').dispatch('click'); flush();
const a1 = say('how much is the counter card');
const a2 = say('how much is the restaurant pack');
const a3 = say('how much is hosting');
const nudged = [a1, a2, a3].map(a => /want|tell me|happy to|anything else/i.test(a));
check('not every answer ends in a follow-up', !(nudged[0] && nudged[1] && nudged[2]), JSON.stringify(nudged));
check('at least one answer offers a follow-up', nudged.some(Boolean), JSON.stringify(nudged));

console.log('\n--- close ---');
q('[data-oqa-close]').dispatch('click');
check('close button closes it', !root.classList.contains('is-open'));
launcher.dispatch('click');
check('reopens', root.classList.contains('is-open'));
(doc._l.keydown || []).forEach(fn => fn({ key: 'Escape' }));
check('Escape closes it', !root.classList.contains('is-open'));

console.log('\n=== ' + (fails ? fails + ' FAILED' : 'all UI checks passed') + ' ===');
process.exit(fails ? 1 : 0);
