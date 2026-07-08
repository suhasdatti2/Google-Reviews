# OptiqService — Backend / Store Setup (make every button work)

This theme already contains a **real, working Shopify cart and checkout** — an
AJAX cart drawer, a variant picker that shows exact prices, Add to Cart, Buy
Now, and Add Membership. None of it is fake. But a Shopify theme needs matching
**products** in your Shopify admin before those buttons have anything to add.

This guide walks you, step by step, through creating the products and flipping
on the few settings that connect the buttons. Do it in order and everything
works end-to-end: cart → checkout → payment → order → fulfillment.

> **Honesty note:** payment is handled by Shopify's real checkout (Shopify
> Payments / Stripe / PayPal, whatever you enable). This theme never simulates
> payment. Recurring membership billing needs a subscriptions app (Step 6).

---

## How the pieces fit together

| Shopper action | What the theme does | What you must create |
|---|---|---|
| Picks colour / pack / QR | Reads the real Shopify **variant** and shows its exact price | Products **with variants** (Steps 2–4) |
| Add to Cart / Buy Now | Adds that variant via Shopify's `/cart/add.js`; Buy Now → checkout | Nothing extra — works once the product exists |
| Business name + review link | Saved on the order as **line-item properties** | Nothing — already built into the product page |
| Add Membership | Adds the membership product (recurring) to the cart | Membership product + subscriptions app (Step 6) + paste its variant ID (Step 7) |
| Homepage quick-add buttons | Add a variant if you paste its ID; otherwise link to the product page | Paste variant IDs (Step 8) — optional |
| Checkout | Shopify's hosted, secure checkout collects name, email, phone, address, payment | Turn on a payment provider (Step 9) |

---

## Step 1 — Where everything lives in Shopify

- **Products:** Shopify admin → **Products → Add product**
- **Variants:** created inside a product when you add **Options** (e.g. Colour, Pack)
- **Payments:** **Settings → Payments**
- **Emails:** **Settings → Notifications**
- **Theme settings (variant IDs, membership):** **Online Store → Themes → Customize → Theme settings**
- **Policies:** **Settings → Policies**

---

## Step 2 — Create: Main Counter Card

**Products → Add product.**

