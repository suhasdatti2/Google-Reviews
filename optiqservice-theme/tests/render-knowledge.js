/* Renders snippets/optiq-ai-knowledge.liquid against the REAL current store
   data and asserts the payload is valid JSON. This is the check that was
   missing: the widget was dead because the rendered payload didn't parse. */
const { Liquid } = require('liquidjs');
const SRC = require('./paths');
const fs = require('fs');

const cents = a => Math.round(parseFloat(a) * 100);
const money = c => '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const store = JSON.parse(fs.readFileSync(__dirname + '/store-live.json', 'utf8'));

const products = store.products.nodes
  .filter(p => p.status === 'ACTIVE')          // collections.all excludes archived
  .map(p => {
    const prices = p.variants.nodes.map(v => cents(v.price));
    const compares = p.variants.nodes.map(v => v.compareAtPrice ? cents(v.compareAtPrice) : 0);
    return {
      title: p.title, handle: p.handle, url: '/products/' + p.handle,
      type: p.productType, vendor: p.vendor, tags: p.tags, description: p.description,
      available: p.variants.nodes.some(v => v.availableForSale),
      price_min: Math.min.apply(null, prices), price_max: Math.max.apply(null, prices),
      compare_at_price_max: Math.max.apply(null, compares),
      // Real store: Card Hosting and AI Receptionist have NO image.
      featured_image: ['card-hosting','ai-receptionist'].indexOf(p.handle) > -1 ? null : { alt: p.title },
      options_with_values: p.options.map(o => ({ name: o.name, values: o.optionValues.map(v => v.name) })),
      variants: p.variants.nodes.map(v => ({
        title: v.title, price: cents(v.price), available: v.availableForSale,
        options: v.selectedOptions.map(s => s.value)
      })),
      collections: p.collections.nodes.map(c => ({ title: c.title }))
    };
  });

const ctx = {
  shop: {
    name: store.shop.name, url: 'https://optiq.shop', money_format: '${{amount}}',
    // The live store has ONE policy configured; the rest come back blank.
    // This is exactly the shape that used to emit a trailing comma.
    policies: [
      { title: 'Privacy policy', url: '/policies/privacy-policy', body: '<p>We collect personal information...</p>' },
      '', '', ''
    ]
  },
  cart: { currency: { iso_code: 'USD' } },
  customer: null,
  collections: { all: { products } },
  pages: store.pages.nodes.map(p => ({
    title: p.title, handle: p.handle, url: '/pages/' + p.handle, content: '<p>' + p.title + ' body</p>'
  })),
  blogs: store.blogs.nodes.map(b => ({ articles: b.articles.nodes })),   // news blog: zero articles
  routes: {
    root_url: '/', cart_url: '/cart', search_url: '/search', account_url: '/account',
    all_products_collection_url: '/collections/all'
  }
};

// catchAllErrors mirrors Shopify: a filter error replaces the WHOLE output
// tag with error text, so the trailing | json never runs and the value lands
// unquoted in the payload. This is what actually broke the widget.
const engine = new Liquid({ strictFilters: false, strictVariables: false, catchAllErrors: true });
engine.registerFilter('json', v => JSON.stringify(v === undefined ? null : v));
engine.registerFilter('strip_html', v => String(v == null ? '' : v).replace(/<[^>]*>/g, ''));
engine.registerFilter('strip_newlines', v => String(v == null ? '' : v).replace(/[\r\n]+/g, ''));
engine.registerFilter('truncate', (v, n, e) => {
  const s = String(v == null ? '' : v); const end = e === undefined ? '...' : e;
  return s.length <= n ? s : s.slice(0, n - end.length) + end;
});
engine.registerFilter('money', v => money(Number(v) || 0));
// Shopify's image_url RAISES on a nil image and prints the error into the
// output. Emulate that exactly - a forgiving stub is what hid this bug.
engine.registerFilter('image_url', v => {
  if (!v) throw new Error('invalid url input');   // Shopify raises here
  return 'https://cdn.shopify.com/img_200x.png';
});
engine.registerFilter('default', (v, d) => (v === undefined || v === null || v === '' || v === false ? d : v));

const tpl = fs.readFileSync(SRC.knowledge, 'utf8');

engine.parseAndRender(tpl, ctx).then(out => {
  const m = out.match(/<script type="application\/json" id="optiq-ai-data">([\s\S]*?)<\/script>/);
  if (!m) { console.log('FAIL: script tag not found'); process.exit(1); }
  const raw = m[1];
  fs.writeFileSync(__dirname + '/rendered-knowledge.json', raw.trim());
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.log('FAIL: payload does not parse -> ' + e.message);
    const pos = parseInt((e.message.match(/position (\d+)/) || [])[1] || '0', 10);
    console.log('near: ' + JSON.stringify(raw.slice(Math.max(0, pos - 120), pos + 120)));
    process.exit(1);
  }
  console.log('PASS  payload parses (' + raw.trim().length + ' bytes)');
  console.log('      ok sentinel:  ' + data.ok);
  console.log('      products:     ' + data.products.length + '  -> ' + data.products.map(p => p.title).join(' | '));
  console.log('      pages:        ' + data.pages.length + '  -> ' + data.pages.map(p => p.handle).join(', '));
  console.log('      policies:     ' + data.policies.length + '  (blank entries skipped, no trailing comma)');
  console.log('      articles:     ' + data.articles.length + '  (empty blog, no trailing comma)');
  console.log('      facts:        ' + data.facts.length);
  console.log('      sample price: ' + data.products[0].title + ' ' + data.products[0].priceMinText + ' - ' + data.products[0].priceMaxText);
  const archived = data.products.some(p => /jersey/i.test(p.title));
  console.log('      archived product leaked: ' + archived);
  fs.writeFileSync(SRC.payload, JSON.stringify(data));
  process.exit(archived ? 1 : 0);
}).catch(e => { console.log('FAIL render: ' + e.message); process.exit(1); });
