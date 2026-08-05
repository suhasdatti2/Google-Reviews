/* Questions the store's own pages do NOT answer. The assistant should reason
   and help - while still never inventing an Optiq price, policy or spec. */
const fs = require('fs'), vm = require('vm');
const SRC = require('./paths');
const payload = fs.readFileSync(SRC.payload, 'utf8');
const g = {}; g.window = g; g.addEventListener = () => {}; g.setTimeout = setTimeout;
g.document = { readyState: 'complete', body: { classList: { add(){}, remove(){} } },
  getElementById: id => id === 'optiq-ai-data' ? { textContent: payload } : null,
  querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
  createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, querySelector(){return{innerHTML:''}}, setAttribute(){}, addEventListener(){} }) };
vm.createContext(g); vm.runInContext(fs.readFileSync(SRC.js, 'utf8'), g);
const AI = g.window.OptiqAI;
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const data = JSON.parse(payload);
const allowed = new Set();
data.products.forEach(p => { allowed.add(p.priceMinText); allowed.add(p.priceMaxText);
  (p.variants || []).forEach(v => allowed.add(v.priceText)); });

let fails = 0, invented = [];
let checkPrices = true;   // derived arithmetic is expected to produce new numbers
function ask(q, want, label) {
  AI.reset();
  const a = strip(AI.respond(q));
  const ok = want.test(a) && a.length > 60;
  console.log((ok ? 'ok   ' : 'FAIL ') + q);
  console.log('     ' + a.slice(0, 190) + (a.length > 190 ? '…' : '') + '\n');
  if (!ok) fails++;
  if (checkPrices) (a.match(/\$[\d,]+\.\d{2}/g) || []).forEach(m => { if (!allowed.has(m)) invented.push(q + ' -> ' + m); });
  return a;
}

console.log('=== general knowledge (not in the store) ===\n');
ask('what is NFC exactly?', /near field|radio|passive/i);
ask('will this work on an iPhone 12?', /iphone|xs|unlocked/i);
ask('my android isnt reading the card, whats wrong?', /nfc is off|settings|antenna|case/i);
ask('does the card need a battery?', /passive|no battery|nothing to charge/i);
ask('is NFC safe? can it steal my data?', /read-only|can't pull|learns nothing/i);
ask('can I offer customers a free coffee for leaving a review?', /prohibit|incentive|against/i);
ask('someone left me a fake 1 star review, can I delete it?', /can't delete|flag|policies/i);
ask('why do google reviews even matter?', /relevance, distance|prominence|ranking/i);
ask('how do I find my google review link?', /business profile|ask for reviews|maps/i);
ask('what should my staff actually say to customers?', /glad you|ten seconds|gesturing|ask/i);
ask('should I only ask happy customers for reviews?', /gating|against|same for everyone/i);
ask('where is the best place to put the card?', /arm's reach|till|counter|reception/i);
ask('how many reviews do I need to rank well?', /no threshold|relative|steady/i);
ask('I have 3 shops, how does that work?', /own google business profile|per site|location/i);
ask('does NFC work in other countries?', /global standard|reads identically/i);

console.log('=== reasoning over real prices ===\n');
checkPrices = false;   // these answers legitimately compute new figures
ask('how much would 50 cards be?', /50-card|per card/i);
ask('what is the cost per card if I buy 100?', /per card/i);
ask("I've got about $200 to spend, what can I get?", /within budget|starting prices/i);
ask('how much is hosting over 12 months?', /12 months|\$59\.88/i);

// The arithmetic must be right, not merely present.
const hosting = data.products.find(p => /hosting/i.test(p.title));
const bulk = data.products.find(p => /bulk square/i.test(p.title));
const hundred = bulk.variants.filter(v => v.options.some(o => /^100 /.test(o))).sort((a,b)=>a.price-b.price)[0];
const expectYear = '$' + (hosting.priceMin * 12 / 100).toFixed(2);
const expectPer = '$' + (hundred.price / 100 / 100).toFixed(2);
const yearAns = strip(AI.respond('how much is hosting over 12 months?'));
AI.reset();
const perAns = strip(AI.respond('what is the cost per card if I buy 100?'));
console.log('12 x ' + hosting.priceMinText + ' should be ' + expectYear + ' -> ' + (yearAns.indexOf(expectYear) > -1 ? 'correct' : 'WRONG: ' + yearAns.slice(0,120)));
if (yearAns.indexOf(expectYear) === -1) fails++;
console.log(hundred.priceText + ' / 100 should be ' + expectPer + ' -> ' + (perAns.indexOf(expectPer) > -1 ? 'correct' : 'WRONG: ' + perAns.slice(0,120)));
if (perAns.indexOf(expectPer) === -1) fails++;
console.log('');

checkPrices = true;
console.log('=== still refuses to invent ===\n');
const r1 = ask('do you sell dog food?', /don't have a good answer|can't answer properly/i);
const r2 = ask('what is the capital of Mongolia?', /don't have a good answer|can't answer properly/i);
console.log('prices invented anywhere above: ' + (invented.length ? invented.join(', ') : 'none'));
if (invented.length) fails++;
console.log('\n=== ' + (fails ? fails + ' FAILED' : 'all general-knowledge checks passed') + ' ===');
process.exit(fails ? 1 : 0);
