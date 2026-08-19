/* OPTIQ - AJAX cart.
   Uses Shopify's Cart API for mutations and the Section Rendering API to
   repaint the drawer, so subtotals always come from Shopify rather than
   being recalculated in the browser (where they can drift out of sync). */
(function () {
  'use strict';

  var SECTION = 'cart-drawer';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function routes() {
    var r = window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    return r || '/';
  }

  function say(msg) { if (window.optiqAnnounce) window.optiqAnnounce(msg); }

  function t(key, fallback) {
    return (window.optiqStrings && window.optiqStrings[key]) || fallback;
  }

  /* Screen-reader announcements alone are silent to a sighted shopper - a
     failed add-to-cart request used to look identical to a dead button.
     This is a plain, dependency-free toast: one shared element, created on
     first use and reused, so a second failure while the first is still
     visible just restarts the timer rather than stacking banners. */
  var toastTimer = null;
  function showCartError(msg) {
    var el = $('[data-o-cart-toast]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-o-cart-toast', '');
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translate(-50%,0);' +
        'max-width:min(92vw,420px);background:#1a1a1a;color:#fff;padding:14px 18px;' +
        'border-radius:8px;font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 8px 28px rgba(0,0,0,0.25);z-index:99998;opacity:0;' +
        'transition:opacity 0.2s ease;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 6000);
  }

  /* Repaint the drawer from server-rendered HTML. */
  function render(sections) {
    var markup = sections && sections[SECTION];
    if (!markup) return;

    var parsed = new DOMParser().parseFromString(markup, 'text/html');
    var fresh = parsed.querySelector('[data-o-cart-content]');
    var mount = $('[data-o-cart-content]');
    if (fresh && mount) mount.innerHTML = fresh.innerHTML;

    var freshCount = parsed.querySelector('[data-o-cart-count-source]');
    if (freshCount) {
      var count = parseInt(freshCount.getAttribute('data-o-cart-count-source'), 10) || 0;
      $$('[data-o-cart-count]').forEach(function (el) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.hidden = count === 0;
      });
    }
  }

  function fail(error) {
    var msg = t('cartError', 'Something went wrong updating your cart. Please try again.');
    say(msg);
    showCartError(msg);
    if (window.console) console.error('[optiq cart]', error);
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.description || data.message || 'Cart request failed');
        return data;
      });
    });
  }

  /* --- Add to cart ------------------------------------------------------ */
  window.optiqAddToCart = function (items, opts) {
    opts = opts || {};
    return post(routes() + 'cart/add.js', { items: items, sections: SECTION })
      .then(function (data) {
        render(data.sections);
        say(t('cartAdded', 'Item added to your cart.'));
        if (opts.openDrawer !== false && window.optiqOpenDrawer) {
          window.optiqOpenDrawer('cart', opts.trigger);
        }
        document.dispatchEvent(new CustomEvent('optiq:cart:updated', { detail: data }));
        return data;
      })
      .catch(function (err) { fail(err); throw err; });
  };

  /* --- Change line quantity --------------------------------------------- */
  function changeLine(key, quantity, lineEl) {
    if (lineEl) lineEl.classList.add('is-busy');

    return post(routes() + 'cart/change.js', { id: key, quantity: quantity, sections: SECTION })
      .then(function (data) {
        render(data.sections);
        say(quantity === 0
          ? t('cartRemoved', 'Item removed from your cart.')
          : t('cartUpdated', 'Cart updated.'));
        document.dispatchEvent(new CustomEvent('optiq:cart:updated', { detail: data }));
        return data;
      })
      .catch(function (err) {
        if (lineEl) lineEl.classList.remove('is-busy');
        fail(err);
      });
  }

  /* --- Delegated events ------------------------------------------------- */

  document.addEventListener('click', function (e) {
    var remove = e.target.closest('[data-o-cart-remove]');
    if (remove) {
      e.preventDefault();
      changeLine(remove.getAttribute('data-o-cart-remove'), 0, remove.closest('[data-o-cart-line]'));
      return;
    }

    var step = e.target.closest('[data-o-qty-step]');
    if (step) {
      e.preventDefault();
      var wrap = step.closest('[data-o-qty]');
      var input = wrap && $('input', wrap);
      if (!input) return;

      var min = parseInt(input.getAttribute('min'), 10);
      if (isNaN(min)) min = 0;
      var next = (parseInt(input.value, 10) || 0) + parseInt(step.getAttribute('data-o-qty-step'), 10);
      if (next < min) next = min;

      input.value = next;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  document.addEventListener('change', function (e) {
    var input = e.target.closest('[data-o-cart-qty]');
    if (!input) return;

    var qty = parseInt(input.value, 10);
    if (isNaN(qty) || qty < 0) qty = 0;
    changeLine(input.getAttribute('data-o-cart-qty'), qty, input.closest('[data-o-cart-line]'));
  });

  /* --- Product forms ----------------------------------------------------
     Intercepts only real product forms; leaves everything else to Shopify.
     A form whose hidden `id` field is missing or empty used to just return
     here and let the click go nowhere - visually identical to a dead
     button. It now blocks the submit explicitly and says why, so a variant
     that failed to resolve is a visible, reportable error instead of a
     silent no-op. */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[action*="/cart/add"]');
    if (!form || form.hasAttribute('data-o-no-ajax')) return;

    var idField = form.querySelector('[name="id"]');
    if (!idField || !idField.value || idField.value === '0') {
      if (window.console) console.error('[optiq cart] submit blocked: no variant id on', form);
      showCartError(t('cartError', 'Please choose an option before adding to cart.'));
      e.preventDefault();
      return;
    }

    e.preventDefault();

    var button = form.querySelector('[type="submit"]');
    var items = [{ id: idField.value, quantity: parseInt((form.querySelector('[name="quantity"]') || {}).value, 10) || 1 }];

    // Carry line item properties through so personalisation is not lost.
    $$('[name^="properties"]', form).forEach(function (field) {
      if (field.type === 'checkbox' && !field.checked) return;
      var match = field.name.match(/properties\[(.+)\]/);
      if (!match) return;
      items[0].properties = items[0].properties || {};
      items[0].properties[match[1]] = field.value;
    });

    if (button) button.setAttribute('data-loading', 'true');

    window.optiqAddToCart(items, { trigger: button })
      .catch(function () {})
      .then(function () { if (button) button.removeAttribute('data-loading'); });
  });
})();
