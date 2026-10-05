# Promotions behavior

The promotion schema is additive and all new order snapshot fields have defaults. Existing Product documents continue to use `stockBySize` (or aggregate `stock`), and existing orders without `appliedPromotions` are read as orders with no promotions. No data migration is required for the feature to remain off until an offer is created.

For each product in a cart, all eligible stackable offers apply. Of the eligible non-stackable offers, only the offer with the largest monetary benefit applies; priority and promotion ID break ties. Buy-X-get-Y tiers repeatedly use the qualifying tier with the greatest minimum quantity, then reevaluate the unconsumed purchased units. Example: tiers 3+1 and 6+4 produce 4 free units from 7 purchased units, and 5 free units from 9. Free quantities are added to the order at zero payable value and must pass variant stock checks.

Affiliate commission remains the configured per-piece amount, prorated by the paid product amount after percentage, bundle, and affiliate-code discounts. Complimentary units receive no commission. Orders save their promotion rules, free variant selections, discount, affiliate discount, and shipping charge so updates/deletion do not change the historical order. Paymob callbacks recompute against those snapshots and compare the signed amount with the saved final total; callbacks do not query current promotions.

The API and storefront retain the existing shipping policy: EGP 100 below EGP 6,000 of purchased-unit subtotal, otherwise free shipping. Complimentary units do not count toward the free-shipping threshold.
