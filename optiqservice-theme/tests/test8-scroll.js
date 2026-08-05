/* Mouse-wheel scrolling. The theme runs Lenis, which attaches a non-passive
   wheel listener and preventDefault()s it for the whole page - that is why the
   wheel did nothing inside the chat and the dashboard while dragging the
   scrollbar still worked. Lenis walks up from the event target looking for
   [data-lenis-prevent] and leaves those subtrees alone.

   This stubs Lenis with the same contract and asserts the outcome. */
const fs = require('fs'), vm = require('vm'), { El, parseInto } = require('./fakedom');
const SRC = require('./paths');
const scrollSrc = fs.readFileSync(SRC.scroll, 'utf8');
const aiSrc = fs.readFileSync(SRC.js, 'utf8');
const snippet = fs.readFileSync(SRC.snippet, 'utf8');
const payload = fs.readFileSync(SRC.payload, 'utf8');

let fails = 0;
const check = (l, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (ok || extra === undefined ? '' : '   -> ' + extra)); if (!ok) fails++; };

function widget() {
  const holder = new El('div');
  parseInto(holder, snippet.slice(snippet.indexOf('<div class="oqa"')).replace('{{ oqa_endpoint | escape }}', ''));
  return holder.querySelector('[data-optiq-ai]');
}

function dashboard() {
  const app = new El('div');
  app.className = 'oqapp';
  const content = new El('div');
  content.className = 'oqapp__content';
  app.appendChild(content);
  return app;
}

/* Runs optiq-scroll.js against a page, returns whether Lenis was constructed
   and which elements ended up exempt. */
function runScroll(rootEls) {
  const page = new El('body');
  rootEls.forEach(e => page.appendChild(e));
  let lenisMade = false;
  const g = {};
  g.window = g;
  g.matchMedia = q => ({ matches: false });
  g.requestAnimationFrame = () => {};
  g.addEventListener = () => {};
  g.MutationObserver = function () { this.observe = () => {}; };
  g.getComputedStyle = () => ({ getPropertyValue: () => '0' });
  g.Lenis = function () { lenisMade = true; this.raf = () => {}; this.stop = () => {}; this.start = () => {}; this.scrollTo = () => {}; };
  g.document = {
    readyState: 'complete',
    body: page,
    querySelector: s => page.querySelector(s),
    querySelectorAll: s => page.querySelectorAll(s),
    addEventListener: () => {},
    documentElement: new El('html')
  };
  vm.createContext(g);
  vm.runInContext(scrollSrc, g);
  return { lenisMade, page };
}

/* Does a wheel event over `el` reach the browser, or get eaten by Lenis?
   Mirrors Lenis's own rule: exempt if the target or any ancestor carries
   [data-lenis-prevent]. */
function wheelReachesBrowser(el, lenisRunning) {
  if (!lenisRunning) return true;
  for (let n = el; n; n = n.parentNode) {
    if (n.getAttribute && n.getAttribute('data-lenis-prevent') !== null) return true;
  }
  return false;
}

console.log('--- storefront page with the AI panel ---');
{
  const w = widget();
  const { lenisMade, page } = runScroll([w]);
  check('Lenis still runs on ordinary pages', lenisMade === true);
  const log = page.querySelector('[data-oqa-log]');
  const input = page.querySelector('[data-oqa-input]');
  check('chat log is exempt in the shipped markup', log.getAttribute('data-lenis-prevent') !== null);
  check('composer is exempt in the shipped markup', input.getAttribute('data-lenis-prevent') !== null);
  check('WHEEL SCROLLS THE CHAT', wheelReachesBrowser(log, lenisMade));
  // A bubble inside the log must inherit the exemption via its ancestors.
  const bubble = new El('div'); bubble.className = 'oqa-bubble'; log.appendChild(bubble);
  check('wheel over a message inside the log also works', wheelReachesBrowser(bubble, lenisMade));
  // The page itself should still be smooth-scrolled - that is the feature.
  const hero = new El('section'); page.appendChild(hero);
  check('ordinary page content still uses smooth scroll', wheelReachesBrowser(hero, lenisMade) === false);
}

console.log('\n--- dashboard ---');
{
  const app = dashboard();
  const { lenisMade, page } = runScroll([app]);
  check('Lenis does not start on the dashboard shell', lenisMade === false);
  const content = page.querySelector('.oqapp__content');
  check('WHEEL SCROLLS THE DASHBOARD', wheelReachesBrowser(content, lenisMade));
  const card = new El('div'); content.appendChild(card);
  check('wheel over a KPI card inside it also works', wheelReachesBrowser(card, lenisMade));
}

console.log('\n--- sign-in screen ---');
{
  const auth = new El('div'); auth.className = 'oqauth';
  const { lenisMade } = runScroll([auth]);
  check('Lenis does not start on the sign-in shell', lenisMade === false);
}

console.log('\n--- the widget marks its own scrollers even on a stale theme ---');
{
  // Simulate a snippet without the attribute: strip it, then let optiq-ai.js
  // boot and confirm it puts the exemption back.
  const holder = new El('div');
  parseInto(holder, snippet.slice(snippet.indexOf('<div class="oqa"'))
    .replace('{{ oqa_endpoint | escape }}', '')
    .replace(/ data-lenis-prevent/g, ''));
  const root = holder.querySelector('[data-optiq-ai]');
  check('attribute really was stripped for this case',
    root.querySelector('[data-oqa-log]').getAttribute('data-lenis-prevent') === null);
  const g = {}; g.window = g; g.addEventListener = () => {}; g.matchMedia = () => ({ matches: false });
  g.setTimeout = () => {}; g.clearTimeout = () => {};
  g.document = {
    readyState: 'complete',
    body: { classList: { add(){}, remove(){} } },
    getElementById: id => id === 'optiq-ai-data' ? { textContent: payload } : null,
    querySelector: s => (s === '[data-optiq-ai]' ? root : root.querySelector(s)),
    querySelectorAll: s => root.querySelectorAll(s),
    addEventListener: () => {},
    createElement: t => new El(t)
  };
  vm.createContext(g); vm.runInContext(aiSrc, g);
  check('optiq-ai.js restores it on the log',
    root.querySelector('[data-oqa-log]').getAttribute('data-lenis-prevent') !== null);
  check('optiq-ai.js restores it on the composer',
    root.querySelector('[data-oqa-input]').getAttribute('data-lenis-prevent') !== null);
}

console.log('\n=== ' + (fails ? fails + ' FAILED' : 'all scroll checks passed') + ' ===');
process.exit(fails ? 1 : 0);
