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

    /* ---- state --------------------------------------------------------- */
    var state = {
      key: keys[0],
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
      bundleCta: root.querySelector('[data-bset-bundle-cta]')
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

    function renderGallery() {
      var key = state.key;
      var gallery = root.querySelector('[data-bset-gallery="' + key + '"]');
      if (!gallery) { return; }

      var lead = state.selections[key][0];
      var shots = all('[data-shot]', gallery);
      if (!shots.length) { return; }

      var target = shots.filter(function (shot) {
        return shot.getAttribute('data-shot-value') === lead;
      })[0] || shots[0];

      setShot(gallery, target.getAttribute('data-shot'));
    }

    function setShot(gallery, index) {
      all('[data-shot]', gallery).forEach(function (shot) {
        shot.classList.toggle('is-active', shot.getAttribute('data-shot') === index);
      });
      all('[data-shot-go]', gallery).forEach(function (control) {
        var on = control.getAttribute('data-shot-go') === index;
        control.classList.toggle('is-active', on);
        control.setAttribute('aria-pressed', on ? 'true' : 'false');
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

      var reason = '';
      if (!product.available) {
        reason = product.title + ' is not available for purchase yet.';
      } else {
        var missing = -1;
        for (var i = 0; i < selection.length; i++) { if (selection[i] === null) { missing = i; break; } }
        if (missing !== -1) {
          reason = '';   // not an error until they try to buy
        } else if (!variant || !variant.available) {
          reason = 'Currently unavailable in this combination.';
        }
      }

      var buyable = product.available && !!variant && variant.available;
      if (el.addBtn) {
        el.addBtn.disabled = !buyable;
        el.addBtn.textContent = product.available
          ? (buyable ? 'Add to Cart' : 'Currently Unavailable')
          : 'Coming Soon';
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

      var shotGo = target.closest('[data-shot-go]');
      if (shotGo && root.contains(shotGo)) {
        event.preventDefault();
        setShot(shotGo.closest('[data-bset-gallery]'), shotGo.getAttribute('data-shot-go'));
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

    /* ---- submit guard ---------------------------------------------------
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

    renderAll();
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
