/* The model path: endpoint configured, fetch stubbed. Verifies the widget
   talks to the endpoint, sends the live knowledge and the running
   conversation, renders the reply - and falls back to the local engine when
   the endpoint fails, instead of showing the customer an error. */
const fs = require('fs'), vm = require('vm'), { El, parseInto } = require('./fakedom');
const SRC = require('./paths');
const snippet = fs.readFileSync(SRC.snippet, 'utf8');
const payload = fs.readFileSync(SRC.payload, 'utf8');
const src = fs.readFileSync(SRC.js, 'utf8');

function build(endpoint) {
  const holder = new El('div');
  // Stand in for Liquid rendering the theme setting into the attribute.
  const html = snippet.slice(snippet.indexOf('<div class="oqa"'))
    .replace('{{ oqa_endpoint | escape }}', endpoint);
  parseInto(holder, html);
  return holder.querySelector('[data-optiq-ai]');
}

function run(endpoint, responder) {
  const root = build(endpoint);
  const calls = [];
  const doc = {
    readyState: 'complete',
    body: { classList: { _s: {}, add(c){this._s[c]=1;}, remove(c){delete this._s[c];} } },
    getElementById: id => id === 'optiq-ai-data' ? { textContent: payload } : null,
    querySelector: s => (s === '[data-optiq-ai]' ? root : root.querySelector(s)),
    querySelectorAll: s => root.querySelectorAll(s),
    addEventListener: () => {},
    createElement: t => new El(t)
  };
  const g = {}; g.window = g; g.document = doc; g.addEventListener = () => {};
  g.matchMedia = () => ({ matches: false });
  g.location = { pathname: '/products/google-review-nfc-card' };
  const timers = [];
  g.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  g.clearTimeout = () => {};
  g.fetch = (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return responder(url, JSON.parse(opts.body));
  };
  vm.createContext(g); vm.runInContext(src, g);
  const flush = () => { const t = timers.splice(0); t.forEach(fn => fn()); };
  return { g, root, calls, flush };
}

const okReply = (text) => Promise.resolve({
  ok: true, json: () => Promise.resolve({ reply: text })
});
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let fails = 0;
const check = (l, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (ok || extra === undefined ? '' : '   -> ' + extra)); if (!ok) fails++; };
const lastBubble = root => {
  const msgs = root.querySelector('[data-oqa-log]').children.filter(c => c.classList.contains('oqa-msg'));
  return msgs.length ? msgs[msgs.length - 1] : null;
};

/* ---------------------------------------------------- endpoint configured */
{
  const { g, root, calls, flush } = run('https://optiq-ai.example.workers.dev',
    () => okReply('The capital of Mongolia is **Ulaanbaatar**. It is home to roughly half the country\'s population.\n\n- Founded in 1639\n- Coldest capital city in the world\n\nAnything else?'));
  check('endpoint detected', g.window.OptiqAI.endpoint === 'https://optiq-ai.example.workers.dev', String(g.window.OptiqAI.endpoint));
  root.querySelector('[data-oqa-launch]').dispatch('click');
  const input = root.querySelector('[data-oqa-input]');
  input.value = 'what is the capital of Mongolia?';
  root.querySelector('[data-oqa-form]').dispatch('submit');
  return_check_async();
  function return_check_async() {}
  setTimeout(() => {
    check('the endpoint was called once', calls.length === 1, 'calls=' + calls.length);
    const sent = calls[0] && calls[0].body;
    check('live store knowledge was sent', !!sent && sent.knowledge.length > 1000 && sent.knowledge.indexOf('Main Counter Card') > -1);
    check('the current page was sent', !!sent && sent.page === '/products/google-review-nfc-card', sent && sent.page);
    check('conversation sent as messages', !!sent && sent.messages.length === 1 && sent.messages[0].role === 'user'
      && sent.messages[0].content === 'what is the capital of Mongolia?');
    const txt = strip(lastBubble(root).textContent);
    check('a real answer is rendered, not a refusal', /Ulaanbaatar/.test(txt) && !/don't have a good answer/.test(txt), txt.slice(0, 90));
    const html = lastBubble(root).querySelector('.oqa-bubble').innerHTML;
    check('markdown bold became html', html.indexOf('<b>Ulaanbaatar</b>') > -1, html.slice(0, 80));
    check('markdown bullets became a list', html.indexOf('<li>Founded in 1639</li>') > -1, html.slice(0, 120));

    /* second turn keeps history */
    input.value = 'how cold does it get there?';
    root.querySelector('[data-oqa-form]').dispatch('submit');
    setTimeout(() => {
      const sent2 = calls[1] && calls[1].body;
      check('second turn sends the prior exchange', !!sent2 && sent2.messages.length === 3
        && sent2.messages[1].role === 'assistant', sent2 && JSON.stringify(sent2.messages.map(m => m.role)));
      stage2();
    }, 0);
  }, 0);

  function stage2() {
    /* ------------------------------------------- endpoint fails -> fallback */
    const bad = run('https://optiq-ai.example.workers.dev',
      () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) }));
    bad.root.querySelector('[data-oqa-launch]').dispatch('click');
    bad.root.querySelector('[data-oqa-input]').value = 'how much is the counter card';
    bad.root.querySelector('[data-oqa-form]').dispatch('submit');
    setTimeout(() => {
      const txt = strip(lastBubble(bad.root).textContent);
      check('endpoint failure falls back to local answer', /\$29\.99/.test(txt), txt.slice(0, 90));

      /* ------------------------------------------------ no endpoint set */
      const off = run('', () => { throw new Error('should not be called'); });
      check('blank setting leaves the model path off', off.g.window.OptiqAI.endpoint === null);
      off.root.querySelector('[data-oqa-launch]').dispatch('click');
      off.root.querySelector('[data-oqa-input]').value = 'how much is the counter card';
      off.root.querySelector('[data-oqa-form]').dispatch('submit');
      off.flush();
      check('local engine answers when unconfigured',
        /\$29\.99/.test(strip(lastBubble(off.root).textContent)) && off.calls.length === 0);

      /* ------------------------------- junk in the setting is ignored */
      const junk = run('not a url', () => { throw new Error('should not be called'); });
      check('a non-https setting is refused', junk.g.window.OptiqAI.endpoint === null, String(junk.g.window.OptiqAI.endpoint));

      const liquid = run('{{ oqa_endpoint | escape }}', () => { throw new Error('should not be called'); });
      check('an unrendered template is refused', liquid.g.window.OptiqAI.endpoint === null, String(liquid.g.window.OptiqAI.endpoint));

      console.log('\n=== ' + (fails ? fails + ' FAILED' : 'all model-path checks passed') + ' ===');
      process.exit(fails ? 1 : 0);
    }, 0);
  }
}
