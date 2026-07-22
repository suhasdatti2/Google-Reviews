/* Product page redesign v2 configurator. Reads a JSON config emitted by the
   section (real Shopify variant IDs + prices), renders bundles, keeps the
   price/summary in sync, and adds the right line item(s) to the cart.
   v2 adds a quantity stepper: "bundleQty" is which bundle is picked (how
   many cards come in it), "orderQty" is how many of that bundle to buy. */
(function () {
  var root = document.querySelector('[data-pdp]');
  if (!root) { return; }
  var dataEl = document.querySelector('[data-card-config]');
  if (!dataEl) { return; }

  var CFG;
  try { CFG = JSON.parse(dataEl.textContent); } catch (e) { return; }

  // cardKey -> bundleQty -> { no:variant, qr:variant }
  var byCard = {};
  CFG.variants.forEach(function (v) {
    var cardKey = v.product + '-' + v.colour;
    if (!byCard[cardKey]) { byCard[cardKey] = {}; }
    if (!byCard[cardKey][v.qty]) { byCard[cardKey][v.qty] = {}; }
    byCard[cardKey][v.qty][v.qr ? 'qr' : 'no'] = v;
  });

  var state = { card: CFG.defaultCard, bundleQty: null, orderQty: 1, qr: false, option: 'onetime' };
  var MAX_ORDER_QTY = 20;

  var mainImage = root.querySelector('[data-pdp-main-image]');
  var thumbs = [].slice.call(root.querySelectorAll('[data-pdp-thumb]'));
  var cardBtns = [].slice.call(root.querySelectorAll('[data-card-option]'));
  var optionBtns = [].slice.call(root.querySelectorAll('[data-option]'));
  var qrInput = root.querySelector('[data-pdp-qr]');
  var bundlesEl = root.querySelector('[data-pdp-bundles]');
  var priceEl = root.querySelector('[data-pdp-price]');
  var compareEl = root.querySelector('[data-pdp-compare]');
  var summarySaveEl = root.querySelector('[data-summary-save-inline]');
  var addBtn = root.querySelector('[data-pdp-add]');
  var addLabelEl = root.querySelector('[data-pdp-add-label]');
  var errorEl = root.querySelector('[data-pdp-error]');
  var form = root.querySelector('[data-pdp-form]');
  var qtyInput = root.querySelector('[data-pdp-qty-input]');
  var qtyMinus = root.querySelector('[data-qty-minus]');
  var qtyPlus = root.querySelector('[data-qty-plus]');

  var sumCard = root.querySelector('[data-summary-card]');
  var sumOption = root.querySelector('[data-summary-option]');
  var sumBundle = root.querySelector('[data-summary-bundle]');

  function money(cents) {
    return ('$' + (cents / 100).toFixed(2)).replace('.00', '');
  }

  function qtysForCard(cardKey) {
    return Object.keys(byCard[cardKey] || {}).map(Number).sort(function (a, b) { return a - b; });
  }

  function variantFor(cardKey, bundleQty, qr) {
    var q = byCard[cardKey] && byCard[cardKey][bundleQty];
    if (!q) { return null; }
    return q[qr ? 'qr' : 'no'] || q.no || q.qr || null;
  }

  // Strike-through unit = price of the smallest bundle in the same card + QR
  // state, divided by its card count. Derived from real variant prices only.
  function baseUnitCents(cardKey, qr) {
    var qtys = qtysForCard(cardKey);
    if (!qtys.length) { return 0; }
    var baseQty = qtys[0];
    var v = variantFor(cardKey, baseQty, qr);
    if (!v) { return 0; }
    return v.price / baseQty;
  }

  function updateThumbs() {
    thumbs.forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-pdp-thumb') === state.card); });
    var card = CFG.cards[state.card];
    if (card && mainImage) { mainImage.src = card.image; mainImage.alt = card.name; }
  }

  function updateCardButtons() {
    cardBtns.forEach(function (b) {
      var on = b.getAttribute('data-card-option') === state.card;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function updateOptionButtons() {
    optionBtns.forEach(function (b) {
      var on = b.getAttribute('data-option') === state.option;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function renderBundles() {
    var qtys = qtysForCard(state.card);
    var productType = CFG.cards[state.card].product;
    var labels = (CFG.bundleLabels && CFG.bundleLabels[productType]) || {};
    bundlesEl.innerHTML = '';
    qtys.forEach(function (qty) {
      var v = variantFor(state.card, qty, state.qr);
      if (!v) { return; }
      var unit = baseUnitCents(state.card, state.qr);
      var regular = Math.round(unit * qty);
      var save = regular - v.price;
      var label = labels[String(qty)] || '';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pdp__bundle' + (qty === state.bundleQty ? ' is-selected' : '');
      btn.setAttribute('data-bundle-qty', qty);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', qty === state.bundleQty ? 'true' : 'false');
      if (!v.available) { btn.classList.add('is-soldout'); }

      var html = '<span class="pdp__check" aria-hidden="true"></span>';
      if (label) { html += '<span class="pdp__bundle-badge">' + label + '</span>'; }
      html += '<span class="pdp__bundle-qty">' + qty + (qty === 1 ? ' Card' : ' Cards') + '</span>';
      html += '<span class="pdp__bundle-prices">';
      if (save > 0) { html += '<span class="pdp__bundle-was">' + money(regular) + '</span>'; }
      html += '<span class="pdp__bundle-now">' + v.priceMoney + '</span>';
      html += '</span>';
      if (save > 0) { html += '<span class="pdp__bundle-save">Save ' + money(save) + '</span>'; }
      btn.innerHTML = html;
      btn.addEventListener('click', function () { state.bundleQty = qty; syncAll(); });
      bundlesEl.appendChild(btn);
    });
  }

  function currentVariant() { return variantFor(state.card, state.bundleQty, state.qr); }

  function updatePricingDisplays() {
    var v = currentVariant();
    if (!v) { return; }
    var unit = baseUnitCents(state.card, state.qr);
    var regularForOne = Math.round(unit * state.bundleQty);
    var saveForOne = regularForOne - v.price;
    var membershipCents = state.option === 'membership' ? CFG.membership.price : 0;

    var totalPrice = (v.price * state.orderQty) + membershipCents;
    var totalRegular = (regularForOne * state.orderQty) + membershipCents;
    var totalSave = saveForOne * state.orderQty;

    priceEl.textContent = money(totalPrice);

    if (totalSave > 0) {
      compareEl.textContent = money(totalRegular);
      compareEl.hidden = false;
      summarySaveEl.textContent = 'You save ' + money(totalSave);
      summarySaveEl.hidden = false;
    } else {
      compareEl.hidden = true;
      summarySaveEl.hidden = true;
    }

    sumCard.textContent = CFG.cards[state.card].name + (state.qr ? ' + QR' : '');
    sumOption.textContent = state.option === 'membership'
      ? 'One-Time + Review Growth Plan (' + CFG.membership.priceMoney + '/mo)'
      : 'One-Time Purchase';
    sumBundle.textContent = state.bundleQty + (state.bundleQty === 1 ? ' Card' : ' Cards')
      + (state.orderQty > 1 ? ' x ' + state.orderQty : '');

    if (qtyInput) { qtyInput.value = state.orderQty; }
    if (qtyMinus) { qtyMinus.disabled = state.orderQty <= 1; }
    if (qtyPlus) { qtyPlus.disabled = state.orderQty >= MAX_ORDER_QTY; }

    var available = !!v.available;
    addBtn.disabled = !available;
    addBtn.classList.toggle('is-disabled', !available);
  }

  function syncAll() {
    var qtys = qtysForCard(state.card);
    if (qtys.indexOf(state.bundleQty) === -1) { state.bundleQty = qtys[0]; }
    updateThumbs();
    updateCardButtons();
    updateOptionButtons();
    renderBundles();
    updatePricingDisplays();
  }

  function selectCard(key) { if (!byCard[key]) { return; } state.card = key; state.bundleQty = qtysForCard(key)[0]; syncAll(); }
  cardBtns.forEach(function (b) { b.addEventListener('click', function () { selectCard(b.getAttribute('data-card-option')); }); });
  thumbs.forEach(function (t) { t.addEventListener('click', function () { selectCard(t.getAttribute('data-pdp-thumb')); }); });
  optionBtns.forEach(function (b) { b.addEventListener('click', function () { state.option = b.getAttribute('data-option'); syncAll(); }); });
  if (qrInput) { qrInput.addEventListener('change', function () { state.qr = qrInput.checked; syncAll(); }); }

  if (qtyMinus) { qtyMinus.addEventListener('click', function () { if (state.orderQty > 1) { state.orderQty -= 1; updatePricingDisplays(); } }); }
  if (qtyPlus) { qtyPlus.addEventListener('click', function () { if (state.orderQty < MAX_ORDER_QTY) { state.orderQty += 1; updatePricingDisplays(); } }); }

  // Keyboard arrow support for the radio groups.
  ['[data-card-group] .pdp__cards', '[data-option-group] .pdp__options'].forEach(function (sel) {
    var group = root.querySelector(sel);
    if (!group) { return; }
    group.addEventListener('keydown', function (e) {
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].indexOf(e.key) === -1) { return; }
      var items = [].slice.call(group.querySelectorAll('[role="radio"]'));
      var idx = items.indexOf(document.activeElement);
      if (idx === -1) { return; }
      e.preventDefault();
      var dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      var next = items[(idx + dir + items.length) % items.length];
      next.focus();
      next.click();
    });
  });

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
  function clearError() { errorEl.hidden = true; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();

    var v = currentVariant();
    if (!v) { showError('Please choose a card and bundle.'); return; }
    if (!v.available) { showError('That combination is sold out. Try another bundle.'); return; }

    var business = (root.querySelector('[data-pdp-business]').value || '').trim();
    var link = (root.querySelector('[data-pdp-link]').value || '').trim();
    var contact = (root.querySelector('[data-pdp-contact]').value || '').trim();
    if (!business) { showError('Please enter your business name so we can program your card.'); return; }
    if (!link) { showError('Please paste your Google or Yelp review link (or a note that you will email it).'); return; }
    if (!contact) { showError('Please add a best email or phone in case we have a question.'); return; }

    var items = [{
      id: Number(v.id),
      quantity: state.orderQty,
      properties: {
        'Business name': business,
        'Google review link': link,
        'Contact email or phone': contact,
        'Card design': CFG.cards[state.card].name,
        'Printed QR code': state.qr ? 'Yes' : 'No'
      }
    }];
    if (state.option === 'membership' && CFG.membership.id) {
      items.push({ id: Number(CFG.membership.id), quantity: 1 });
    }

    addBtn.disabled = true;
    var restore = addLabelEl ? addLabelEl.textContent : '';
    if (addLabelEl) { addLabelEl.textContent = 'Adding...'; }

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: items })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok) {
        addBtn.disabled = false;
        if (addLabelEl) { addLabelEl.textContent = restore; }
        showError((res.d && res.d.description) || 'Something went wrong adding to cart. Please try again.');
        return;
      }
      window.location.href = '/cart';
    }).catch(function () {
      addBtn.disabled = false;
      if (addLabelEl) { addLabelEl.textContent = restore; }
      showError('Network error. Please try again.');
    });
  });

  state.bundleQty = qtysForCard(state.card)[0];
  syncAll();
})();