- **Title:** `Main Counter Card`
- **Description:** paste your product copy (make it easier to leave a Google review; tap to open; no app, no monthly fee — **do not claim guaranteed reviews**).
- **Media:** upload your real Black and White card photos (you'll attach them to variants in Step 5).
- Scroll to **Variants** and add three options:
  - Option 1 name **Colour** → values `Black`, `White`
  - Option 2 name **Pack** → values `1 Card`, `2 Cards`, `3 Cards`
  - Option 3 name **QR code** → values `No QR`, `With QR (+$5)`

Shopify creates every combination. Set prices like this (QR adds **$5 flat**):

| Colour | Pack | QR code | Price |
|---|---|---|---|
| Black | 1 Card | No QR | 29.99 |
| Black | 1 Card | With QR (+$5) | 34.99 |
| Black | 2 Cards | No QR | 49.99 |
| Black | 2 Cards | With QR (+$5) | 54.99 |
| Black | 3 Cards | No QR | 64.99 |
| Black | 3 Cards | With QR (+$5) | 69.99 |
| White | (same 6 rows, same prices) | | |

> **Why variants instead of a "+$5" script?** With variants, the price the
> shopper sees, the cart, and the checkout are all Shopify's real numbers — they
> can never disagree. The theme's picker automatically shows the right price.

- Set **Inventory → Track quantity = off** (or stock it) so nothing shows sold out by accident.
- Under **Search engine listing / URL handle**, make the handle `main-counter-card`
  (or update the links in the homepage buttons to match — see Step 8).
- Assign the theme template if you want the product FAQ layout: right sidebar
  **Theme template → `product`** (default) or `product.bulk` for handout cards.

---

## Step 3 — Create: Bulk Square Handout Cards

**Products → Add product.**

- **Title:** `Bulk Square Handout Cards`
- **Theme template (right sidebar):** `product.bulk`
- Options:
  - **Colour** → `Black`, `White`
  - **Size** → `10 Cards`, `25 Cards`, `50 Cards`, `100 Cards`
  - **QR code** → `No QR`, `With QR (+$1/card)`

QR here adds **$1 per card**, so add the card count × $1 to each "With QR" row:

| Size | No QR | With QR |
|---|---|---|
| 10 Cards | 49.99 | 59.99 (+$10) |
| 25 Cards | 99.99 | 124.99 (+$25) |
| 50 Cards | 174.99 | 224.99 (+$50) |
| 100 Cards | 299.99 | 399.99 (+$100) |

(Repeat for Black and White.) Handle: `bulk-review-cards`.

---

## Step 4 — Create: Bulk Restaurant Pack

A simple single product (or with a Colour option if you offer both):

- **Title:** `Bulk Restaurant Pack`
- **Price:** set your pack price (e.g. a large mixed quantity for restaurants).
- Handle: `bulk-restaurant-pack`.
- Template: `product.bulk`.

---

## Step 5 — Attach images to variants (so colour changes the photo)

1. Open the product → **Media**: upload every card photo (Black front, White front, etc.).
2. Scroll to **Variants** → click a variant (e.g. *Black / 1 Card / No QR*).
3. On the variant page, under **Media**, click **Add** and pick the Black photo.
4. Repeat for a White variant with the White photo. You only need to set an image
   on **one variant per colour** — the theme jumps the gallery to the colour's
   image when the shopper switches colour.

---

## Step 6 — Membership (recurring monthly billing)

Shopify can't bill monthly on its own — you need a **subscriptions app**. Easiest
and free:

1. **Apps → Shopify App Store → search "Shopify Subscriptions"** (the free
   first-party app) → **Install**.
2. Create the membership product first: **Products → Add product**
   - **Title:** `Review Growth Plan`
   - **Price:** `14.99`
   - **Requires shipping:** **untick** (it's a service, nothing to ship).
   - **Charge tax:** your choice.
   - Handle: `review-growth-plan`.
   - In the description, list what it includes (free link updates, monthly review
     check-in, 20% off future cards, priority support, review request templates)
     and mark it **billed monthly, cancel anytime**. **Do not** promise reviews.
3. Open the **Shopify Subscriptions** app → **Create a subscription plan** →
   attach it to `Review Growth Plan` → **Monthly**, every 1 month → Save.
4. If you prefer more features (customer portal, dunning), **Recharge** or
   **Appstle Subscriptions** work the same way — install, create a monthly
   selling plan on the product.

---

## Step 7 — Connect the "Add Membership" buttons

The theme's membership buttons (product page, cart drawer, membership page) need
the membership's **variant ID** and, for real recurring billing, its **selling
plan ID**.

**Get the variant ID:** Products → `Review Growth Plan` → click the variant →
look at the browser URL: `…/variants/XXXXXXXXXXXXX`. That number is the variant ID.

**Get the selling plan ID:** in the Subscriptions app, open the plan; the ID is in
the URL, or use the theme's "one-time while testing" mode by leaving it blank.

Then in **Online Store → Themes → Customize → Theme settings → Cart & membership**:

- **Membership variant ID** → paste the variant ID
- **Membership selling plan ID** → paste the selling plan ID (blank = one-time charge, fine for testing)
- Save.

Now every "Add Membership" button adds the recurring plan to the cart. Until you
fill these in, those buttons safely link to the membership page instead (never dead).

---

## Step 8 — (Optional) Homepage quick-add buttons

The homepage "Add 1 Card / 2 Cards / …" buttons can either **add straight to the
cart** or **link to the product page**. Linking works with zero setup. To make
them add instantly:

1. Get each pack's variant ID (Step 7 method) — e.g. the *Black / 1 Card / No QR* variant.
2. **Customize → the "Card showcase" section → each "Pricing option" block →
   Variant ID** → paste it.
3. Also set the block's **Product link** to `/products/main-counter-card` (used as the fallback).

If you skip this, the buttons still work — they take the shopper to the product
page where they pick colour/QR and add to cart there.

---

## Step 9 — Turn on real payments + test checkout

1. **Settings → Payments →** activate **Shopify Payments** (cards) and/or PayPal.
   Shopify Payments is Stripe under the hood — it's PCI-compliant and hosted; you
   never touch card data or write payment code.
2. **Test mode:** Settings → Payments → Shopify Payments → **Manage → Test mode ON**,
   or use **bogus gateway** to place fake orders. Test card: `1` repeated (e.g.
   `4242 4242 4242 4242`), any future expiry, any CVC in test mode.
3. Place a full test order (Step 11 checklist). Then turn test mode **off** to go live.

> **Custom / non-Shopify alternative:** if you ever move off Shopify, use
> **Stripe Checkout** (hosted). Your server creates a Checkout Session with the
> line items and returns its URL; the browser redirects there; Stripe handles the
> card form and payment, then redirects back to a success page and sends a webhook
> your server verifies with the signing secret. Never post card numbers to your
> own server. But on Shopify you don't need any of this — Step 9.1 covers it.

---

## Step 10 — Order management flow (what you see after an order)

Every order already carries everything you need. In **Admin → Orders → (order)** you'll see:

- **Customer name, email, phone, shipping address** — collected at checkout.
- **Business name, Google review link, contact** — shown under each line item
  (these are the "line-item properties" the product page captured).
- **Product, variant (colour / pack / QR), quantity** — the line items.
- **Membership yes/no** — a `Review Growth Plan` line (with a subscription badge) if added.
- **Payment status** (Paid / Pending) and **Fulfillment status** (Unfulfilled / Fulfilled).
- **Order notes / special instructions** — in the Notes box.

### Your 7 order statuses (use Tags)

Shopify's built-in statuses are just Paid/Unfulfilled. Add your workflow with
**order tags** (right sidebar of an order → **Tags**). Type and save these as you go:

1. `New Order`
2. `Awaiting Google Link` (customer didn't include a review link)
3. `Ready to Program`
4. `Programmed`
5. `Packed`
6. `Shipped` (set this automatically when you click **Fulfill**)
7. `Completed`

Create a **saved view**: Orders → filter by tag → **Save as** "Awaiting Link",
"Ready to Program", etc. Now you have a mini production board.

**Automate it (optional):** install the free **Shopify Flow** app →
- *When order created → if any line item property "Google review link" is empty →
  add tag `Awaiting Google Link` + send the "request link" email.*
- *Otherwise add tag `Ready to Program`.*

---

## Step 11 — Testing checklist (do this before launch)

Run through every button. Turn on payment **test mode** first (Step 9.2).

**Products & variants**
- [ ] Open Main Counter Card — price shows and updates when you switch Colour, Pack, and QR
- [ ] Switching Black ↔ White changes the main photo
- [ ] Selecting a real combo enables Add to Cart; a disabled/out-of-stock combo shows "Sold out"

**Add to cart**
- [ ] Add to Cart with the personalization fields empty → it blocks you (required)
- [ ] Fill Business name + Google review link + contact → Add to Cart → drawer opens, item shows with those details
- [ ] Cart icon count goes up; refresh the page → cart is still there (Shopify persists it)
- [ ] Add each product: Main Counter (Black + White), Bulk Square (Black + White), Restaurant Pack
- [ ] Add a "With QR" variant → price is higher by the right amount

**Cart drawer**
- [ ] Increase / decrease quantity → subtotal updates
- [ ] Remove an item → it disappears, subtotal updates, count updates
- [ ] Add QR / bulk sizes → bulk price is correct

**Membership**
- [ ] Click "Add Membership" (product page, drawer, or membership page) → membership appears as its **own** line, card stays
- [ ] It shows a "monthly / subscription" label
- [ ] Remove membership → card remains

**Buy Now & checkout**
- [ ] Buy Now on a product → goes straight to checkout with that exact variant
- [ ] From the drawer, Checkout → Shopify checkout opens
- [ ] Checkout collects name, email, phone, shipping address
- [ ] Place a **test** order → it succeeds and appears in Admin → Orders
- [ ] The order shows business name + Google review link under the line item
- [ ] Order-confirmation email arrives

**Emails (Step 12)**
- [ ] Order confirmation received
- [ ] "Request Google link" email fires when the link field was left blank (if you set up Flow)
- [ ] Membership welcome email (if you set one up)

When all boxes pass in test mode, turn test mode off and you're live.

---

## Step 12 — Email templates

Shopify sends order emails automatically. Edit them in **Settings →
Notifications**. Paste these as starting points. Keep the compliance line — never
promise reviews or star ratings.

### 1. Order confirmation
> **Subject:** Your OptiqService order {{ order_name }} is confirmed 🎉
>
> Hi {{ customer.first_name }},
> Thanks for your order! We're getting your tap-to-review card{{ "s" if multiple }} ready.
>
> **What happens next:** we program your card with your Google review link, tap-test it, and ship it. If we're missing your link, we'll email you.
>
> **Your details on file:**
> Business: {{ properties["Business name"] }}
> Google review link: {{ properties["Google review link"] }}
>
> Order total: {{ order_total }}. Questions? Just reply to this email.
> — OptiqService

### 2. Request Google review link (when missing)
> **Subject:** One quick thing to finish your OptiqService order {{ order_name }}
>
> Hi {{ customer.first_name }},
> Your card is ready to program — we just need your **Google review link** so we can load it onto the chip.
>
> **How to find it:** open your Google Business Profile → "Ask for reviews" → copy the short link (looks like `https://g.page/r/…`). Not sure? Reply with your business name and city and we'll find it for you.
>
> Reply to this email with your link and we'll ship right away.
> — OptiqService

### 3. Order programmed
> **Subject:** Your review card is programmed ✅
>
> Hi {{ customer.first_name }},
> Good news — your card is programmed with your Google review link and tap-tested on both iPhone and Android. It's packed and heading out next.
>
> **Tip:** keep it where customers pay. When someone says they had a great experience, hand it over and say "tap this real quick." One tap opens your review page — leaving a review takes seconds.
> — OptiqService

### 4. Order shipped
> **Subject:** Your OptiqService card is on the way 📦
>
> Hi {{ customer.first_name }},
> Your order {{ order_name }} has shipped.
> Tracking: {{ tracking_number }} ({{ tracking_url }})
>
> As soon as it arrives, set it on your counter and start collecting reviews. Questions about placement or wording? Just reply.
> — OptiqService

### 5. Membership welcome (Review Growth Plan)
> **Subject:** Welcome to the Review Growth Plan 🌱
>
> Hi {{ customer.first_name }},
> You're in! Your membership ($14.99/month, cancel anytime) is active. Here's what you get:
> • Free card & Google link updates
> • A monthly review check-in (we'll tell you your current rating and how many new reviews you gained)
> • 20% off future cards
> • A ready-to-use monthly review-request message for your team
> • Priority support
>
> We'll send your first monthly check-in in ~30 days. Reply any time you need us.
> — OptiqService

> Placeholders like `{{ order_name }}` map to Shopify's Liquid notification
> variables. For line-item properties in emails, loop
> `{% for line in line_items %} {{ line.properties["Google review link"] }} {% endfor %}`.

---

## What's in the theme (files you got)

| File | Does |
|---|---|
| `assets/cart.js` | Real AJAX cart: add / change / remove, drawer render, live count, toast, membership add-by-ID |
| `assets/product-form.js` | Variant picker: price + image + availability update, Add to Cart, Buy Now, quantity stepper |
| `snippets/cart-drawer.liquid` | The slide-in cart (rendered from live Shopify cart data) |
| `sections/main-product.liquid` | Product page: options, personalization fields, buy buttons, membership upsell |
| `snippets/card-configurator.liquid` | Homepage buy widget (Counter/Bulk toggle, quantities, custom-amount quote, quick-add) |
| `layout/theme.liquid` | Loads the scripts + drawer, exposes Shopify routes / money format / membership settings |

Every button has a real action, and where an action needs a product that doesn't
exist yet (membership, homepage quick-add), the button falls back to a working
link instead of dying — then upgrades to instant add-to-cart the moment you paste
the variant ID.
