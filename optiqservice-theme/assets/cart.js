/* ==========================================================================
   OptiqCart — real Shopify AJAX cart controller + drawer
   --------------------------------------------------------------------------
   Talks to Shopify's native cart endpoints (/cart/add.js, /cart/change.js,
   /cart.js). The cart is stored server-side by Shopify, so it persists across
   page refreshes and devices automatically — no localStorage needed.

   Public API (use from anywhere):
     OptiqCart.add(items)        -> add one or more line items, opens drawer
     OptiqCart.addAndCheckout(items) -> add then go straight to checkout (Buy Now)
     OptiqCart.changeLine(i, q)  -> set quantity of line i (1-based); 0 removes it
     OptiqCart.refresh()         -> re-fetch cart and re-render drawer + count
     OptiqCart.open() / .close() -> show / hide the drawer

   `items` is an array of { id: VARIANT_ID, quantity: N, properties?: {...},
                            selling_plan?: PLAN_ID }
   ========================================================================== */
(function () {
  'use strict';

  var ROOT = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  var SETTINGS = window.OptiqSettings || {};

  /* ---- money formatting (mirrors Shopify's money_format) ---- */
  function formatMoney(cents, format) {
    if (typeof cents === 'string') { cents = cents.replace('.', ''); }
    var value = '';
    var fmt = format || SETTINGS.moneyFormat || '${{amount}}';
    var placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;

    function defaultTo(num, precision, thousands, decimal) {
      thousands = thousands || ',';
      decimal = decimal || '.';
      if (isNaN(num) || num == null) { return 0; }
      num = (num / 100.0).toFixed(precision);
      var parts = num.split('.');
      var dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
      var cents = parts[1] ? decimal + parts[1] : '';
      return dollars + cents;
    }

    switch ((fmt.match(placeholderRegex) || [])[1]) {
      case 'amount': value = defaultTo(cents, 2); break;
      case 'amount_no_decimals': value = defaultTo(cents, 0); break;
      case 'amount_with_comma_separator': value = defaultTo(cents, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = defaultTo(cents, 0, '.', ','); break;
      case 'amount_with_space_separator': value = defaultTo(cents, 2, ' ', ','); break;
      default: value = defaultTo(cents, 2);
    }
    return fmt.replace(placeholderRegex, value);
  }

  /* ---- low-level requests ---- */
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); });
  }

  function getCart() {
    return fetch(ROOT + 'cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); });
  }

  /* ---- toast (small confirmation / error message) ---- */
  function toast(msg, isError) {
    var el = document.querySelector('[data-cart-toast]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-cart-toast', '');
      el.className = 'cart-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('cart-toast--error', !!isError);
    el.classList.add('is-visible');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
  }

  /* ---- drawer rendering ---- */
  function updateCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach(function (n) {
      n.textContent = count;
      n.hidden = count === 0;
    });
  }

  function lineProperties(props) {
    if (!props) { return ''; }
    var rows = '';
    Object.keys(props).forEach(function (key) {
      if (key.charAt(0) === '_') { return; }            // hidden props start with _
      if (props[key] === '' || props[key] == null) { return; }
      rows += '<div>' + escapeHtml(key) + ': ' + escapeHtml(props[key]) + '</div>';
    });
    return rows ? '<div class="cart-line__props">' + rows + '</div>' : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderDrawer(cart) {
    var body = document.querySelector('[data-cart-body]');
    var footer = document.querySelector('[data-cart-footer]');
    if (!body) { return; }

    if (!cart.items || cart.items.length === 0) {
      body.innerHTML = '<div class="cart-drawer__empty"><p>Your cart is empty.</p>' +
        '<a class="btn btn--primary" href="' + ROOT + 'collections/all" data-cart-close>Browse cards</a></div>';
      if (footer) { footer.hidden = true; }
      return;
    }

    var html = '';
    cart.items.forEach(function (item, idx) {
      var line = idx + 1; // Shopify change.js lines are 1-based
      var img = item.image
        ? '<img class="cart-line__img" src="' + item.image.replace(/(\.[^.\/]+)(\?.*)?$/, '_160x$1$2') + '" alt="' + escapeHtml(item.product_title) + '">'
        : '<div class="cart-line__img"></div>';
      var variant = (item.variant_title && item.variant_title !== 'Default Title')
        ? ' — ' + escapeHtml(item.variant_title) : '';
      var recurring = '';
      if (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan) {
        recurring = '<span class="cart-line__recurring">' +
          escapeHtml(item.selling_plan_allocation.selling_plan.name) + '</span>';
      }
      html +=
        '<div class="cart-line" data-line="' + line + '">' +
          img +
          '<div class="cart-line__info">' +
            '<div class="cart-line__title">' + escapeHtml(item.product_title) + variant + '</div>' +
            recurring +
            lineProperties(item.properties) +
            '<button type="button" class="cart-line__remove" data-cart-remove="' + line + '">Remove</button>' +
          '</div>' +
          '<div class="cart-line__qty">' +
            '<button type="button" data-cart-dec="' + line + '" aria-label="Decrease">&minus;</button>' +
            '<span data-line-qty>' + item.quantity + '</span>' +
            '<button type="button" data-cart-inc="' + line + '" aria-label="Increase">&plus;</button>' +
          '</div>' +
          '<div class="cart-line__price">' + formatMoney(item.final_line_price) + '</div>' +
        '</div>';
    });
    body.innerHTML = html;

    if (footer) {
      footer.hidden = false;
      var subEl = footer.querySelector('[data-cart-subtotal]');
      if (subEl) { subEl.textContent = formatMoney(cart.items_subtotal_price); }
      var savings = footer.querySelector('[data-cart-savings]');
      if (savings) {
        if (cart.total_discount && cart.total_discount > 0) {
          savings.hidden = false;
          savings.textContent = 'You saved ' + formatMoney(cart.total_discount);
        } else { savings.hidden = true; }
      }
    }
  }

  function render(cart) {
    updateCount(cart.item_count);
    renderDrawer(cart);
  }

  /* ---- drawer open/close ---- */
  function open() {
    var drawer = document.querySelector('[data-cart-drawer]');
    if (!drawer) { return; }
    drawer.classList.add('is-open');
    document.body.classList.add('cart-open');
    var closeBtn = drawer.querySelector('[data-cart-close]');
    if (closeBtn) { closeBtn.focus(); }
  }
  function close() {
    var drawer = document.querySelector('[data-cart-drawer]');
    if (!drawer) { return; }
    drawer.classList.remove('is-open');
    document.body.classList.remove('cart-open');
  }

  /* ---- public actions ---- */
  function refresh() { return getCart().then(function (cart) { render(cart); return cart; }); }

  function add(items, opts) {
    opts = opts || {};
    return postJSON(ROOT + 'cart/add.js', { items: items }).then(function (res) {
      if (!res.ok) {
        toast((res.data && res.data.description) || 'Could not add to cart.', true);
        return Promise.reject(res.data);
      }
      return refresh().then(function (cart) {
        if (!opts.silent) { open(); }
        return cart;
      });
    });
  }

  function addAndCheckout(items) {
    return postJSON(ROOT + 'cart/add.js', { items: items }).then(function (res) {
      if (!res.ok) {
        toast((res.data && res.data.description) || 'Could not add to cart.', true);
        return Promise.reject(res.data);
      }
      window.location.href = ROOT + 'checkout';
    });
  }

  function changeLine(line, quantity) {
    return postJSON(ROOT + 'cart/change.js', { line: line, quantity: quantity })
      .then(function (res) { render(res.data); return res.data; });
  }

  /* ---- delegated event wiring ---- */
  document.addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest('[data-cart-toggle]')) { e.preventDefault(); refresh().then(open); return; }
    if (t.closest('[data-cart-close]') || t.hasAttribute('data-cart-overlay')) { close(); return; }

    /* Generic "add this variant" button (membership, homepage quick-add, etc.).
       If no variant id is configured yet, fall back to a normal link so the
       button is never dead. */
    var addBtn = t.closest('[data-add-variant]');
    if (addBtn) {
      var id = addBtn.getAttribute('data-add-variant');
      var fallback = addBtn.getAttribute('data-fallback') || addBtn.getAttribute('href');
      if (!id) {
        if (fallback) { e.preventDefault(); window.location.href = fallback; }
        return; // let a real <a href> work on its own if no fallback attr
      }
      e.preventDefault();
      var item = { id: id, quantity: parseInt(addBtn.getAttribute('data-quantity') || '1', 10) };
      var plan = addBtn.getAttribute('data-selling-plan');
      if (plan) { item.selling_plan = plan; }
      if (addBtn.hasAttribute('data-buy-now')) { addAndCheckout([item]); }
      else { add([item]); }
      return;
    }

    var inc = t.closest('[data-cart-inc]');
    if (inc) {
      var lineI = parseInt(inc.getAttribute('data-cart-inc'), 10);
      var q = parseInt(inc.closest('.cart-line').querySelector('[data-line-qty]').textContent, 10);
      changeLine(lineI, q + 1); return;
    }
    var dec = t.closest('[data-cart-dec]');
    if (dec) {
      var lineD = parseInt(dec.getAttribute('data-cart-dec'), 10);
      var qd = parseInt(dec.closest('.cart-line').querySelector('[data-line-qty]').textContent, 10);
      changeLine(lineD, Math.max(0, qd - 1)); return;
    }
    var rem = t.closest('[data-cart-remove]');
    if (rem) { changeLine(parseInt(rem.getAttribute('data-cart-remove'), 10), 0); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { close(); }
  });

  /* save the cart note when the drawer note field changes */
  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-cart-note]')) {
      postJSON(ROOT + 'cart/update.js', { note: e.target.value });
    }
  });

  window.OptiqCart = {
    add: add,
    addAndCheckout: addAndCheckout,
    changeLine: changeLine,
    refresh: refresh,
    open: open,
    close: close,
    formatMoney: formatMoney
  };

  document.addEventListener('DOMContentLoaded', refresh);
})();
