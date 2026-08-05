/* Minimal DOM good enough to actually drive the widget: a real (small) HTML
   parser so innerHTML builds children and querySelector works inside them,
   attribute selectors, classList, and event dispatch. Not a browser - but it
   exercises the real code paths instead of stubbing them out. */
const VOID = { br: 1, img: 1, input: 1, hr: 1, meta: 1, link: 1, path: 1, circle: 1 };

function El(tag) {
  this.tagName = (tag || 'div').toUpperCase();
  this.children = []; this.parentNode = null;
  this.attrs = {}; this.listeners = {}; this.style = {};
  this.text = ''; this.value = ''; this.disabled = false;
  this.scrollTop = 0; this.scrollHeight = 100;
  const self = this;
  this.classList = {
    _s: {},
    add() { for (const c of arguments) self.classList._s[c] = 1; },
    remove() { for (const c of arguments) delete self.classList._s[c]; },
    contains(c) { return !!self.classList._s[c]; },
    toString() { return Object.keys(self.classList._s).join(' '); }
  };
}
Object.defineProperty(El.prototype, 'className', {
  get() { return this.classList.toString(); },
  set(v) { this.classList._s = {}; String(v).split(/\s+/).filter(Boolean).forEach(c => { this.classList._s[c] = 1; }); }
});
Object.defineProperty(El.prototype, 'textContent', {
  get() { return this.text + this.children.map(c => c.textContent).join(''); },
  set(v) { this.text = String(v); this.children = []; }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get() { return this._html || ''; },
  set(v) { this._html = String(v); this.text = ''; this.children = []; parseInto(this, String(v)); }
});
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; };
El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
El.prototype.hasAttribute = function (k) { return k in this.attrs; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; return c;
};
El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
El.prototype.focus = function () { this.focused = true; };
El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
El.prototype.dispatch = function (t, ev) {
  ev = ev || {}; ev.type = t; ev.preventDefault = ev.preventDefault || function () {};
  (this.listeners[t] || []).forEach(fn => fn(ev));
  return ev;
};
El.prototype._all = function (out) {
  out = out || [];
  this.children.forEach(c => { out.push(c); c._all(out); });
  return out;
};
function matches(el, sel) {
  return sel.split(',').map(s => s.trim()).some(s => {
    let m = s.match(/^\[([a-zA-Z-]+)\]$/);
    if (m) return el.getAttribute(m[1]) !== null;
    m = s.match(/^\.([a-zA-Z0-9_-]+)$/);
    if (m) return el.classList.contains(m[1]);
    m = s.match(/^#([a-zA-Z0-9_-]+)$/);
    if (m) return el.getAttribute('id') === m[1];
    m = s.match(/^([a-zA-Z]+)$/);
    if (m) return el.tagName === m[1].toUpperCase();
    return false;
  });
}
El.prototype.querySelector = function (sel) {
  const hit = this._all().filter(e => matches(e, sel));
  return hit.length ? hit[0] : null;
};
El.prototype.querySelectorAll = function (sel) {
  return this._all().filter(e => matches(e, sel));
};

/* --- tiny HTML parser ------------------------------------------------- */
function parseInto(host, html) {
  const stack = [host];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let last = 0, m;
  const addText = t => {
    const s = t.replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
               .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (s.trim()) stack[stack.length - 1].text += s;
  };
  while ((m = re.exec(html))) {
    if (m.index > last) addText(html.slice(last, m.index));
    last = re.lastIndex;
    const [, closing, tag, attrs, selfClose] = m;
    const lower = tag.toLowerCase();
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new El(tag);
    (attrs.match(/[a-zA-Z-]+(?:="[^"]*")?/g) || []).forEach(a => {
      const i = a.indexOf('=');
      if (i === -1) el.setAttribute(a, '');
      else el.setAttribute(a.slice(0, i), a.slice(i + 2, -1));
    });
    stack[stack.length - 1].appendChild(el);
    if (!selfClose && !VOID[lower]) stack.push(el);
  }
  if (last < html.length) addText(html.slice(last));
  return host;
}
module.exports = { El, matches, parseInto };
