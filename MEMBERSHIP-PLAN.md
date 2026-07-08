# OptiqService — Membership System

An **optional** monthly plan that sits on top of the cards. The cards themselves stay one-time, no-monthly-fee — that promise doesn't change. Membership is for businesses that want ongoing services: free replacements, monthly card restocks, multi-location support, and reporting.

> Compliance: membership never promises reviews or 5-star ratings. Reports show your **existing** review count and growth over time — a factual record, not a guarantee. Everything is framed as service (replacements, restocks, support), not results.

---

## Why add a membership at all?

Your cards are a one-time sale. A membership turns some of those buyers into **recurring revenue** and gives real ongoing value:

- Restaurants burn through bulk handout cards — a monthly restock is genuinely useful.
- Multi-location businesses want one account, not ten separate orders.
- Everyone likes "if it breaks, we replace it free."
- A simple monthly "here's your review count" email keeps you top-of-mind and reduces churn.

It's optional on purpose. The free tier ("just buy a card") keeps the affordable, no-strings promise front and center, which makes the paid tiers feel like a genuine choice rather than a catch.

## The tiers

| | No Membership | Optiq Pro ⭐ | Optiq Business | Optiq Franchise |
|---|---|---|---|---|
| **Price** | $0 | $9.99/mo | $19.99/mo | $49.99/mo |
| **Best for** | One card, no strings | One location | Up to 3 locations | Up to 10 locations |
| **Card is yours forever** | ✓ | ✓ | ✓ | ✓ |
| **Free replacements** | — | 1 / quarter | Unlimited | Unlimited |
| **Reprogram link anytime** | Email help | Free | Free | Free |
| **Priority support** | — | ✓ | ✓ | Dedicated manager |
| **Monthly bulk restock** | — | — | 5 cards/mo | 25 cards/mo |
| **Locations** | 1 | 1 | 3 | 10 |
| **Monthly review-count report** | — | — | ✓ | ✓ |
| **Label** | — | **Most Popular** | — | **Best for chains** |

**Annual option (recommended):** offer 2 months free if paid yearly — Pro $99/yr, Business $199/yr, Franchise $499/yr. Annual plans cut churn and get you cash up front.

## Which tier to push

- **Feature Optiq Pro ($9.99/mo)** — it's the easy yes. Ten bucks a month for "replace it if it breaks + reprogram anytime + priority support" is a low-risk add-on right after someone buys a card.
- **Business ($19.99/mo)** is the money tier for restaurants — the 5 cards/month restock alone is worth the price to a busy takeout spot, and the report keeps them subscribed.
- **Franchise ($49.99/mo)** is really a "talk to us" tier — route it to a conversation (the button links to your contact page) so you can tailor locations and restock volume.

## How it looks in the store

The theme now has a **Membership** section (matching black-and-white clickable boxes) on the homepage between pricing and the FAQ, plus a standalone `/pages/membership` page. Each plan is a box with its price, feature list, and a button. It's wired and editable in the theme editor — no code needed to change prices, names, or features.

## Making it actually bill monthly in Shopify

Shopify doesn't do recurring billing on its own — you need a **subscription app**. The plan boxes are ready; you just point their buttons at subscription products. Two easy options:

1. **Shopify Subscriptions app (free, by Shopify)** — good for simple monthly plans. Create three products:
   - `Optiq Pro Membership` → handle `optiq-pro-membership` → $9.99, add a monthly selling plan.
   - `Optiq Business Membership` → handle `optiq-business-membership` → $19.99/mo.
   - `Optiq Franchise Membership` → handle `optiq-franchise-membership` → route to contact, or $49.99/mo.
   The homepage/membership-page buttons already link to those exact handles, so once the products exist the buttons work.
2. **Recharge or Appstle** — more features (dunning, portals, "5 cards shipped monthly" fulfillment automation) if you outgrow the free app.

Set each membership product to **not require shipping** (except Business/Franchise, which ship restock cards — handle those as a recurring fulfillment or just mail them on your own schedule).

## Simple profit logic

Membership is almost pure margin because the cost is mostly your time plus a few cards.

| Plan | Price/mo | Est. monthly cost | Est. profit/mo | Notes |
|---|---|---|---|---|
| Optiq Pro | $9.99 | ~$0.50 | ~$9.49 | Replacements are rare; cost is amortized |
| Optiq Business | $19.99 | ~$4–6 | ~$14–16 | 5 restock cards (~$2.50) + shipping |
| Optiq Franchise | $49.99 | ~$12–16 | ~$34–38 | 25 restock cards + shipping + your time |

Even 20 Pro members = ~$190/mo recurring for almost no ongoing work. That's the real prize: predictable income stacked on top of one-time card sales.

## D2D / upsell pitch for membership

Pitch it **after** they've already agreed to a card — never lead with it.

> "One more thing — you can just take the card and that's it, no monthly anything, you own it. But a lot of shops add **Optiq Pro** for ten bucks a month. If the card ever gets damaged or walks off, we replace it free. If your Google link ever changes, we reprogram it, no charge. And you jump the line on support. Totally optional — want me to add it, or just the card for today?"

For restaurants, pitch **Business**:

> "Since you go through handout cards fast, most restaurants do the **Business** plan — twenty a month and we mail you fresh cards every month so you never run out, plus a quick report of how your review count's moving. Want me to set that up so the cards just show up?"

**Objection: "I don't want a subscription."**
> "Totally fair — the card's yours with zero monthly fee, that never changes. The plan's only there if you want the replacements and the monthly restock. You can start without it and add it anytime."

## Keep the messaging clean

- The word **"optional"** appears everywhere near membership. It protects your "no monthly fee" brand promise.
- Never imply the membership gets you reviews. It gets you **service**: replacements, restocks, support, reporting.
- Free tier stays visible so the paid tiers feel like a choice, not a trap.
- Reports describe your **own** review count over time — that's honest data, not a promise of growth.
