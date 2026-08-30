/* ==========================================================================
   OPTIQ — BUILD YOUR SET
   --------------------------------------------------------------------------
   Drives the Ring / Metal Card purchase experience.

   Deliberately does NOT implement its own add-to-cart. The markup is a real
   <form action="/cart/add"> with a hidden `id`, which the theme's existing
   cart controller (assets/optiq-cart.js) already intercepts — it does the
   AJAX POST, repaints the drawer through the Section Rendering API, opens the
   drawer and fires `optiq:cart:updated`. Adding a second POST path here is
   how two "buy" flows end up disagreeing about the cart, so this file only
   validates the selection before letting the submit through, and listens for
   the result.

   Without JS the same form still posts normally and Shopify adds the
   pre-selected variant, so the button is never dead.

   Bundle state is read from the REAL cart (/cart.js), never from local
   assumptions: the saving itself is a Shopify automatic discount, so the cart
   and checkout are the source of truth for whether it applies.
   ========================================================================== */
(function () {
  'use strict';

  var SIZE_LIKE = /size/i;

  /* ---- money ------------------------------------------------------------ */
  function formatMoney(cents, format) {
    var fmt = format || '${{amount}}';
    var placeholder = /\{\{\s*(\w+)\s*\}\}/;

    function num(value, precision, thousands, decimal) {
      thousands = thousands || ',';
      decimal = decimal || '.';
      if (isNaN(value) || value == null) { return '0'; }
      var fixed = (value / 100.0).toFixed(precision);
      var parts = fixed.split('.');
      var whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
      return whole + (parts[1] ? decimal + parts[1] : '');
    }

    var value;
    switch ((fmt.match(placeholder) || [])[1]) {
      case 'amount_no_decimals': value = num(cents, 0); break;
      case 'amount_with_comma_separator': value = num(cents, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = num(cents, 0, '.', ','); break;
      case 'amount_with_space_separator': value = num(cents, 2, ' ', ','); break;
      default: value = num(cents, 2);
    }
    return fmt.replace(placeholder, value);
  }

  /* ---- helpers ---------------------------------------------------------- */
  function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function sameOptions(a, b) {
    if (!a || !b || a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }

  /* ====================================================================== */

  function BuildSet(root) {
    var payloadEl = root.querySelector('[data-bset-data]');
    if (!payloadEl) { return; }

    var data;
    try { data = JSON.parse(payloadEl.textContent); }
    catch (err) {
      if (window.console) { console.error('[optiq buildset] bad payload', err); }
      return;
    }

    var products = data.products || {};
    var keys = Object.keys(products);
    if (!keys.length) { return; }

    var money = data.moneyFormat;
    var bundle = data.bundle || { enabled: false };
    /* Optional grouping layer, e.g. Cards vs Wristbands: [{ key, label,
       slots: [productKey,...] }, ...]. Absent on every payload that predates
       it (Build Your Set's Ring/Metal Card), so this whole feature is
       inert there - no categories array, no tabs queried, nothing to wire
       up, original flat-switcher behaviour untouched. */
    var categories = data.categories || [];

    /* ---- state --------------------------------------------------------- */
    var state = {
      key: keys[0],
      category: null,
      selections: {},   // productKey -> [optionValue|null, ...]
      qty: {},          // productKey -> integer
      inCart: {}        // productKey -> boolean, from the real cart
    };

    keys.forEach(function (key) {
      var product = products[key];
      state.qty[key] = 1;
      /* Every option gets a sensible default except size: pre-picking a ring
         size for someone is how the wrong size gets bought. They choose it. */
      state.selections[key] = product.options.map(function (option) {
        return SIZE_LIKE.test(option.name) ? null : (option.values[0] || null);
      });
    });

    /* Pre-select a slot via ?show=<key> in the URL, e.g. a shop-grid card
       linking straight into Build Your Set with its own product already
       open - the switcher still lets the shopper move to a different slot
       or add the others to build a bundle. Falls back to keys[0] when the
       param is missing or doesn't match a slot on this page. */
    try {
      var showParam = new URLSearchParams(window.location.search).get('show');
      if (showParam && keys.indexOf(showParam) !== -1) { state.key = showParam; }
    } catch (err) { /* URLSearchParams unsupported - keeps keys[0] */ }

    /* ---- elements ------------------------------------------------------ */
    var el = {
      form: root.querySelector('[data-bset-form]'),
      variantId: root.querySelector('[data-bset-variant-id]'),
      qtyInput: root.querySelector('[data-bset-qty-input]'),
      qtyField: root.querySelector('[data-bset-qty]'),
      qtyDec: root.querySelector('[data-bset-qty-step="-1"]'),
      qtyInc: root.querySelector('[data-bset-qty-step="1"]'),
      addBtn: root.querySelector('[data-bset-add]'),
      totalValue: root.querySelector('[data-bset-total]'),
      totalNote: root.querySelector('[data-bset-total-note]'),
      alert: root.querySelector('[data-bset-alert]'),
      bundle: root.querySelector('[data-bset-bundle]'),
      bundleEyebrow: root.querySelector('[data-bset-bundle-eyebrow]'),
      bundleBody: root.querySelector('[data-bset-bundle-body]'),
      bundleMath: root.querySelector('[data-bset-bundle-math]'),
      bundleCta: root.querySelector('[data-bset-bundle-cta]'),
      categoryTabs: all('[data-bset-category]', root),
      categoryDescs: all('[data-bset-cat-desc]', root),
      switchWrap: root.querySelector('[data-bset-switchwrap]')
    };

    /* ---- variant resolution -------------------------------------------- */
    function currentProduct() { return products[state.key]; }

    function findVariant(key, selection) {
      var product = products[key];
      if (selection.indexOf(null) !== -1) { return null; }
      for (var i = 0; i < product.variants.length; i++) {
        if (sameOptions(product.variants[i].opts, selection)) { return product.variants[i]; }
      }
      return null;
    }

    /* A value at option index `idx` is offerable when some available variant
       carries it while matching every OTHER option the shopper has chosen. */
    function valueAvailable(key, idx, value) {
      var product = products[key];
      var selection = state.selections[key];
      return product.variants.some(function (variant) {
        if (!variant.available) { return false; }
        if (variant.opts[idx] !== value) { return false; }
        for (var i = 0; i < selection.length; i++) {
          if (i !== idx && selection[i] !== null && variant.opts[i] !== selection[i]) { return false; }
        }
        return true;
      });
    }

    /* ---- rendering ------------------------------------------------------ */
    function renderPanels() {
      all('[data-bset-for]', root).forEach(function (node) {
        var on = node.getAttribute('data-bset-for') === state.key;
        node.hidden = !on;
      });
      all('[data-bset-switch]', root).forEach(function (btn) {
        var on = btn.getAttribute('data-bset-switch') === state.key;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var crumb = root.querySelector('[data-bset-crumb]');
      if (crumb) { crumb.textContent = products[state.key].switchLabel; }
    }

    function renderOptions() {
      var key = state.key;
      var selection = state.selections[key];

      all('[data-bset-value]', root).forEach(function (btn) {
        if (btn.closest('[data-bset-for]').getAttribute('data-bset-for') !== key) { return; }

        var idx = parseInt(btn.getAttribute('data-bset-option-index'), 10);
        var value = btn.getAttribute('data-bset-value');
        var chosen = selection[idx] === value;
        var offerable = valueAvailable(key, idx, value);

        btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
        btn.classList.toggle('is-unavailable', !offerable);
        btn.disabled = !offerable && !chosen;
      });
    }

    /* Some products (the Ring) need a photo to change on TWO option
       dimensions - Color and Style, e.g. "Classic + White" is a different
       shot than "Business Professional + Black" even though both are
       "Black" on other combinations. A shot's data-shot-value2 makes it
       specific to one second-option value; leaving it off makes the shot a
       generic match for that first value regardless of the second option -
       so a product with only one relevant option (the Metal Card's Finish)
       still works exactly as before. An exact (value + value2) match always
       wins over a generic (value-only) one. */
    function renderGallery() {
      var key = state.key;
      var gallery = root.querySelector('[data-bset-gallery="' + key + '"]');
      if (!gallery) { return; }

      var selection = state.selections[key];
      var lead = selection[0];
      var second = selection.length > 1 ? selection[1] : null;
      var shots = all('[data-shot]', gallery);
      if (!shots.length) { return; }

      /* A shot with no data-shot-value matches purely on the SECOND option
         (e.g. the Metal Card's Chip Size), independent of the first
         (Finish) - for a product where only the second option has its own
         photography. */
      var exact = null, generic = null, secondOnly = null;
      shots.forEach(function (shot) {
        var shotValue = shot.getAttribute('data-shot-value');
        var shotValue2 = shot.getAttribute('data-shot-value2');
        if (shotValue === null) {
          if (!secondOnly && shotValue2 !== null && shotValue2 === second) { secondOnly = shot; }
          return;
        }
        if (shotValue !== lead) { return; }
        if (shotValue2) {
          if (!exact && shotValue2 === second) { exact = shot; }
        } else if (!generic) {
          generic = shot;
        }
      });

      var target = exact || generic || secondOnly || shots[0];
      setShot(gallery, target.getAttribute('data-shot'));
    }

    /* Real product photos vary in framing - some tightly cropped, some with
       generous margin, portrait or landscape - so no single fixed box shape
       fits all of them without letterboxing something. Instead the box
       reshapes itself to the ACTIVE photo's own natural dimensions, so
       object-fit: contain always has (essentially) nothing left to pad.
       Falls back to the CSS default shape for a placeholder shot (no <img>
       at all) or before a fresh image finishes loading. */
    function syncMediaAspect(gallery, shot) {
      var media = gallery.querySelector('.bset-media');
      if (!media) { return; }
      var img = shot ? shot.querySelector('img') : null;
      if (!img) { media.style.removeProperty('aspect-ratio'); return; }

      function apply() {
        if (img.naturalWidth && img.naturalHeight) {
          media.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
        }
      }
      if (img.complete) { apply(); } else { img.addEventListener('load', apply, { once: true }); }
    }

    function setShot(gallery, index) {
      var activeShot = null;
      all('[data-shot]', gallery).forEach(function (shot) {
        var on = shot.getAttribute('data-shot') === index;
        shot.classList.toggle('is-active', on);
        if (on) { activeShot = shot; }
      });
      syncMediaAspect(gallery, activeShot);
    }

    /* Some slots (the Metal Card) carry more than one description variant,
       one per value of the second option (Chip Size) - see the two
       data-desc-variant lists in sections/premium-buildset.liquid. A slot
       with only one description (Ring, PVC Card) has no such nodes and
       this is a no-op, leaving its plain p.description/richtext untouched. */
    function renderDescription() {
      var key = state.key;
      var descRoot = root.querySelector('[data-bset-desc="' + key + '"]');
      if (!descRoot) { return; }
      var variants = all('[data-desc-variant]', descRoot);
      if (!variants.length) { return; }

      var second = state.selections[key].length > 1 ? state.selections[key][1] : null;
      var matched = variants.some(function (v) { return v.getAttribute('data-desc-value2') === second; });
      variants.forEach(function (v, i) {
        v.hidden = matched ? (v.getAttribute('data-desc-value2') !== second) : i !== 0;
      });
    }

    function renderTotals() {
      var key = state.key;
      var product = products[key];
      var variant = findVariant(key, state.selections[key]);
      var unit = variant ? variant.price : product.priceFrom;
      var total = unit * state.qty[key];

      if (el.totalValue) { el.totalValue.textContent = formatMoney(total, money); }

      /* Adding this now completes a set only if the OTHER product is already
         sitting in the cart — that is when Shopify's automatic discount fires. */
      if (el.totalNote) {
        var other = otherKey();
        var completes = bundle.enabled && other && state.inCart[other] && !state.inCart[key];
        el.totalNote.hidden = !completes;
        if (completes) {
          el.totalNote.textContent =
            'Bundle saving of ' + formatMoney(bundle.discountCents, money) + ' applies in your cart.';
        }
      }
    }

    function renderBuyState() {
      var key = state.key;
      var product = products[key];
      var selection = state.selections[key];
      var variant = findVariant(key, selection);

      if (el.variantId) { el.variantId.value = variant ? variant.id : ''; }
      if (el.qtyInput) { el.qtyInput.value = state.qty[key]; }

      var missing = -1;
      for (var i = 0; i < selection.length; i++) { if (selection[i] === null) { missing = i; break; } }

      var reason = '';
      var label;
      if (!product.available) {
        reason = product.title + ' is not available for purchase yet.';
        label = 'Coming Soon';
      } else if (missing !== -1) {
        /* Nothing wrong yet - they just haven't picked a size, so the button
           should point them at what to do next rather than read the same
           "unavailable" text a real sellout would use. */
        reason = '';
        label = 'Select ' + product.options[missing].name;
      } else if (!variant || !variant.available) {
        reason = 'Currently unavailable in this combination.';
        label = 'Currently Unavailable';
      } else {
        label = 'Add to Cart';
      }

      var buyable = product.available && missing === -1 && !!variant && variant.available;
      if (el.addBtn) {
        el.addBtn.disabled = !buyable;
        el.addBtn.textContent = label;
      }
      if (reason) { showAlert(reason); } else { clearAlert(); }

      if (el.qtyDec) { el.qtyDec.disabled = state.qty[key] <= 1; }
    }

    function showAlert(message) {
      if (!el.alert) { return; }
      el.alert.textContent = message;
      el.alert.hidden = false;
    }
    function clearAlert() {
      if (!el.alert) { return; }
      el.alert.hidden = true;
      el.alert.textContent = '';
    }

    function otherKey() {
      if (!bundle.enabled || !bundle.keys) { return null; }
      for (var i = 0; i < bundle.keys.length; i++) {
        if (bundle.keys[i] !== state.key && products[bundle.keys[i]]) { return bundle.keys[i]; }
      }
      return null;
    }

    function renderBundle() {
      if (!el.bundle || !bundle.enabled) { return; }

      var a = bundle.keys[0];
      var b = bundle.keys[1];
      if (!products[a] || !products[b]) { el.bundle.hidden = true; return; }
      el.bundle.hidden = false;

      var haveA = !!state.inCart[a];
      var haveB = !!state.inCart[b];
      var full = products[a].priceFrom + products[b].priceFrom;
      var saved = bundle.discountCents;

      el.bundle.classList.toggle('is-complete', haveA && haveB);

      if (haveA && haveB) {
        el.bundleEyebrow.textContent = 'Your set is complete';
        el.bundleBody.textContent = products[a].switchLabel + ' + ' + products[b].switchLabel;
        el.bundleMath.innerHTML =
          '<span class="bset-bundle__row bset-bundle__row--save">' +
            '<span>Bundle saving</span><span>&minus;' + formatMoney(saved, money) + '</span>' +
          '</span>';
        el.bundleCta.hidden = true;
        return;
      }

      if (haveA || haveB) {
        var missingKey = haveA ? b : a;
        var missing = products[missingKey];
        el.bundleEyebrow.textContent = 'Complete your set';
        el.bundleBody.textContent =
          'Add a ' + missing.switchLabel + ' and unlock your bundle saving of ' +
          formatMoney(saved, money) + '.';
        el.bundleMath.innerHTML = '';
        el.bundleCta.hidden = false;
        el.bundleCta.textContent = 'Add ' + missing.switchLabel;
        el.bundleCta.setAttribute('data-bset-bundle-cta', missingKey);
        return;
      }

      el.bundleEyebrow.textContent = bundle.title || 'Build your set';
      el.bundleBody.textContent = 'Buy the ' + products[a].switchLabel + ' and the ' +
        products[b].switchLabel + ' together.';
      el.bundleMath.innerHTML =
        '<span class="bset-bundle__row bset-bundle__row--strike">' +
          '<span>Bought separately</span><span>' + formatMoney(full, money) + '</span>' +
        '</span>' +
        '<span class="bset-bundle__row"><span>Set price</span><span>' +
          formatMoney(full - saved, money) + '</span></span>' +
        '<span class="bset-bundle__row bset-bundle__row--save">' +
          '<span>You save</span><span>' + formatMoney(saved, money) + '</span>' +
        '</span>';
      el.bundleCta.hidden = true;
    }

    function renderAll() {
      renderPanels();
      renderOptions();
      renderGallery();
      renderDescription();
      renderTotals();
      renderBuyState();
      renderBundle();
    }

    /* ---- real cart state ----------------------------------------------- */
    function readCart() {
      var rootUrl = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
      return fetch(rootUrl + 'cart.js', { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (cart) {
          keys.forEach(function (key) {
            state.inCart[key] = (cart.items || []).some(function (item) {
              return String(item.product_id) === String(products[key].id);
            });
          });
          renderBundle();
          renderTotals();
        })
        .catch(function () { /* cart unreachable — bundle panel keeps its last good state */ });
    }

    /* ---- interaction ---------------------------------------------------- */
    root.addEventListener('click', function (event) {
      var target = event.target;

      var categoryBtn = target.closest('[data-bset-category]');
      if (categoryBtn && root.contains(categoryBtn)) {
        event.preventDefault();
        selectCategory(categoryBtn.getAttribute('data-bset-category'));
        return;
      }

      var switcher = target.closest('[data-bset-switch]');
      if (switcher && root.contains(switcher)) {
        event.preventDefault();
        selectProduct(switcher.getAttribute('data-bset-switch'));
        return;
      }

      var value = target.closest('[data-bset-value]');
      if (value && root.contains(value) && !value.disabled) {
        event.preventDefault();
        var idx = parseInt(value.getAttribute('data-bset-option-index'), 10);
        var chosen = value.getAttribute('data-bset-value');
        var selection = state.selections[state.key];
        selection[idx] = (selection[idx] === chosen && SIZE_LIKE.test(currentProduct().options[idx].name))
          ? null
          : chosen;
        renderAll();
        return;
      }

      var step = target.closest('[data-bset-qty-step]');
      if (step && root.contains(step)) {
        event.preventDefault();
        setQty(state.qty[state.key] + parseInt(step.getAttribute('data-bset-qty-step'), 10));
        return;
      }

      var cta = target.closest('[data-bset-bundle-cta]');
      if (cta && root.contains(cta) && !cta.hidden) {
        event.preventDefault();
        selectProduct(cta.getAttribute('data-bset-bundle-cta'));
        var firstOption = root.querySelector('[data-bset-for="' + state.key + '"] [data-bset-value]:not([disabled])');
        if (firstOption) { firstOption.focus(); }
        return;
      }
    });

    if (el.qtyInput) {
      el.qtyInput.addEventListener('change', function () {
        setQty(parseInt(el.qtyInput.value, 10));
      });
    }

    function setQty(next) {
      if (isNaN(next) || next < 1) { next = 1; }
      if (next > 99) { next = 99; }
      state.qty[state.key] = next;
      if (el.qtyInput) { el.qtyInput.value = next; }
      renderTotals();
      renderBuyState();
    }

    function selectProduct(key) {
      if (!products[key] || key === state.key) { return; }
      state.key = key;
      renderAll();
    }

    /* Switching Cards <-> Wristbands: updates the tabs and descriptions,
       scopes the Product switcher to just this category's slots (hiding it
       entirely when the category holds only one real product - no point
       showing a switcher with a single, permanently-pressed button), and
       jumps to that category's first slot if the current one doesn't
       belong to it. */
    function selectCategory(catKey) {
      var cat = null;
      for (var i = 0; i < categories.length; i++) {
        if (categories[i].key === catKey) { cat = categories[i]; break; }
      }
      if (!cat) { return; }
      state.category = catKey;

      el.categoryTabs.forEach(function (btn) {
        var on = btn.getAttribute('data-bset-category') === catKey;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      el.categoryDescs.forEach(function (node) {
        node.classList.toggle('is-active', node.getAttribute('data-bset-cat-desc') === catKey);
      });

      var multi = cat.slots.length > 1;
      if (el.switchWrap) { el.switchWrap.hidden = !multi; }
      all('[data-bset-switch]', root).forEach(function (btn) {
        btn.hidden = cat.slots.indexOf(btn.getAttribute('data-bset-switch')) === -1;
      });

      if (cat.slots.indexOf(state.key) === -1) { state.key = cat.slots[0]; }
      renderAll();
    }

    /* ---- submit guard -----------------------------------------------------
       Runs before the theme's delegated document-level handler. If the
       selection is incomplete we stop the event here so nothing reaches the
       cart; otherwise we let it bubble and optiq-cart.js takes over. */
    if (el.form) {
      el.form.addEventListener('submit', function (event) {
        var key = state.key;
        var product = products[key];
        var selection = state.selections[key];

        if (!product.available) {
          event.preventDefault();
          event.stopPropagation();
          showAlert(product.title + ' is not available for purchase yet.');
          return;
        }

        for (var i = 0; i < selection.length; i++) {
          if (selection[i] === null) {
            event.preventDefault();
            event.stopPropagation();
            showAlert('Please select a ' + product.options[i].name.toLowerCase() + '.');
            var pending = root.querySelector(
              '[data-bset-for="' + key + '"] [data-bset-option-index="' + i + '"]:not([disabled])'
            );
            if (pending) { pending.focus(); }
            return;
          }
        }

        var variant = findVariant(key, selection);
        if (!variant || !variant.available) {
          event.preventDefault();
          event.stopPropagation();
          showAlert('That combination is currently unavailable. Please choose another.');
          return;
        }

        el.variantId.value = variant.id;
        el.qtyInput.value = state.qty[key];
        clearAlert();
        /* allowed through to optiq-cart.js */
      });
    }

    /* The theme's cart controller fires this after every successful change. */
    document.addEventListener('optiq:cart:updated', readCart);

    if (categories.length) {
      selectCategory(state.category || categories[0].key);
    } else {
      renderAll();
    }
    readCart();
  }

  /* ---- boot ------------------------------------------------------------- */
  function init() {
    all('[data-bset-root]').forEach(function (root) {
      if (root.dataset.bsetReady === '1') { return; }
      root.dataset.bsetReady = '1';
      BuildSet(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
