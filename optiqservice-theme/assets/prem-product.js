/* ==========================================================================
   PREM PRODUCT DETAIL
   --------------------------------------------------------------------------
   Drives the gallery, quantity stepper and option/variant picker on a
   single-product prem- PDP (sections/prem-product.liquid).

   Deliberately does NOT implement its own add-to-cart. The purchase panel is
   a real Shopify {% form 'product' %} - assets/optiq-cart.js already
   intercepts its submit, adds via /cart/add.js, forwards every
   name="properties[...]" field (business name / review link / contact) as a
   line item property, and repaints the cart drawer. This file only keeps the
   form's hidden variant id and quantity correct as the shopper picks options,
   same division of labour as assets/optiq-buildset.js on the Build Your Set
   page - just without a product switcher or bundle, since this page is
   always exactly one product.
   ========================================================================== */
(function () {
  'use strict';

  function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

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

  function sameOptions(a, b) {
    if (!a || !b || a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }

  function PremPdp(root) {
    var payloadEl = root.querySelector('[data-prem-pdp-data]');
    if (!payloadEl) { return; }

    var data;
    try { data = JSON.parse(payloadEl.textContent); }
    catch (err) {
      if (window.console) { console.error('[prem pdp] bad payload', err); }
      return;
    }

    var variants = data.variants || [];
    var names = data.optionNames || [];
    var money = data.moneyFormat;

    var el = {
      variantId: root.querySelector('[data-prem-variant-id]'),
      qty: root.querySelector('[data-prem-qty-input]'),
      price: root.querySelector('[data-prem-price]'),
      compare: root.querySelector('[data-prem-compare]'),
      submit: root.querySelector('[data-prem-submit]'),
      gallery: root.querySelector('[data-prem-gallery]')
    };

    var values = all('[data-prem-value]', root);

    /* Filled in by the gallery block below before the first render() runs,
       so selecting an option that has its own Shopify-assigned image jumps
       the gallery to it - null on a page with only one image. */
    var showMediaFn = null;

    /* Starting selection: whichever chip/swatch already carries
       aria-pressed="true" from Liquid's own selected_or_first_available
       resolution, falling back to the first variant's own options. */
    var chosen = names.map(function (_, i) {
      var active = values.filter(function (v) {
        return parseInt(v.getAttribute('data-prem-option-index'), 10) === i &&
          v.getAttribute('aria-pressed') === 'true';
      })[0];
      return active ? active.getAttribute('data-prem-value') : (variants[0] ? variants[0].opts[i] : null);
    });

    function find(choice) {
      for (var i = 0; i < variants.length; i++) {
        if (sameOptions(variants[i].opts, choice)) { return variants[i]; }
      }
      return null;
    }

    function ifSwapped(index, value) {
      var probe = chosen.slice();
      probe[index] = value;
      return find(probe);
    }

    function render() {
      var current = find(chosen);

      values.forEach(function (btn) {
        var i = parseInt(btn.getAttribute('data-prem-option-index'), 10);
        var value = btn.getAttribute('data-prem-value');
        var active = chosen[i] === value;
        var candidate = ifSwapped(i, value);
        var offerable = !!(candidate && candidate.available);

        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.classList.toggle('is-unavailable', !offerable);
        btn.disabled = !offerable && !active;
      });

      if (!current) {
        if (el.submit) { el.submit.disabled = true; el.submit.textContent = 'Unavailable'; }
        return;
      }

      if (el.variantId) { el.variantId.value = current.id; }
      if (el.price) { el.price.textContent = formatMoney(current.price * 100, money); }

      if (el.compare) {
        var hasCompare = current.compareAtPrice > current.price;
        el.compare.textContent = hasCompare ? formatMoney(current.compareAtPrice * 100, money) : '';
        el.compare.hidden = !hasCompare;
      }

      if (el.submit) {
        el.submit.disabled = !current.available;
        el.submit.textContent = current.available ? data.buyLabel : 'Sold out';
      }

      if (showMediaFn && current.mediaId) { showMediaFn(current.mediaId); }

      /* Keeps the address bar shareable and the back button meaningful
         without reloading the page. */
      if (window.history && window.history.replaceState) {
        var url = new URL(window.location.href);
        url.searchParams.set('variant', current.id);
        window.history.replaceState({}, '', url);
      }
    }

    values.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) { return; }
        var i = parseInt(btn.getAttribute('data-prem-option-index'), 10);
        chosen[i] = btn.getAttribute('data-prem-value');
        render();
      });
    });

    /* ?qr=1 arrives from other pages linking straight to the QR option -
       preselect it rather than silently ignoring the intent. */
    if (new URLSearchParams(window.location.search).get('qr') === '1') {
      names.forEach(function (name, i) {
        if (!/qr/i.test(String(name))) { return; }
        values.forEach(function (btn) {
          if (parseInt(btn.getAttribute('data-prem-option-index'), 10) !== i) { return; }
          if (/with|yes/i.test(btn.getAttribute('data-prem-value'))) { chosen[i] = btn.getAttribute('data-prem-value'); }
        });
      });
    }

    /* ---- Quantity ---- */
    if (el.qty) {
      all('[data-prem-qty-step]', root).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var next = (parseInt(el.qty.value, 10) || 1) + parseInt(btn.getAttribute('data-prem-qty-step'), 10);
          el.qty.value = next < 1 ? 1 : next;
        });
      });
    }

    /* ---- Gallery: crossfade + thumbs + arrows + swipe ----
       Wired before the first render() call so a variant with its own
       featured_media can jump straight to the right image on load. */
    if (el.gallery) {
      var shots = all('[data-shot]', el.gallery);
      var thumbs = all('[data-shot-go]', root);
      var index = 0;

      var show = function (i) {
        if (!shots.length) { return; }
        if (i < 0) { i = shots.length - 1; }
        if (i >= shots.length) { i = 0; }
        shots.forEach(function (s, n) { s.classList.toggle('is-active', n === i); });
        thumbs.forEach(function (t, n) {
          var on = n === i;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        index = i;
      };

      showMediaFn = function (id) {
        for (var i = 0; i < shots.length; i++) {
          if (shots[i].getAttribute('data-media-id') === String(id)) { show(i); return; }
        }
      };

      var prev = root.querySelector('[data-prem-prev]');
      var next = root.querySelector('[data-prem-next]');
      if (prev) { prev.addEventListener('click', function () { show(index - 1); }); }
      if (next) { next.addEventListener('click', function () { show(index + 1); }); }

      thumbs.forEach(function (t) {
        t.addEventListener('click', function () { show(parseInt(t.getAttribute('data-shot-go'), 10) || 0); });
      });

      var startX = null, startY = null;
      el.gallery.addEventListener('touchstart', function (e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }, { passive: true });
      el.gallery.addEventListener('touchend', function (e) {
        if (startX === null) { return; }
        var dx = e.changedTouches[0].clientX - startX;
        var dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) { show(dx < 0 ? index + 1 : index - 1); }
        startX = null;
      }, { passive: true });
    }

    render();
  }

  function init() {
    all('[data-prem-pdp]').forEach(function (root) {
      if (root.dataset.premPdpReady === '1') { return; }
      root.dataset.premPdpReady = '1';
      PremPdp(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
