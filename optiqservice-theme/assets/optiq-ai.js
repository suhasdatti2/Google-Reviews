/* ==========================================================================
   OPTIQ AI - storefront assistant
   --------------------------------------------------------------------------
   Reads snippets/optiq-ai-knowledge.liquid (rendered fresh by Liquid on every
   page load) and answers customer questions from it.

   GROUNDING RULE - the whole design rests on this:
   every sentence this file can produce is either (a) fixed conversational
   scaffolding written here, or (b) a value copied verbatim out of the
   knowledge payload. There is no generative text path, so it cannot invent a
   price, a policy, a product, a spec or a link. When retrieval confidence is
   below threshold it says it doesn't know and hands off to support - that is
   the designed behaviour, not a failure mode.

   Capabilities: intent detection, product resolution, conversational memory
   (pronouns resolve to the products already under discussion), price and
   availability lookup, product comparison, needs-based recommendation, option
   / colour / size lookup, policy + FAQ retrieval, and site navigation.
   ========================================================================== */
(function () {
  "use strict";

  /* ----------------------------------------------------------- knowledge */
  /* The payload carries an "ok": true sentinel as its final key, so a payload
     that was truncated mid-render fails this check instead of silently
     answering from half a catalogue.

     Nothing below is allowed to abort the script. If the knowledge index is
     missing or unparseable the assistant still opens, still talks, and says
     plainly that it can't reach the catalogue right now - a broken index must
     never leave the customer with a dead button. */
  var KNOWLEDGE_OK = false;
  var KNOWLEDGE_ERROR = null;
  var DATA = null;

  // Liquid-generated JSON fails in exactly two ways: a comma left where an
  // entry got skipped, and a filter error printed unquoted into the payload.
  // Repair pass one, refuse pass two - a value we can't read is never guessed.
  function repair(text) {
    var out = "", inStr = false, esc = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (inStr) {
        out += c;
        if (esc) { esc = false; }
        else if (c === "\\") { esc = true; }
        else if (c === '"') { inStr = false; }
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ",") {
        var j = i + 1;
        while (j < text.length && /\s/.test(text.charAt(j))) j++;
        var nxt = text.charAt(j);
        if (nxt === "]" || nxt === "}" || nxt === ",") continue;  // drop it
      }
      out += c;
    }
    return out;
  }

  try {
    var el = document.getElementById("optiq-ai-data");
    if (!el) {
      KNOWLEDGE_ERROR = "knowledge snippet not rendered";
    } else {
      var raw = el.textContent;
      try {
        DATA = JSON.parse(raw);
      } catch (e1) {
        try {
          DATA = JSON.parse(repair(raw));
          KNOWLEDGE_ERROR = "payload needed repair: " + e1.message;
        } catch (e2) {
          KNOWLEDGE_ERROR = "payload unparseable: " + e2.message;
        }
      }
    }
  } catch (e) { KNOWLEDGE_ERROR = "payload read failed: " + e.message; }

  if (DATA && DATA.ok === true && DATA.products && DATA.products.length) {
    KNOWLEDGE_OK = true;
  } else if (DATA && !KNOWLEDGE_ERROR) {
    KNOWLEDGE_ERROR = "payload incomplete (missing ok sentinel or products)";
  }
  if (!DATA || typeof DATA !== "object") DATA = {};
  DATA.shop = DATA.shop || {};
  DATA.customer = DATA.customer || {};
  DATA.routes = DATA.routes || {};
  ["products", "pages", "policies", "articles", "facts"].forEach(function (k) {
    if (!Array.isArray(DATA[k])) DATA[k] = [];
  });

  var SUPPORT = DATA.shop.email || "sales@optiqservice.com";

  /* ------------------------------------------------------------ language */
  // A word-boundary string split on " " yields bare words, so the old
  // `STOP.indexOf(" " + w + " ")` lookup could never match and every stopword
  // was being scored. Kept as an object so the lookup is unambiguous.
  var STOP = {};
  "a an and are as at be but by can could do does for from get got has have how i if in is it its me my of on or our so that the their them then there these they this to us was we what when where which who why will with you your"
    .split(" ").forEach(function (w) { STOP[w] = 1; });

  // Query words -> extra tokens, so customer phrasing reaches store wording.
  var SYN = {
    cost: ["price"], costs: ["price"], pricing: ["price"], cheap: ["price"],
    cheaper: ["price"], cheapest: ["price"], expensive: ["price"], much: ["price"],
    afford: ["price"], budget: ["price"],
    buy: ["order"], purchase: ["order"], checkout: ["order"],
    stock: ["available"], instock: ["available"], availability: ["available"],
    delivery: ["shipping"], deliver: ["shipping"], arrive: ["shipping"],
    dispatch: ["shipping"], post: ["shipping"], mail: ["shipping"],
    refund: ["return"], refunds: ["return"], exchange: ["return"],
    money: ["return"], back: ["return"],
    colour: ["color"], colours: ["color"], colors: ["color"],
    phone: ["call"], calls: ["call"], calling: ["call"], telephone: ["call"],
    receptionist: ["ai"], assistant: ["ai"], answering: ["ai"],
    nfc: ["card", "tap"], tap: ["card"], sticker: ["card"],
    google: ["review"], yelp: ["review"], reviews: ["review"],
    desk: ["counter"], register: ["counter"],
    subscription: ["monthly"], membership: ["monthly"], plan: ["monthly"],
    difference: ["compare"], differences: ["compare"], versus: ["compare"],
    vs: ["compare"], between: ["compare"], recommend: ["best"],
    suggest: ["best"], suited: ["best"], suitable: ["best"]
  };

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
  }

  function stem(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 3 && /(sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function tokens(s, expand) {
    var raw = norm(s).split(" ").filter(Boolean);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i];
      if (STOP[w]) continue;
      out.push(stem(w));
      if (expand && SYN[w]) for (var j = 0; j < SYN[w].length; j++) out.push(stem(SYN[w][j]));
    }
    var seen = {}, uniq = [];
    for (var k = 0; k < out.length; k++) {
      if (!seen[out[k]]) { seen[out[k]] = 1; uniq.push(out[k]); }
    }
    return uniq;
  }

  /* ------------------------------------------------------ product index */
  var PRODUCTS = DATA.products.map(function (p) {
    var bag = [p.title, p.type, p.handle.replace(/-/g, " "), (p.tags || []).join(" "), p.description];
    (p.options || []).forEach(function (o) { bag.push(o.name + " " + (o.values || []).join(" ")); });
    p._tokens = tokens(bag.join(" "), false);
    p._freq = {};
    p._tokens.forEach(function (t) { p._freq[t] = (p._freq[t] || 0) + 1; });
    p._titleTokens = tokens(p.title + " " + p.handle.replace(/-/g, " "), false);
    return p;
  });

  function byHandle(h) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].handle === h) return PRODUCTS[i];
    return null;
  }

  // Shorthand customers actually type. Only resolves if the product exists.
  // Deliberately kept distinctive - words shared by several products (e.g.
  // "card", "pack", "plan") are NOT aliases, or every query would match
  // everything and the assistant would answer about the wrong item.
  var ALIASES = [
    { h: "google-review-nfc-card", w: ["counter", "main", "premium", "single"] },
    { h: "bulk-review-cards", w: ["bulk", "mini", "handout", "square"] },
    { h: "bulk-restaurant-pack", w: ["restaurant", "combo", "bundle"] },
    { h: "review-growth-plan", w: ["growth", "membership"] },
    { h: "card-hosting", w: ["hosting", "host"] },
    { h: "ai-receptionist", w: ["receptionist", "answering"] }
  ];

  function scoreProducts(q) {
    var qt = tokens(q, true);
    var raw = norm(q);
    if (!qt.length) return [];

    var scores = PRODUCTS.map(function (p) {
      var s = 0;
      // Whole-title phrase match is the strongest possible signal.
      var tn = norm(p.title);
      if (tn && raw.indexOf(tn) > -1) s += 14;
      qt.forEach(function (t) {
        if (p._freq[t]) s += Math.min(p._freq[t], 3) * 0.8;
        if (p._titleTokens.indexOf(t) > -1) s += 3.5;
      });
      ALIASES.forEach(function (a) {
        if (a.h !== p.handle) return;
        a.w.forEach(function (w) { if (qt.indexOf(stem(w)) > -1) s += 6; });
      });
      return { p: p, s: s };
    }).sort(function (a, b) { return b.s - a.s; });

    var top = scores[0];
    if (!top || top.s < 5) return [];                 // nothing convincing
    // Dominance filter: keep only products close to the best match, so a
    // generic word like "card" can't drag the whole catalogue into an answer.
    return scores.filter(function (x) { return x.s >= top.s * 0.72; });
  }

  /* --------------------------------------------------------- fact index */
  var FACTS = (DATA.facts || []).map(function (f) {
    f._topicTokens = (f.topics || []).map(function (t) { return stem(norm(t)); });
    f._qt = tokens(f.q, false);
    return f;
  });

  // pool defaults to everything; pass an intent-filtered pool for a
  // deterministic lookup once the intent is already known.
  function scoreFacts(q, pool) {
    var list = pool && pool.length ? pool : FACTS;
    var qt = tokens(q, true);
    var raw = norm(q);
    return list.map(function (f) {
      var s = 0;
      (f.topics || []).forEach(function (t) {
        var tn = norm(t);
        if (!tn) return;
        if (tn.indexOf(" ") > -1) {                     // multi-word topic
          if (raw.indexOf(tn) > -1) s += 7;
        } else if (qt.indexOf(stem(tn)) > -1) {
          s += 3;
        }
      });
      qt.forEach(function (t) { if (f._qt.indexOf(t) > -1) s += 1; });
      return { f: f, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
  }

  function factsFor(intent) {
    return FACTS.filter(function (f) { return f.intent === intent; });
  }

  // Intent-scoped: the intent already establishes the subject, so a lower bar
  // is safe here. Returns null rather than guessing when nothing fits.
  function factByIntent(q, intent) {
    var pool = factsFor(intent);
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    var r = scoreFacts(q, pool);
    return r.length && r[0].s >= 2 ? r[0].f : null;
  }

  /* ------------------------------------------------------------ intents */
  function intentOf(q) {
    var t = norm(q);
    var has = function () {
      for (var i = 0; i < arguments.length; i++) if (t.indexOf(arguments[i]) > -1) return true;
      return false;
    };
    if (/^(hi|hey|hello|yo|sup|heya|howdy|good (morning|afternoon|evening))\b/.test(t)) return "greeting";
    if (has("thank", "thanks", "cheers", "appreciate")) return "thanks";
    // Small talk gets a real answer instead of being forced through retrieval
    // and coming back as an unrelated product blurb.
    if (has("how are you", "how's it going", "hows it going", "how you doing", "you good")) return "howareyou";
    if (has("are you a bot", "are you real", "are you human", "are you an ai", "is this a bot",
            "who made you", "who built you", "are you chatgpt", "real person")) return "whatareyou";
    if (has("what can you do", "what do you know", "how can you help", "what can you help",
            "can you help me", "what are you for")) return "capabilities";
    if (/^(ok|okay|k|cool|nice|great|sure|right|got it|gotcha|fine|alright|lol|haha|yep|yeah|no|nope|hmm)\b/.test(t) && t.length < 14) return "ack";
    if (/^help\b/.test(t) || t === "help me") return "capabilities";
    if (has("what makes optiq", "makes optiq different", "why optiq", "what makes you different", "who is optiq for", "optiq different")) return "brand";
    if (has("discount", "promo", "promotion", "coupon", "deal", "voucher", "sale on")) return "discounts";
    if (has("monthly fee", "subscription fee", "recurring", "every month", "per month", "monthly cost")) return "monthlyfee";
    if (has("difference", "differ", "compare", "versus", " vs ", "vs.", "better than", "or the")) return "compare";
    if (has("recommend", "suggest", "which one should", "which should", "best for", "good for", "right for", "suited", "help me choose", "what should i")) return "recommend";
    if (has("how much", "price", "cost", "pricing", "cheaper", "cheapest", "expensive")) return "price";
    if (has("in stock", "available", "availability", "sold out", "back in")) return "availability";
    if (has("color", "colour", "size", "sizes", "option", "variant", "black", "white", "come in")) return "options";
    if (has("ship", "delivery", "deliver", "arrive", "how long", "tracking", "track")) return "shipping";
    if (has("return", "refund", "exchange", "cancel", "faulty", "broken", "damaged")) return "returns";
    if (has("contact", "email", "reach you", "speak to", "talk to", "human", "support")) return "contact";
    if (has("where can i find", "where is", "where do i", "find your", "link to", "take me")) return "navigate";
    if (has("what is optiq", "about optiq", "who are you", "tell me about", "what do you do", "what does optiq")) return "brand";
    if (has("how do i order", "place an order", "how to buy", "how do i buy", "checkout")) return "order";
    if (has("payment", "pay", "visa", "mastercard", "paypal", "apple pay", "google pay", "shop pay")) return "payment";
    if (has("sign in", "log in", "login", "account", "dashboard", "password")) return "account";
    if (has("what do you sell", "what products", "everything you", "your products", "list", "catalog", "catalogue", "show me")) return "catalog";
    return "general";
  }

  /* ------------------------------------------------- conversation memory */
  var MEM = { products: [], lastIntent: null, nudgedLast: false };

  function remember(list) {
    if (!list || !list.length) return;
    MEM.products = list.slice(0, 3);
  }

  var PRONOUN = /\b(it|its|it's|that|this|those|these|them|they|one|ones|the other|either)\b/;

  function resolve(q) {
    var found = scoreProducts(q).map(function (x) { return x.p; });
    if (found.length) { remember(found); return found; }
    if (PRONOUN.test(norm(q)) && MEM.products.length) return MEM.products.slice();
    return [];
  }

  /* ----------------------------------------------------------- rendering */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function link(url, label) {
    return '<a href="' + esc(url) + '">' + esc(label) + "</a>";
  }

  function priceLine(p) {
    if (p.priceMin === p.priceMax) return p.priceMinText;
    return "from " + p.priceMinText + " to " + p.priceMaxText;
  }

  function productCard(p) {
    var sale = p.onSale ? ' <span class="oqa-sale">was ' + esc(p.compareAtText) + "</span>" : "";
    return '<div class="oqa-card">' +
      (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : "") +
      '<div class="oqa-card__x"><b>' + esc(p.title) + "</b>" +
      '<span class="oqa-price">' + esc(priceLine(p)) + sale + "</span>" +
      '<a class="oqa-cta" href="' + esc(p.url) + '">View product</a></div></div>';
  }

  function askSupport() {
    return "I can't find that on the Optiq site right now, so I'd rather not guess. Email " +
      link("mailto:" + SUPPORT, SUPPORT) + " and the team will give you a definitive answer - they reply within one business day.";
  }

  // Shown for every question when the live knowledge index didn't load. It
  // offers real destinations instead of inventing an answer from memory.
  function degraded() {
    var contact = (DATA.routes && DATA.routes.contact) || "/pages/contact";
    return "<p>I can't reach the Optiq catalogue from this page right now, so I won't guess at prices, " +
      "policies or availability.</p><p>Try " + link("/collections/all", "browsing the products") +
      ", the " + link(contact, "contact page") + ", or email " + link("mailto:" + SUPPORT, SUPPORT) +
      " - the team replies within one business day.</p>";
  }

  /* ------------------------------------------------------------- answers */
  function answerPrice(list) {
    if (!list.length) return null;
    if (list.length === 1) {
      var p = list[0];
      var out = "<p><b>" + esc(p.title) + "</b> is " + esc(priceLine(p)) + ".";
      if (p.onSale) out += " It's currently reduced from " + esc(p.compareAtText) + ".";
      out += "</p>";
      if (p.variants && p.variants.length > 1 && p.priceMin !== p.priceMax) {
        out += "<p>Price depends on the options you pick:</p><ul>";
        var seen = {}, n = 0;
        p.variants.forEach(function (v) {
          if (n >= 6 || seen[v.priceText]) return;
          seen[v.priceText] = 1; n++;
          out += "<li>" + esc(v.title) + " - <b>" + esc(v.priceText) + "</b></li>";
        });
        out += "</ul>";
      }
      return out + productCard(p);
    }
    var sorted = list.slice().sort(function (a, b) { return a.priceMin - b.priceMin; });
    var s = "<p>Here's how they compare on price:</p><ul>";
    sorted.forEach(function (p) { s += "<li><b>" + esc(p.title) + "</b> - " + esc(priceLine(p)) + "</li>"; });
    s += "</ul><p>" + esc(sorted[0].title) + " is the lower-priced option.</p>";
    return s + sorted.map(productCard).join("");
  }

  function answerAvailability(list, q) {
    if (!list.length) return null;
    // Unless they clearly asked about more than one, answer about the single
    // best match rather than listing every product that shared a word.
    var many = /\b(both|and|all|each|any of)\b/.test(norm(q || ""));
    var s = "";
    list.slice(0, many ? 3 : 1).forEach(function (p) {
      s += "<p><b>" + esc(p.title) + "</b> is " +
        (p.available ? "available to order now" : "not available to order right now") + ".";
      if (p.available && p.variants) {
        var out = p.variants.filter(function (v) { return !v.available; });
        if (out.length) s += " Some option combinations are unavailable, and the product page shows which.";
      }
      s += "</p>" + productCard(p);
    });
    return s;
  }

  function answerOptions(list, q) {
    if (!list.length) return null;
    var p = list[0];
    if (!p.options || !p.options.length ||
        (p.options.length === 1 && /default/i.test(p.options[0].name))) {
      return "<p><b>" + esc(p.title) + "</b> comes one way - there are no size or colour options to choose.</p>" + productCard(p);
    }
    var qn = norm(q), s = "";
    // If they named a specific value ("does it come in black"), answer directly.
    var hit = null;
    p.options.forEach(function (o) {
      (o.values || []).forEach(function (v) {
        if (qn.indexOf(norm(v)) > -1 && norm(v).length > 2) hit = { o: o, v: v };
      });
    });
    if (hit) {
      s += "<p>Yes - <b>" + esc(hit.v) + "</b> is one of the " + esc(hit.o.name).toLowerCase() +
        " options for <b>" + esc(p.title) + "</b>.</p>";
    }
    s += "<p><b>" + esc(p.title) + "</b> options:</p><ul>";
    p.options.forEach(function (o) {
      s += "<li><b>" + esc(o.name) + ":</b> " + esc((o.values || []).join(", ")) + "</li>";
    });
    s += "</ul>";
    return s + productCard(p);
  }

  function answerCompare(list) {
    if (list.length < 2) return null;
    var a = list[0], b = list[1];
    var s = "<p>Here's <b>" + esc(a.title) + "</b> next to <b>" + esc(b.title) + "</b>:</p>";
    s += '<table class="oqa-tbl"><tr><th></th><th>' + esc(a.title) + "</th><th>" + esc(b.title) + "</th></tr>";
    s += "<tr><td>Price</td><td>" + esc(priceLine(a)) + "</td><td>" + esc(priceLine(b)) + "</td></tr>";
    s += "<tr><td>Available</td><td>" + (a.available ? "Yes" : "No") + "</td><td>" + (b.available ? "Yes" : "No") + "</td></tr>";
    var optName = function (p) {
      if (!p.options || !p.options.length) return "-";
      var n = p.options.filter(function (o) { return !/default/i.test(o.name); })
        .map(function (o) { return o.name + " (" + (o.values || []).length + ")"; });
      return n.length ? n.join(", ") : "-";
    };
    s += "<tr><td>Options</td><td>" + esc(optName(a)) + "</td><td>" + esc(optName(b)) + "</td></tr>";
    s += "</table>";

    // If the store has an explicit written comparison, prefer its wording.
    var f = null;
    FACTS.forEach(function (x) { if (x.id === "counter-vs-bulk") f = x; });
    var handles = [a.handle, b.handle];
    if (f && handles.indexOf("google-review-nfc-card") > -1 && handles.indexOf("bulk-review-cards") > -1) {
      s += "<p>" + esc(f.a) + "</p>";
    }
    return s + productCard(a) + productCard(b);
  }

  // Needs-based recommendation, matched against real product text.
  var NEEDS = [
    { w: ["restaurant", "takeout", "cafe", "food", "bag", "bill", "receipt", "delivery"], h: ["bulk-restaurant-pack", "bulk-review-cards"],
      why: "you're serving a lot of customers who leave with their order" },
    { w: ["barber", "salon", "spa", "counter", "desk", "register", "front", "checkout", "station"], h: ["google-review-nfc-card"],
      why: "you want one premium card that lives on the counter" },
    { w: ["many", "lots", "bulk", "volume", "handout", "hand out", "give away", "cheap", "cheapest", "budget"], h: ["bulk-review-cards"],
      why: "you want the lowest cost per card to hand out" },
    { w: ["call", "phone", "missed", "answer", "booking", "appointment", "receptionist", "24/7", "after hours"], h: ["ai-receptionist"],
      why: "your issue is calls going unanswered rather than reviews" },
    { w: ["both", "everything", "complete", "full", "all"], h: ["bulk-restaurant-pack"],
      why: "you want counter and handout covered in one purchase" }
  ];

  // First sentence of a description, without regex lookbehind (Safari-safe).
  function firstSentence(text) {
    var s = String(text || "").trim();
    var i = s.indexOf(". ");
    if (i > 20) return s.slice(0, i + 1);
    return s.length > 200 ? s.slice(0, 200).replace(/\s+\S*$/, "") + "..." : s;
  }

  function answerRecommend(q) {
    var qn = norm(q), picks = [], why = "";
    NEEDS.forEach(function (n) {
      if (why) return;
      for (var i = 0; i < n.w.length; i++) {
        if (qn.indexOf(n.w[i]) > -1) {
          n.h.forEach(function (h) { var p = byHandle(h); if (p) picks.push(p); });
          why = n.why; return;
        }
      }
    });
    if (!picks.length) {
      var sc = scoreProducts(q);
      picks = sc.slice(0, 2).map(function (x) { return x.p; });
    }
    if (!picks.length) {
      return "<p>Happy to help you pick. A couple of quick things and I can point you straight at the right one:</p>" +
        "<ul><li>Are you after more <b>Google reviews</b>, or help <b>answering phone calls</b>?</li>" +
        "<li>If it's reviews - do you want one card that stays on your <b>counter</b>, or a stack to <b>hand out</b> to customers?</li></ul>" +
        "<p>You can also see everything on the " + link(DATA.routes.reviewCards || "/", "review cards page") + ".</p>";
    }
    remember(picks);
    var s = "<p>Based on what you've described" + (why ? " - " + esc(why) : "") + " - here's what I'd point you at:</p>";
    picks.slice(0, 2).forEach(function (p) {
      s += "<p><b>" + esc(p.title) + "</b> (" + esc(priceLine(p)) + "). " +
        esc(firstSentence(p.description)) + "</p>" + productCard(p);
    });
    s += "<p>If you tell me a bit more about your business I can narrow it further, or email " +
      link("mailto:" + SUPPORT, SUPPORT) + " for a recommendation from the team.</p>";
    return s;
  }

  function answerCatalog() {
    var s = "<p>Here's everything Optiq currently sells:</p>";
    PRODUCTS.forEach(function (p) { s += productCard(p); });
    remember(PRODUCTS);
    return s;
  }

  function answerNavigate(q) {
    var qt = tokens(q, true), best = null, bs = 0;
    (DATA.pages || []).forEach(function (pg) {
      var t = tokens(pg.title, false), s = 0;
      qt.forEach(function (x) { if (t.indexOf(x) > -1) s += 3; });
      if (s > bs) { bs = s; best = pg; }
    });
    (DATA.policies || []).forEach(function (po) {
      var t = tokens(po.title, false), s = 0;
      qt.forEach(function (x) { if (t.indexOf(x) > -1) s += 3; });
      if (s > bs) { bs = s; best = { title: po.title, url: po.url }; }
    });
    if (best && bs >= 3) return "<p>You'll find that here: " + link(best.url, best.title) + "</p>";
    return null;
  }

  function renderFact(f) {
    if (!f) return null;
    var s = "<p>" + esc(f.a) + "</p>";
    if (f.url) s += "<p>" + link(f.url, "More detail here") + "</p>";
    return s;
  }

  // Open-ended lookup across every fact. Needs a genuinely strong match,
  // otherwise we would rather say we don't know.
  function answerFact(q, minScore) {
    var r = scoreFacts(q);
    var bar = typeof minScore === "number" ? minScore : 6;
    if (!r.length || r[0].s < bar) return null;
    return renderFact(r[0].f);
  }

  /* --------------------------------------------------------------- brain */

  /* ================================================================ general
     Everything above answers from the store payload. This block is the
     opposite: general, non-store knowledge written here so the assistant can
     reason and actually help with the questions the shop's own pages don't
     cover - how NFC works, how Google reviews work, what to say to customers,
     and arithmetic over real prices.

     The grounding rule is unchanged, and enforced by construction: no entry
     below states an Optiq price, policy, spec, availability or guarantee.
     Store facts still only ever come out of the payload, verbatim. These
     answers are author-written HTML, not customer input, so they are not
     escaped on the way out.
     ==================================================================== */
  var GENERAL = [
    { k: ["what is nfc", "nfc", "near field communication", "how does the chip work", "what is the chip"],
      a: "<p>NFC stands for Near Field Communication. It's a short-range radio standard - about 4cm of range - that's already in every modern smartphone and in contactless bank cards.</p>" +
         "<p>A review card contains a passive NFC tag: a tiny antenna and a chip holding a web address. It has no battery. When a phone comes close, the phone's own radio field powers the chip just long enough for it to hand over the link, and the phone offers to open it.</p>" },

    { k: ["need an app", "download an app", "app required", "without an app", "do i need an app"],
      a: "<p>No app is involved on either side. NFC reading is built into the phone's operating system, so the link surfaces as a notification the customer taps.</p>" +
         "<p>That's the main practical advantage over anything app-based: the person tapping doesn't have to install, sign up, or already be a customer of anything.</p>" },

    { k: ["iphone", "apple", "ios", "work on iphone", "does it work with iphone", "iphones"],
      a: "<p>iPhones have read NFC tags since the iPhone 7. On the iPhone XS and newer it's automatic - if the screen is on and unlocked, holding the top of the phone near the tag pops up a notification, with nothing open.</p>" +
         "<p>On iPhone 7 and 8 the reader isn't always running in the background, so those users may need to start a scan from Control Centre. In practice that's a shrinking slice of customers.</p>" },

    { k: ["android", "samsung", "pixel", "work on android", "does it work with android"],
      a: "<p>Effectively every Android phone sold in the last decade has NFC, and it's normally switched on out of the box. Hold the back of the phone - usually the upper middle - against the tag and the link appears.</p>" +
         "<p>If nothing happens, NFC has almost always been turned off. It lives under Settings, then Connected devices or Connections.</p>" },

    { k: ["nothing happens", "not working", "doesn't work", "wont work", "no notification", "not scanning", "not reading", "troubleshoot", "reading", "wrong", "isnt reading", "not reading the card", "wont read", "card not working", "unresponsive"],
      a: "<p>Nine times out of ten it's one of four things, in this order:</p><ul>" +
         "<li><b>NFC is off.</b> Common on Android, and the fastest thing to rule out.</li>" +
         "<li><b>Wrong part of the phone.</b> The antenna is near the top on iPhones and mid-to-upper back on most Androids - not the centre.</li>" +
         "<li><b>Too quick.</b> Hold still for a second rather than swiping past.</li>" +
         "<li><b>The case.</b> Thick, metal, or wallet cases with cards stacked inside can block the field.</li></ul>" +
         "<p>If it reads on one phone and not another, it's the phone, not the card.</p>" },

    { k: ["battery", "charge", "power", "does it need power", "recharge", "need a battery", "batteries", "charging"],
      a: "<p>None. The tag is passive - it has no battery and nothing to charge. The phone's own NFC field supplies the trickle of power the chip needs for the fraction of a second it's transmitting.</p>" +
         "<p>That's also why there's nothing to wear out electrically: the failure mode for a card is physical damage, not a flat battery.</p>" },

    { k: ["wifi", "internet", "data", "signal", "offline", "need internet"],
      a: "<p>The tap itself works offline - the chip is just handing the phone a web address.</p>" +
         "<p>Opening the page needs a connection, so a customer with no signal and no wifi will see the notification but the review page won't load until they're back online.</p>" },

    { k: ["how long do they last", "durability", "wear out", "lifespan", "break", "damaged", "waterproof"],
      a: "<p>Passive NFC tags have no moving parts and no power source, and the chips themselves are typically rated for decades of reads. Realistically the card gives out before the chip does.</p>" +
         "<p>What actually kills them is physical: repeated sharp bending across the antenna, or serious heat. Ordinary counter life - being tapped, wiped down, knocked about - isn't a problem.</p>" },

    { k: ["qr code", "qr", "versus qr", "instead of qr", "qr vs nfc"],
      a: "<p>They solve the same problem differently, and each wins in different spots.</p><ul>" +
         "<li><b>NFC</b> is faster - one tap, no camera, nothing to aim - and works in poor light. It needs the customer to have their phone in hand and NFC available.</li>" +
         "<li><b>QR</b> works on any phone with a camera, can be read from a distance, and can be printed on anything. It takes more steps: unlock, open camera, frame it, tap the banner.</li></ul>" +
         "<p>Which is why a lot of businesses put both on the same card - NFC for the majority, QR as the fallback that always works.</p>" },

    { k: ["privacy", "safe", "secure", "data", "track", "steal", "hack", "personal information"],
      a: "<p>A review tag is a read-only URL. It can't pull contacts, photos, or anything else off a phone - NFC tags don't have that capability, and the phone won't open anything without the customer tapping the notification first.</p>" +
         "<p>The phone reads the tag; the tag learns nothing about the phone. Whatever tracking exists after that is ordinary web analytics on the page that opens, exactly as if they'd typed the address in.</p>" },

    { k: ["reprogram", "change the link", "rewrite", "update the link", "new link", "reuse"],
      a: "<p>Technically, NFC tags come in two flavours: rewritable, where the stored link can be overwritten, and locked, where it's fixed at programming time to stop anyone rewriting it in the wild.</p>" +
         "<p>Locking is the usual choice for cards that sit in public - it means nobody can walk past and point your card somewhere else. Whether a specific Optiq card is locked, and how a link change is handled, is a question for the team rather than something I should guess at.</p>" },

    { k: ["google business profile", "google my business", "gmb", "business profile", "google listing"],
      a: "<p>A Google Business Profile is the free listing that shows up in Google Maps and in the panel on the right of a Google search for your business. It's what holds your hours, photos, address, phone number and reviews.</p>" +
         "<p>It's the thing customers are actually leaving reviews on - so it needs to be claimed and verified by you before review collection is worth much.</p>" },

    { k: ["find my review link", "get my review link", "where is my review link", "review link", "my google link", "google review link", "find my google link", "where do i get my link"],
      a: "<p>The reliable route: sign in to your Google Business Profile, open your business, and look for <b>Ask for reviews</b> or <b>Get more reviews</b>. Google generates a short link there that drops people straight onto the review form.</p>" +
         "<p>The manual route: find your business in Google Maps, open the listing, scroll to Reviews, and use the share option on the write-a-review dialog. Both give you the same destination - the first is just harder to get wrong.</p>" },

    { k: ["why do reviews matter", "do reviews help", "why reviews", "ranking", "rank", "seo", "rank higher", "local seo", "google maps ranking", "reviews matter", "reviews even matter"],
      a: "<p>Google is explicit that local results are ranked on three things: relevance, distance, and prominence. Reviews feed prominence - Google's own guidance says review count and score factor into local ranking.</p>" +
         "<p>There's a second effect that's easier to underrate: reviews are the deciding factor for a human comparing two similar businesses on a map. Ranking gets you seen, reviews get you chosen.</p>" },

    { k: ["how many reviews", "how many do i need", "enough reviews", "number of reviews"],
      a: "<p>There's no threshold that switches something on. The honest benchmark is relative: look at the top three businesses in your category within a few miles and see where you sit against them.</p>" +
         "<p>The pattern that matters is a steady trickle rather than a burst. Twenty reviews earned over six months reads as a healthy business; twenty in a weekend reads as suspicious, to both Google and customers.</p>" },

    { k: ["old reviews", "recency", "recent reviews", "fresh reviews", "how recent"],
      a: "<p>Recency does real work. A listing whose newest review is two years old signals a business that may have changed hands or gone downhill, regardless of the star average.</p>" +
         "<p>Customers also read the most recent handful far more carefully than the average - which is why keeping a slow, continuous flow beats one big push.</p>" },

    { k: ["incentive", "incentives", "offer a discount for a review", "pay for reviews", "reward", "free drink", "free coffee", "bribe", "offer customers", "give customers", "in exchange for a review"],
      a: "<p>Don't. Google's review policies prohibit offering money, discounts, free items or any other incentive in exchange for reviews, and enforcement ranges from removing the reviews to penalising the listing.</p>" +
         "<p>Asking is fine and encouraged. Paying is not. The line is whether the customer gets something for leaving the review.</p>" },

    { k: ["review gating", "only ask happy customers", "filter reviews", "screen customers", "unhappy customers"],
      a: "<p>Review gating - surveying people first and only sending the happy ones to Google - is against Google's policy. The rule is that the invitation has to be the same for everyone.</p>" +
         "<p>The workaround people are really after is simpler and allowed: make it easy for everyone, and get good enough at fixing problems in person that the unhappy ones are rare.</p>" },

    { k: ["fake reviews", "buy reviews", "bots"],
      a: "<p>Not worth it. Google actively detects and removes purchased reviews, and businesses caught at it can have review content wiped or the listing itself penalised.</p>" +
         "<p>It's also transparent to customers - a cluster of vague five-star reviews posted in one week, by accounts with no history, reads as fake to anyone paying attention.</p>" },

    { k: ["bad review", "negative review", "remove a review", "delete a review", "one star", "delete", "remove", "1 star"],
      a: "<p>You can't delete a review you don't like, and neither can anyone selling you that service. You can flag one that breaks Google's policies - spam, hate speech, a competitor, someone who was never a customer - and ask for removal on those grounds.</p>" +
         "<p>For a genuine complaint, the reply is the real tool. A calm, specific, non-defensive response is read by every future customer, and it often does more for you than the original review did against you.</p>" },

    { k: ["respond to reviews", "reply to reviews", "should i respond"],
      a: "<p>Yes, and quickly. Replies are public and permanent, and they're read by people deciding whether to walk in.</p>" +
         "<p>Short works better than long. Thank the good ones by name where it's natural; on the bad ones acknowledge the specific problem, say what you've changed, and offer to take it offline. Avoid arguing the facts in public even when you're right.</p>" },

    { k: ["when to ask", "best time to ask", "when should i ask", "timing"],
      a: "<p>At the peak of the good feeling, and while they're still with you. For most businesses that's the moment the work is visibly finished and the customer is pleased - at the chair, at the counter, as the plates are cleared.</p>" +
         "<p>Once they've walked out, response rates fall off a cliff. That's the entire argument for a card that lives where the interaction ends rather than an email sent the next day.</p>" },

    { k: ["what to say", "how to ask", "script", "ask customers", "staff", "train my team"],
      a: "<p>Keep it short, personal and permission-shaped. Something like: <i>\"Glad you're happy with it - if you've got ten seconds, a quick Google review really helps us. Just tap your phone here.\"</i></p>" +
         "<p>Three things make it work: naming the specific thing they liked, giving the time cost honestly, and physically gesturing at the card. Teams that ask nothing get nothing, and the ask is almost always the missing piece rather than the tool.</p>" },

    { k: ["where to put", "placement", "where should i put it", "best place"],
      a: "<p>Wherever the transaction ends and the customer's hands are free - next to the card reader, on the reception desk, at the barber station, by the till.</p>" +
         "<p>Two rules of thumb: it has to be within arm's reach of where they're already standing, and a member of staff has to be able to point at it without moving. A card behind the counter or off to one side gets used a fraction as often.</p>" },

    { k: ["multiple locations", "two shops", "several branches", "franchise", "chain", "shops", "branches", "locations", "second location", "more than one", "shop", "branch", "location", "sites", "each shop", "per shop"],
      a: "<p>Each location needs its own Google Business Profile, so each one has its own review link - reviews are attached to the listing, not to the brand.</p>" +
         "<p>Practically that means cards have to be kept per site and not shuffled between them, or you'll end up with one branch's customers reviewing another's listing.</p>" },

    { k: ["yelp", "facebook", "tripadvisor", "trustpilot", "other platforms", "not google"],
      a: "<p>An NFC tag holds a web address, so in principle it can point at any review platform - Yelp, Facebook, TripAdvisor, Trustpilot - and the customer experience is identical.</p>" +
         "<p>Whether Optiq will program a non-Google link for you is a question for the team; I only want to state what's actually published about their process.</p>" },

    { k: ["international", "abroad", "other countries", "worldwide", "different country", "countries", "country", "overseas", "outside the us", "another country"],
      a: "<p>NFC is a global standard - the same tag reads identically on a phone bought anywhere. There's no regional lockout the way there is with, say, DVDs.</p>" +
         "<p>What's location-specific is the listing you're pointing at, since Google Business Profiles are per-location.</p>" },

    { k: ["ai receptionist", "voice ai", "answering service", "what is an ai receptionist", "phone ai"],
      a: "<p>An AI receptionist is a voice system that answers your phone line, understands what the caller wants in ordinary speech, and acts on it - answering routine questions, taking details, booking into a calendar, and escalating anything it can't handle.</p>" +
         "<p>The case for it in a local business is straightforward: calls arrive while you're mid-job, after hours, and in bursts, and those are exactly the moments a human can't pick up. For what Optiq's specific version does and costs, ask me and I'll pull it from the store rather than describe it generically.</p>" },

    { k: ["missed calls", "missing calls", "unanswered", "voicemail", "cost of missed calls"],
      a: "<p>For a local service business a missed call is usually a lost job rather than a delayed one - callers with an urgent need tend to work down the search results rather than wait for a call back, and most won't leave voicemail.</p>" +
         "<p>The expensive part is that it's invisible. Nothing on your books records the customer who rang at 7pm, got voicemail, and called the next business instead.</p>" },

    { k: ["case", "phone case", "thick case", "wallet case", "metal case"],
      a: "<p>Thin plastic, silicone and leather cases are fine - NFC reads straight through them.</p>" +
         "<p>What interferes is metal, and wallet cases with bank cards stacked against the phone's antenna. If a customer's phone reads everything else but not this, the case is the first suspect.</p>" },

    { k: ["how do i grow my business", "get more customers", "marketing", "advertise", "more business"],
      a: "<p>Reviews are one lever, and for a local business they're an unusually cheap one - but they work alongside the basics rather than replacing them: a complete Google Business Profile, accurate hours, real photos, fast replies to enquiries.</p>" +
         "<p>If you tell me what kind of business you run, I can be more specific about where review collection realistically fits and where it won't move the needle.</p>" },

    { k: ["made of", "material", "materials", "what is it made from", "plastic", "pvc", "what are they made of", "construction", "made from"],
      a: "<p>NFC cards are normally built like a bank card: a laminated plastic body - usually PVC, sometimes PET or recycled PET - with a hair-thin copper or aluminium antenna and the chip sandwiched between the layers. That's why they look solid and have no visible electronics.</p>" +
         "<p>Card bodies vary in thickness and finish (matte, gloss, soft-touch), which is most of what separates a premium counter card from a thin handout card. For the exact stock and finish Optiq uses, the product page or " + link("mailto:" + SUPPORT, "the team") + " is the authority - I don't want to state a spec that isn't published.</p>" },

    { k: ["how do i clean", "clean the card", "wipe", "sanitise", "sanitize", "disinfect"],
      a: "<p>A damp cloth or an alcohol wipe is fine - the electronics are sealed inside the plastic, so surface cleaning doesn't reach them.</p>" +
         "<p>What to avoid is abrasive scouring, which dulls the finish, and soaking, which can creep into the edges of the laminate over time.</p>" },

    { k: ["how long does it take to see results", "how long until", "results", "how quickly", "how fast will i see"],
      a: "<p>Mechanically it's immediate - the first customer who taps can leave a review that minute. What takes time is volume, because it's governed by how many customers you serve and how often your team actually asks.</p>" +
         "<p>A useful way to think about it: if you serve 50 customers a week and 4% act on the ask, that's roughly two reviews a week. Doubling the rate at which staff mention it moves that number far more than anything else you can change.</p>" },

    { k: ["worth it", "is it worth", "roi", "return on investment", "worth the money"],
      a: "<p>The honest test is arithmetic rather than opinion: work out what one new customer is worth to you, then how many extra customers a stronger review profile would have to bring in to cover the cost. For most local businesses with a decent average order value, that number is small.</p>" +
         "<p>Where it doesn't pay is if nobody asks. The card removes the friction after the ask - it can't replace it. If you tell me your rough customer volume I can put actual numbers against it.</p>" },

    { k: ["what is a review", "google review", "how do reviews work", "leave a review"],
      a: "<p>A Google review is a star rating from 1 to 5 with optional written text, left by anyone with a Google account on your Business Profile. It's public, attached to the reviewer's name, and can be edited or deleted by them at any time.</p>" +
         "<p>You can't approve or filter them, which is the point - the lack of control is what makes them credible to the person reading.</p>" },

    { k: ["anonymous", "do customers have to log in", "google account", "sign in to leave a review"],
      a: "<p>Yes - Google requires a signed-in Google account to post a review, and the reviewer's name and profile photo appear alongside it. There's no anonymous option.</p>" +
         "<p>In practice most people on Android are already signed in, and most iPhone users have a Google account too. It's a real step, but a small one.</p>" },

    { k: ["how much do reviews cost", "is it free to get reviews", "does google charge"],
      a: "<p>Google charges nothing for reviews, for the Business Profile, or for appearing in Maps. It's all free.</p>" +
         "<p>Anything you spend is on making the ask easier or more frequent - which is the only part a product can actually help with.</p>" },

    { k: ["competitor", "competitors", "beat my competition", "rank above"],
      a: "<p>Look at the businesses currently ranking above you in your category and area, and compare three things: review count, average rating, and how recent the newest reviews are. That usually explains the ordering better than anything else visible.</p>" +
         "<p>The gap is often smaller than it looks. Moving from 20 reviews to 60 is a few months of consistent asking, not a marketing budget.</p>" },

    { k: ["hours", "opening hours", "when are you open", "business hours", "your hours"],
      a: "<p>Optiq is an online store, so ordering runs around the clock. Support response times and any published hours are the team's to state, not mine to guess - " + link("mailto:" + SUPPORT, SUPPORT) + " is the direct line.</p>" },

    { k: ["who owns optiq", "where are you based", "where are you located", "company", "about the company"],
      a: "<p>I only know what's published on this site, and ownership and location details aren't part of it - so I won't invent them.</p>" +
         "<p>The " + link("/pages/contact", "contact page") + " and " + link("mailto:" + SUPPORT, SUPPORT) + " are the right places to ask; they'll give you a straight answer.</p>" }
  ];

  GENERAL.forEach(function (g) {
    g._single = [];
    g._phrase = [];
    (g.k || []).forEach(function (key) {
      var n = norm(key);
      if (n.indexOf(" ") > -1) g._phrase.push(n);
      else g._single.push(stem(n));
    });
  });

  function scoreGeneral(q) {
    var qt = tokens(q, true), raw = norm(q);
    if (!qt.length) return [];
    return GENERAL.map(function (g) {
      var s = 0;
      g._phrase.forEach(function (p) {
        if (raw.indexOf(p) > -1) { s += 8; return; }
        // Exact phrases almost never survive contact with a real customer
        // ("why do reviews matter" arrives as "why do google reviews even
        // matter"), so also credit a phrase whose content words are all
        // present, in any order.
        var words = p.split(" ").filter(function (w) {
          return w.length > 2 && !STOP[w];
        }).map(stem);
        if (words.length < 2) return;
        var all = words.every(function (w) { return qt.indexOf(w) > -1; });
        if (all) s += 5;
      });
      g._single.forEach(function (w) { if (qt.indexOf(w) > -1) s += 4; });
      return { g: g, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
  }

  function answerGeneral(q, bar) {
    var r = scoreGeneral(q);
    if (!r.length || r[0].s < (typeof bar === "number" ? bar : 4)) return null;
    return r[0].g.a;
  }

  /* ------------------------------------------------------------ reasoning
     Arithmetic the customer would otherwise have to do by hand. Every number
     it uses is read out of the payload, so it can compute but never invent. */
  function num(s) { return Number(String(s).replace(/[^0-9.]/g, "")); }

  function moneyFrom(cents) {
    // Reuse a real formatted price from the payload as the pattern, so the
    // currency symbol is never hard-coded here.
    var sample = null;
    for (var i = 0; i < PRODUCTS.length && !sample; i++) sample = PRODUCTS[i].priceMinText;
    var sym = sample ? String(sample).replace(/[0-9.,\s]/g, "") : "$";
    return sym + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // "how much for 3 cards" / "what do 50 cost" - match the quantity against a
  // real variant option before doing any maths.
  function answerQuantity(q, list) {
    var m = norm(q).match(/\b(\d{1,4})\s*(cards?|packs?|of them|units?)?\b/);
    if (!m) return null;
    var want = parseInt(m[1], 10);
    if (!want || want > 5000) return null;
    // Start with whatever the customer named, but fall back to the whole
    // catalogue - "how much for 50?" shouldn't fail just because the product
    // still in conversation memory isn't sold in fifties.
    var pool = (list && list.length ? list : []).concat(PRODUCTS);

    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      var hits = (p.variants || []).filter(function (v) {
        return (v.options || []).some(function (o) {
          var n = num(o);
          return n === want && /card|pack/i.test(o);
        });
      });
      if (!hits.length) continue;
      remember([p]);
      var cheapest = hits.slice().sort(function (a, b) { return a.price - b.price; })[0];
      var per = cheapest.price / want;
      var out = "<p><b>" + esc(p.title) + "</b> in a " + want + "-card option starts at <b>" +
        esc(cheapest.priceText) + "</b>";
      if (hits.length > 1) out += " (that's the " + esc(cheapest.title) + " variant; others cost more)";
      out += ".</p><p>That works out at about <b>" + esc(moneyFrom(per)) + " per card</b>";
      // Compare against the smallest quantity of the same product, if there is one.
      var smallest = null;
      (p.variants || []).forEach(function (v) {
        (v.options || []).forEach(function (o) {
          var n = num(o);
          if (n && /card|pack/i.test(o) && n < want && (!smallest || n < smallest.n || v.price / n < smallest.per)) {
            smallest = { n: n, per: v.price / n };
          }
        });
      });
      if (smallest && smallest.per > per) {
        out += ", against " + esc(moneyFrom(smallest.per)) + " per card at " + smallest.n +
          " - so the larger quantity is the cheaper way to buy";
      }
      out += ".</p>" + productCard(p);
      return out;
    }
    return null;
  }

  // "how much is that over a year" / "for 6 months"
  function answerOverTime(q, list) {
    var t = norm(q);
    var m = t.match(/\b(\d{1,3})\s*(month|months)\b/);
    var months = m ? parseInt(m[1], 10) : (/\b(a year|per year|yearly|annually|12 months)\b/.test(t) ? 12 : 0);
    if (!months || months > 120) return null;
    var pool = (list && list.length ? list : MEM.products).filter(function (p) {
      return /month|subscription|hosting|membership/i.test((p.type || "") + " " + (p.tags || []).join(" ") + " " + p.description);
    });
    if (!pool.length) return null;
    var p = pool[0];
    var total = p.priceMin * months;
    return "<p>At " + esc(p.priceMinText) + " a month, <b>" + esc(p.title) + "</b> comes to <b>" +
      esc(moneyFrom(total)) + "</b> over " + months + " month" + (months === 1 ? "" : "s") + ".</p>" +
      "<p>That's straight multiplication of the listed monthly price - it doesn't account for anything the team may do on longer commitments, which is worth asking them about.</p>";
  }

  // "I've got about $150 to spend"
  function answerBudget(q) {
    // Match against the raw text, because norm() strips the currency symbol.
    var t = String(q || "").toLowerCase();
    // Require an explicit budget cue or a currency symbol - otherwise
    // "around 50 cards" reads as fifty dollars instead of fifty cards.
    var m = t.match(/(?:under|below|less than|up to|budget of|i have|i've got|ive got|got|to spend|spend|around|about)\s*\$?\s*(\d{1,5})/) ||
            t.match(/\$\s*(\d{1,5})/);
    if (!m) return null;
    var after = t.slice(m.index + m[0].length);
    if (/^\s*(cards?|packs?|units?)\b/.test(after)) return null;   // a quantity, not a budget
    var cap = parseInt(m[1], 10) * 100;
    if (!cap) return null;
    var fits = PRODUCTS.filter(function (p) { return p.priceMin <= cap; })
                       .sort(function (a, b) { return b.priceMin - a.priceMin; });
    if (!fits.length) {
      return "<p>Nothing on the site starts under " + esc(moneyFrom(cap)) + ". The lowest entry price is " +
        esc(PRODUCTS.slice().sort(function (a, b) { return a.priceMin - b.priceMin; })[0].priceMinText) + ".</p>";
    }
    remember(fits.slice(0, 3));
    var out = "<p>With " + esc(moneyFrom(cap)) + " to spend, these start within budget:</p>";
    fits.slice(0, 4).forEach(function (p) { out += productCard(p); });
    out += "<p>Bear in mind those are starting prices - options can take the total above " +
      esc(moneyFrom(cap)) + ". Tell me what kind of business you run and I'll say which of them I'd actually put the money into.</p>";
    return out;
  }

  function answerReasoning(q, list) {
    return answerBudget(q) || answerOverTime(q, list) || answerQuantity(q, list);
  }

  /* -------------------------------------------------------------- voice
     The assistant should sound like someone who works here, not like a
     lookup table. These lines are the ONLY free-written text it can produce;
     every factual claim still comes out of the payload verbatim. */
  var TURN = 0;
  function pick(a) { return a[TURN++ % a.length]; }

  var NUDGE = {
    price:        ["Want me to break down what changes the price?", "Want to see how it compares with the other cards?"],
    compare:      ["Happy to go deeper on either one - just say which.", "Want a recommendation based on your type of business?"],
    // No entry for "recommend" on purpose - answerRecommend already ends by
    // inviting more detail, and two invitations in a row reads like padding.
    availability: ["Want the pricing for it?", "Want me to show you what options it comes in?"],
    options:      ["Want the price for a specific combination?", "Anything else you want to check on it?"],
    catalog:      ["Tell me a bit about your business and I'll point you at the right one.", "Want me to compare any two of these?"],
    shipping:     ["Anything else about your order I can check?"],
    returns:      ["Anything else I can look up for you?"],
    general:      ["Anything else you want to dig into?"]
  };

  // A follow-up on every single answer is the thing that makes assistants
  // feel robotic, so never two in a row.
  function withNudge(html, intent) {
    var lines = NUDGE[intent];
    if (!lines || MEM.nudgedLast) { MEM.nudgedLast = false; return html; }
    MEM.nudgedLast = true;
    return html + "<p>" + esc(pick(lines)) + "</p>";
  }

  function capabilities() {
    return "<p>Quite a lot, as long as it's about Optiq. I can:</p><ul>" +
      "<li>look up any product, its price, options and whether it's in stock</li>" +
      "<li>compare two products side by side</li>" +
      "<li>recommend what fits your type of business</li>" +
      "<li>answer shipping, returns, ordering and payment questions</li>" +
      "<li>point you to the right page on the site</li></ul>" +
      "<p>What are you trying to work out?</p>";
  }

  function answerCore(q) {
    var intent = intentOf(q);
    var prev = MEM.lastIntent;
    MEM.lastIntent = intent;

    if (!KNOWLEDGE_OK) return degraded();

    if (intent === "greeting") {
      var name = DATA.customer && DATA.customer.firstName ? " " + esc(DATA.customer.firstName) : "";
      return "<p>" + pick(["Hey" + name + " - good to see you.", "Hi" + name + ".", "Hey" + name + "."]) +
        " I'm Optiq AI. I know everything that's published on this store - products, prices, shipping, returns, the lot.</p>" +
        "<p>" + pick(["What are you after?", "What can I help you with?", "What do you need?"]) + "</p>";
    }
    if (intent === "thanks")
      return "<p>" + pick(["Any time.", "No problem at all.", "Happy to help."]) +
        " " + pick(["Shout if anything else comes up.", "Anything else you need?"]) + "</p>";
    if (intent === "ack")
      return "<p>" + pick(["Got it.", "Sounds good.", "Alright."]) + " " +
        pick(["Anything else you want to look at?", "What else can I dig up for you?"]) + "</p>";
    if (intent === "howareyou")
      return "<p>Doing fine, thanks for asking. I'm the assistant built into the Optiq site, so I'm at my best on questions about the products, pricing, shipping and returns.</p>" +
        "<p>What brought you here today?</p>";
    if (intent === "whatareyou")
      return "<p>I'm Optiq AI - software, not a person, and I'd rather say that up front.</p>" +
        "<p>What makes me different from a general chatbot is that I only read from this store's live data. I don't have opinions and I can't make things up: if something isn't published on the site, I'll tell you that and point you at " +
        link("mailto:" + SUPPORT, "the team") + " instead of guessing.</p>";
    if (intent === "capabilities") return capabilities();

    // The catalogue answers store questions. It should NOT answer "does this
    // need a battery" or "can I pay for reviews" - left alone it returns the
    // nearest product blurb, which is how the assistant ends up sounding like
    // a search box. Where the question is plainly general, the general layer
    // competes on score and wins if it has the better evidence.
    var STORE_INTENT = {
      price: 1, availability: 1, options: 1, catalog: 1, order: 1, payment: 1,
      compare: 1, recommend: 1, discounts: 1, monthlyfee: 1,
      contact: 1, shipping: 1, returns: 1
    };
    if (!STORE_INTENT[intent]) {
      var gTop = scoreGeneral(q)[0];
      var fTop = scoreFacts(q)[0];
      var pTop = scoreProducts(q)[0];
      var gS = gTop ? gTop.s : 0;
      var fS = fTop ? fTop.s : 0;
      var pS = pTop ? pTop.s : 0;
      if (gS >= 4 && gS >= fS && gS >= pS * 0.8) return gTop.g.a;
    }

    // "and the other one?" style follow-ups shouldn't reset the topic.
    if (prev && intent === "general" && MEM.products.length && norm(q).split(" ").length <= 4) {
      intent = prev;
      MEM.lastIntent = prev;
    }

    // Informational intents are answered from the fact set scoped to that
    // intent - deterministic, and immune to a stray keyword pulling in an
    // unrelated answer.
    if (intent === "shipping" || intent === "returns" || intent === "contact" ||
        intent === "brand" || intent === "order" || intent === "payment" ||
        intent === "account" || intent === "discounts" || intent === "monthlyfee") {
      var scoped = factByIntent(q, intent);
      if (scoped) return renderFact(scoped);
    }

    var list = resolve(q);

    // "How much is shipping?" is price-shaped but isn't about a product. If
    // the customer names a non-product topic outright, that beats whatever
    // products are still in conversation memory - otherwise asking about
    // delivery straight after asking about a card returns a price table.
    if (intent === "price" || intent === "compare" || intent === "availability") {
      var topic = null;
      if (/\b(shipping|shipped|delivery|deliver|delivered|postage|arrive|arrives)\b/.test(norm(q))) topic = "shipping";
      else if (/\b(returns?|refunds?|exchange)\b/.test(norm(q))) topic = "returns";
      if (topic) {
        var topicFact = factByIntent(q, topic);
        if (topicFact) return renderFact(topicFact);
      }
    }

    // Product-scoped intents.
    if (intent === "compare") {
      if (list.length < 2 && MEM.products.length >= 2) list = MEM.products.slice();
      var c = answerCompare(list); if (c) return c;
      var cf = answerFact(q); if (cf) return cf;
    }
    if (intent === "recommend") { var r = answerRecommend(q); if (r) return r; }
    if (intent === "price") {
      var calc = answerReasoning(q, list);
      if (calc) return calc;
      var sup = /\b(cheapest|least expensive|lowest|most expensive|dearest|priciest)\b/.test(norm(q));
      if (sup && !list.length) {
        var asc = PRODUCTS.slice().sort(function (a, b) { return a.priceMin - b.priceMin; });
        var want = /\b(most expensive|dearest|priciest)\b/.test(norm(q)) ? asc[asc.length - 1] : asc[0];
        remember([want]);
        return "<p>The " + (/(most expensive|dearest|priciest)/.test(norm(q)) ? "highest" : "lowest") +
          "-priced item on the site is <b>" + esc(want.title) + "</b> at " + esc(priceLine(want)) + ".</p>" + productCard(want);
      }
      // "how much is shipping" is a price-shaped question with no product.
      if (!list.length) {
        var sf = factByIntent(q, "shipping");
        if (sf && /ship|deliver|arrive|post/.test(norm(q))) return renderFact(sf);
      }
      var pr = answerPrice(list); if (pr) return pr;
    }
    if (intent === "availability") { var av = answerAvailability(list, q); if (av) return av; }
    if (intent === "options") { var op = answerOptions(list, q); if (op) return op; }
    if (intent === "catalog") return answerCatalog();
    if (intent === "navigate") { var nv = answerNavigate(q); if (nv) return nv; }

    // General: whichever of fact / product is convincing enough. Both bars are
    // deliberately high - a weak match must fall through to the handoff.
    var factHit = scoreFacts(q), prodHit = scoreProducts(q);
    var factScore = factHit.length ? factHit[0].s : 0;
    var prodScore = prodHit.length ? prodHit[0].s : 0;

    var capability = /^\s*(can|does|do|will|is|are|could|would)\b/.test(norm(q));
    if (factScore >= 6 && (capability || prodScore < factScore * 1.6)) return renderFact(factHit[0].f);

    if (prodScore >= 8) {
      var p = prodHit[0].p;
      remember([p]);
      var snippet = firstSentence(p.description);
      return "<p><b>" + esc(p.title) + "</b> - " + esc(priceLine(p)) + "</p><p>" + esc(snippet) + "</p>" + productCard(p);
    }

    if (factScore >= 6) return renderFact(factHit[0].f);

    // Nothing in the store matched. Before falling back to a page link, try
    // the two layers that don't depend on the catalogue: arithmetic over real
    // prices, and general knowledge about NFC, reviews and local business.
    // Ordering matters - answerNavigate will happily match the word "about"
    // to the About Us page and bury a real question.
    var calc2 = answerReasoning(q, list);
    if (calc2) return calc2;

    var gen = answerGeneral(q);
    if (gen) return gen;

    var nav = answerNavigate(q);
    if (nav) return nav;

    return bestEffort(q);
  }

  // Last resort. Even here it should leave the customer better off than a
  // flat "I don't know" - say what it does cover, then hand off cleanly.
  function bestEffort(q) {
    var loose = answerGeneral(q, 3);
    if (loose) return loose;
    return "<p>I don't have a good answer to that one - say a bit more and I'll have another go.</p>" +
      "<p>I'm strongest on the products and prices here, how NFC and Google reviews actually work, and what makes sense for your kind of business. " +
      link("mailto:" + SUPPORT, SUPPORT) + " reaches a person if you'd rather ask them directly.</p>";
  }

  // Single exit point, so the conversational follow-up logic lives in one
  // place instead of being sprinkled through every answer function.
  function respond(q) {
    var html = answerCore(q);
    if (!KNOWLEDGE_OK) return html;
    return withNudge(html, MEM.lastIntent);
  }

  function resetConversation() {
    MEM.products = [];
    MEM.lastIntent = null;
    MEM.nudgedLast = false;
    TURN = 0;
  }

  // Exposed for debugging and automated checks: window.OptiqAI.respond("...")
  window.OptiqAI = {
    respond: respond,
    intentOf: intentOf,
    resolve: resolve,
    memory: MEM,
    productCount: PRODUCTS.length,
    knowledgeLoaded: KNOWLEDGE_OK,
    knowledgeError: KNOWLEDGE_ERROR,
    reset: resetConversation,
    ready: false
  };



  /* ------------------------------------------------------- remote model
     When an endpoint is configured (Theme settings -> Optiq AI -> AI endpoint
     URL), questions go to a real model via optiq-ai-worker, which holds the
     API key server-side. The live knowledge payload rides along with every
     request, so Optiq-specific claims stay pinned to the actual store and the
     model never has to guess a price.

     Everything below degrades: no endpoint, a network failure, or a bad
     response and the local engine answers instead. The widget is never left
     without a reply. */
  var ENDPOINT = "";
  var HISTORY = [];
  var RAW_KNOWLEDGE = "{}";
  try {
    var kel = document.getElementById("optiq-ai-data");
    if (kel) RAW_KNOWLEDGE = kel.textContent;
  } catch (e) {}

  function mdToHtml(text) {
    var out = esc(text);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    // [label](url) - only http(s), mailto and site-relative targets.
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|\/[^)\s]*)\)/g,
      function (m, label, url) { return '<a href="' + url + '">' + label + "</a>"; });
    // Bare emails and internal paths become links too.
    out = out.replace(/(^|[\s(])((?:[a-z0-9._%+-]+)@(?:[a-z0-9.-]+\.[a-z]{2,}))/gi,
      '$1<a href="mailto:$2">$2</a>');
    var blocks = out.split(/\n{2,}/);
    return blocks.map(function (b) {
      var lines = b.split(/\n/).filter(function (l) { return l.trim(); });
      var bullets = lines.filter(function (l) { return /^\s*[-*\u2022]\s+/.test(l); });
      if (bullets.length && bullets.length === lines.length) {
        return "<ul>" + lines.map(function (l) {
          return "<li>" + l.replace(/^\s*[-*\u2022]\s+/, "") + "</li>";
        }).join("") + "</ul>";
      }
      return "<p>" + lines.join("<br>") + "</p>";
    }).join("");
  }

  // Only an https URL is ever called. A merchant pasting a note into the
  // setting, or a template that failed to render, must not cause the widget
  // to fire requests at nonsense.
  function validEndpoint(v) {
    return typeof v === "string" && /^https:\/\/[^\s"'<>{}]+$/.test(v.trim());
  }

  function askRemote(q, done) {
    if (!ENDPOINT || typeof fetch !== "function") return done(null);
    HISTORY.push({ role: "user", content: q });

    var payload = JSON.stringify({
      messages: HISTORY.slice(-20),
      knowledge: RAW_KNOWLEDGE,
      page: (window.location && window.location.pathname) || ""
    });

    var finished = false;
    var stop = function () {};
    if (typeof setTimeout === "function") {
      var timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        HISTORY.pop();
        done(null);
      }, 25000);
      if (typeof clearTimeout === "function") stop = function () { clearTimeout(timer); };
    }

    function fail() {
      if (finished) return;
      finished = true;
      stop();
      HISTORY.pop();
      done(null);
    }

    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      }).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      }).then(function (data) {
        if (finished) return;
        var reply = data && typeof data.reply === "string" ? data.reply.trim() : "";
        if (!reply) throw new Error("empty reply");
        finished = true;
        stop();
        HISTORY.push({ role: "assistant", content: reply });
        done(mdToHtml(reply));
      })["catch"](fail);
    } catch (e) { fail(); }
  }

  function resetRemote() { HISTORY = []; }

  /* ------------------------------------------------------------------ UI
     Wiring is deliberately the last thing that happens and is never guarded
     by the knowledge check above: the sidebar opens whether or not the index
     loaded. Every handler is wrapped so one bad answer can't leave the panel
     in a stuck state. */
  var booted = false;
  var MAXLEN = 2000;

  function boot() {
    if (booted) return;
    var root = document.querySelector("[data-optiq-ai]");
    if (!root) return;
    booted = true;

    var panel    = root.querySelector("[data-oqa-panel]");
    var log      = root.querySelector("[data-oqa-log]");
    var form     = root.querySelector("[data-oqa-form]");
    var composer = root.querySelector("[data-oqa-composer]");
    var input    = root.querySelector("[data-oqa-input]");
    var launcher = root.querySelector("[data-oqa-launch]");
    var sendBtn  = root.querySelector("[data-oqa-send]");
    var counter  = root.querySelector("[data-oqa-count]");
    var status   = root.querySelector("[data-oqa-status]");
    var pill     = root.querySelector("[data-oqa-pill]");
    if (!panel || !log) return;

    var greeted = false;
    var configured = (root.getAttribute("data-oqa-endpoint") || "").trim();
    ENDPOINT = validEndpoint(configured) ? configured : "";

    // The header pill and footer status report the real state of the index.
    // If the catalogue didn't load, the widget says so rather than pretending.
    if (!KNOWLEDGE_OK) {
      if (pill) { pill.textContent = "Limited mode"; pill.className = "oqa__pill is-degraded"; }
      if (status) {
        status.className = "oqa__status is-degraded";
        status.innerHTML = "<i></i> Store data unavailable";
      }
    } else if (ENDPOINT && status) {
      status.innerHTML = "<i></i> Connected to live store";
    }

    function push(who, html) {
      var d = document.createElement("div");
      d.className = "oqa-msg oqa-msg--" + who;
      d.innerHTML = '<div class="oqa-bubble">' + html + "</div>";
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      return d;
    }

    function answer(q) {
      try {
        var html = respond(q);
        return html || "<p>" + askSupport() + "</p>";
      } catch (e) {
        return "<p>" + askSupport() + "</p>";
      }
    }

    function grow() {
      if (!input) return;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";
    }

    function sync() {
      if (!input) return;
      var n = input.value.length;
      if (counter) {
        counter.textContent = n + "/" + MAXLEN;
        counter.className = n > MAXLEN - 200 ? "oqa__count is-near" : "oqa__count";
      }
      if (sendBtn) sendBtn.disabled = !input.value.trim();
      grow();
    }

    function greet() {
      greeted = true;
      push("ai", answer("hello"));
      if (KNOWLEDGE_OK) chips();
    }

    function open() {
      root.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
      if (launcher) launcher.setAttribute("aria-expanded", "true");
      if (!greeted) greet();
      sync();
      setTimeout(function () { if (input) { try { input.focus(); } catch (e) {} } }, 220);
    }

    function close() {
      root.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
      if (launcher) {
        launcher.setAttribute("aria-expanded", "false");
        try { launcher.focus({ preventScroll: true }); } catch (e) {}
      }
    }

    function chips() {
      var qs = ["What products do you have?", "How does the card work?",
                "What's the difference between the cards?", "How fast is shipping?"];
      var w = document.createElement("div");
      w.className = "oqa-chips";
      qs.forEach(function (q) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = q;
        b.addEventListener("click", function () { send(q); });
        w.appendChild(b);
      });
      log.appendChild(w);
      log.scrollTop = log.scrollHeight;
    }

    function send(q) {
      q = String(q || "").trim();
      if (!q) return;
      var chipRow = log.querySelector(".oqa-chips");
      if (chipRow && chipRow.parentNode) chipRow.parentNode.removeChild(chipRow);
      push("me", esc(q));
      if (input) { input.value = ""; sync(); }
      var t = push("ai", '<span class="oqa-typing"><i></i><i></i><i></i></span>');

      function settle(html) {
        var bubble = t.querySelector(".oqa-bubble");
        if (bubble) bubble.innerHTML = html;
        log.scrollTop = log.scrollHeight;
      }

      if (ENDPOINT) {
        askRemote(q, function (html) {
          // A null reply means the endpoint failed - fall back rather than
          // showing the customer an error.
          settle(html || answer(q));
        });
        return;
      }

      // A beat before answering - instant replies read as a lookup table.
      setTimeout(function () { settle(answer(q)); },
                 320 + Math.min(q.length * 6, 380));
    }

    if (launcher) {
      launcher.addEventListener("click", function (e) {
        e.preventDefault();
        root.classList.contains("is-open") ? close() : open();
      });
    }

    var closers = root.querySelectorAll("[data-oqa-close]");
    for (var i = 0; i < closers.length; i++) closers[i].addEventListener("click", close);

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        send(input ? input.value : "");
      });
    }

    if (input) {
      input.addEventListener("input", sync);
      // Enter sends, Shift+Enter makes a new line - as the footer promises.
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send(input.value);
        }
      });
      if (composer) {
        input.addEventListener("focus", function () { composer.classList.add("is-focused"); });
        input.addEventListener("blur", function () { composer.classList.remove("is-focused"); });
      }
    }

    // Tool buttons run real queries; none of them are decorative.
    var askers = root.querySelectorAll("[data-oqa-ask]");
    for (var a = 0; a < askers.length; a++) {
      (function (btn) {
        btn.addEventListener("click", function () { send(btn.getAttribute("data-oqa-ask")); });
      })(askers[a]);
    }

    var resetBtn = root.querySelector("[data-oqa-reset]");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        log.innerHTML = "";
        resetConversation();
        resetRemote();
        greeted = false;
        greet();
        if (input) { input.value = ""; sync(); input.focus(); }
      });
    }

    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && root.classList.contains("is-open")) close();
    });

    sync();

    // Let other code (and the theme editor) drive the sidebar.
    window.OptiqAI.open = open;
    window.OptiqAI.close = close;
    window.OptiqAI.ask = function (q) { open(); send(q); };
    window.OptiqAI.ready = true;
    window.OptiqAI.knowledgeLoaded = KNOWLEDGE_OK;
    window.OptiqAI.endpoint = ENDPOINT || null;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  // Belt and braces: if the mount rendered after this script ran, catch it.
  window.addEventListener("load", boot);
})();
