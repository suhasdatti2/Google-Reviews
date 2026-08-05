/* Proves a broken/absent knowledge payload can never produce a dead widget
   or an invented answer. Uses the real snippet markup, same as test5. */
const fs = require('fs'), vm = require('vm'), { El, parseInto } = require('./fakedom');
const SRC = require('./paths');
const snippet = fs.readFileSync(SRC.snippet, 'utf8');
const src = fs.readFileSync(SRC.js, 'utf8');
const good = fs.readFileSync(SRC.payload, 'utf8');

function build() {
  const holder = new El('div');
  parseInto(holder, snippet.slice(snippet.indexOf('<div class="oqa"')));
  return holder.querySelector('[data-optiq-ai]');
}

function scenario(name, payloadText, withMarkup) {
  const root = build();
  const doc = {
    readyState: 'complete',
    body: { classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; } } },
    getElementById: id => (id === 'optiq-ai-data' && payloadText !== null) ? { textContent: payloadText } : null,
    querySelector: s => withMarkup ? (s === '[data-optiq-ai]' ? root : root.querySelector(s)) : null,
    querySelectorAll: s => withMarkup ? root.querySelectorAll(s) : [],
    addEventListener: () => {},
    createElement: t => new El(t)
  };
  const g = {}; g.window = g; g.document = doc; g.addEventListener = () => {};
  g.matchMedia = () => ({ matches: false });
  g.clearTimeout = () => {};
  g.fetch = undefined;
  const timers = []; g.setTimeout = fn => timers.push(fn);
  vm.createContext(g);
  let threw = null;
  try { vm.runInContext(src, g); } catch (e) { threw = e.message; }
  const api = g.window.OptiqAI || {};
  const launcher = root.querySelector('[data-oqa-launch]');
  const wired = launcher ? (launcher.listeners.click || []).length : 0;

  // Actually click it and see whether the panel opens.
  let opened = false, reply = '';
  if (withMarkup && wired) {
    launcher.dispatch('click');
    opened = root.classList.contains('is-open');
    const input = root.querySelector('[data-oqa-input]');
    const form = root.querySelector('[data-oqa-form]');
    if (input && form) { input.value = 'how much is the counter card'; form.dispatch('submit'); }
    timers.splice(0).forEach(fn => fn());
    const msgs = root.querySelector('[data-oqa-log]').children.filter(c => c.classList.contains('oqa-msg'));
    reply = msgs.length ? msgs[msgs.length - 1].textContent.replace(/\s+/g, ' ').trim() : '';
  }
  console.log('--- ' + name);
  console.log('    threw:           ' + (threw || 'no'));
  console.log('    knowledgeLoaded: ' + api.knowledgeLoaded + (api.knowledgeError ? '  (' + api.knowledgeError.slice(0, 58) + ')' : ''));
  console.log('    launcher wired:  ' + wired + '   opens: ' + opened);
  console.log('    reply:           ' + reply.slice(0, 120));
  console.log('');
  return { threw, api, wired, opened, reply, root };
}

const a = scenario('healthy payload', good, true);
const b = scenario('trailing commas (repairable)', '{"shop":{},"products":[{"title":"X","handle":"x","url":"/x","description":"","priceMin":1,"priceMax":1,"priceMinText":"$0.01","priceMaxText":"$0.01","available":true,"tags":[],"options":[],"variants":[],"collections":[],},],"pages":[],"policies":[],"articles":[],"routes":{},"customer":{},"facts":[],"ok":true,}', true);
const c = scenario('unrepairable JSON', '{"products":[{"image": Liquid error (line 71): invalid url input}]}', true);
const d = scenario('no payload element', null, true);
const e = scenario('truncated (no ok sentinel)', '{"shop":{},"products":[{"title":"X","handle":"x"}]}', true);
const f = scenario('payload fine, markup missing', good, false);

let fails = 0;
const check = (l, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (ok || extra === undefined ? '' : '   -> ' + extra)); if (!ok) fails++; };

check('healthy: loads, opens, answers with the real price', !a.threw && a.api.knowledgeLoaded === true && a.opened && /\$29\.99/.test(a.reply), a.reply.slice(0, 80));
check('trailing commas are repaired, not fatal', !b.threw && b.api.knowledgeLoaded === true && b.opened, b.api.knowledgeError);
check('trailing-comma repair is recorded', /needed repair/.test(b.api.knowledgeError || ''), b.api.knowledgeError);
check('unrepairable JSON: still opens, refuses to guess', !c.threw && c.opened && c.reply.indexOf('$') === -1, c.reply.slice(0, 80));
check('no payload: still opens, degraded reply', !d.threw && d.opened && /can't reach the Optiq catalogue/.test(d.reply), d.reply.slice(0, 80));
check('truncated payload rejected by ok sentinel', e.api.knowledgeLoaded === false && e.opened, e.api.knowledgeError);
check('degraded run relabels the header pill', c.root.querySelector('[data-oqa-pill]').textContent === 'Limited mode', c.root.querySelector('[data-oqa-pill]').textContent);
check('degraded run relabels the status line', /Store data unavailable/.test(c.root.querySelector('[data-oqa-status]').textContent));
check('healthy run keeps the live labels', a.root.querySelector('[data-oqa-status]').textContent.indexOf('Connected to live store') > -1);
check('missing markup: script survives', !f.threw && typeof f.api.respond === 'function');
console.log('\n=== ' + (fails ? fails + ' FAILED' : 'all resilience checks passed') + ' ===');
process.exit(fails ? 1 : 0);
