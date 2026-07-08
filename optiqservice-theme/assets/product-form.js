/* ==========================================================================
   product-form.js — variant picker + Add to Cart / Buy Now on the product page
   --------------------------------------------------------------------------
   - Reads the real product JSON printed by main-product.liquid.
   - When the shopper picks options (colour/style, pack size, QR yes/no), it
     finds the matching Shopify variant and updates the price, the buy buttons,
     and the gallery image — all from real variant data, so prices are always
     the exact Shopify variant prices (no custom price math).
   - Add to Cart and Buy Now send the EXACT selected variant to Shopify's cart
     via OptiqCart (assets/cart.js). Buy Now then jumps to Shopify checkout.
   ========================================================================== */
(function () {
  'use strict';

  function money(cents) {
    return window.OptiqCart ? OptiqCart.formatMoney(cents) : '$' + (cents / 100).toFixed(2);
  }

  function initForm(form) {
    var dataEl = form.parentNode.querySelector('[data-product-json]') ||
                 document.querySelector('[data-product-json]');
    if (!dataEl) { return; }

    var product;
    try { product = JSON.parse(dataEl.textContent); } catch (e) { return; }

    var idInput = form.querySelector('[name="id"]');
    var priceEl = document.querySelector('[data-product-price]');
    var addBtn = form.querySelector('[data-add-to-cart]');
    var buyBtn = form.querySelector('[data-buy-now]');
    var qtyInput = form.querySelector('[name="quantity"]');

    /* ---- read the shopper's current option choices ---- */
    function selectedOptions() {
      var opts = [];
      form.querySelectorAll('[data-option-index]').forEach(function (group) {
        var idx = parseInt(group.getAttribute('data-option-index'), 10);
        var checked = group.querySelector('input:checked');
        if (checked) { opts[idx] = checked.value; }
        // reflect selection visually
        group.querySelectorAll('.product-option__value').forEach(function (lbl) {
          lbl.classList.toggle('is-selected', lbl.querySelector('input').checked);
        });
      });
      return opts;
    }

    function findVariant(opts) {
      if (product.variants.length === 1) { return product.variants[0]; }
      for (var i = 0; i < product.variants.length; i++) {
        var v = product.variants[i];
        var match = true;
        for (var j = 0; j < opts.length; j++) {
          if (opts[j] != null && v.options[j] !== opts[j]) { match = false; break; }
        }
        if (match) { return v; }
      }
      return null;
    }

    function syncGalleryImage(variant) {
      var mediaId = (variant.featured_media && variant.featured_media.id) ||
                    (variant.featured_image && variant.featured_image.id);
      if (!mediaId) { return; }
      var thumb = document.querySelector('[data-pg-thumb][data-media-id="' + mediaId + '"]');
      if (thumb) { thumb.click(); } // reuses the gallery's own switching logic
    }

    function update() {
      var variant = findVariant(selectedOptions());
      if (!variant) {
        idInput.value = '';
        if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Unavailable combination'; }
        if (buyBtn) { buyBtn.disabled = true; }
        return;
      }
      idInput.value = variant.id;
      if (priceEl) { priceEl.textContent = money(variant.price); }
      if (addBtn) {
        addBtn.disabled = !variant.available;
        addBtn.textContent = variant.available ? (addBtn.getAttribute('data-label') || 'Add to Cart') : 'Sold out';
      }
      if (buyBtn) { buyBtn.disabled = !variant.available; }
      syncGalleryImage(variant);
    }

    /* ---- gather personalization fields as line-item properties ---- */
    function gatherProperties() {
      var props = {};
      form.querySelectorAll('[name^="properties["]').forEach(function (inp) {
        var m = inp.name.match(/properties\[(.+)\]/);
        if (m && inp.value) { props[m[1]] = inp.value; }
      });
      return props;
    }

    function currentItem() {
      return {
        id: idInput.value,
        quantity: parseInt((qtyInput && qtyInput.value) || '1', 10),
        properties: gatherProperties()
      };
    }

    function valid() {
      if (!idInput.value) { return false; }
      return form.reportValidity ? form.reportValidity() : true;
    }

    /* ---- events ---- */
    form.addEventListener('change', function (e) {
      if (e.target.closest('[data-option-index]')) { update(); }
    });

    // quantity stepper
    form.addEventListener('click', function (e) {
      if (!qtyInput) { return; }
      if (e.target.closest('[data-qty-inc]')) {
        qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
      } else if (e.target.closest('[data-qty-dec]')) {
        qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!valid()) { return; }
      OptiqCart.add([currentItem()]);
    });

    if (buyBtn) {
      buyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!valid()) { return; }
        OptiqCart.addAndCheckout([currentItem()]);
      });
    }

    update();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-product-form]').forEach(initForm);
  });
})();
