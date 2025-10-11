# Pricing Calculation Fix

## Problem
Product totals displayed on Step 2 (product cards) did not match the totals shown on Step 3 (final summary), causing discrepancies of $5-$30 per item due to:
- Two different calculation functions with slightly different logic
- Double rounding (rounding each field separately then summing)
- Inconsistent handling of margins and delivery fees

## Solution
Created a single source of truth for all pricing calculations:

### New File: `/frontend/js/pricing-core.js`
- Single module that handles all pricing math
- Uses cent-based calculation (rounds once at the end, not multiple times)
- Provides both per-unit and line-total (quantity-applied) amounts
- Calculates: price, duty, freight, shipping & handling (with 20% margin), landed cost

### Updated Files:

1. **`/frontend/index.html`**
   - Loads `pricing-core.js` before other scripts
   - `confirmPrice()` function now uses `PricingCore.calcItemTotals()` for Step 2 product cards
   - `calculateTotals()` function now uses `PricingCore.calcOrderSummary()` for aggregation
   - `displayFinalBreakdown()` function now uses `PricingCore.calcItemTotals()` for Step 3 breakdown

2. **`/frontend/js/shopify-order.js`**
   - `calculateLandedPerUnit()` function now uses `PricingCore.calcItemTotals()` for Shopify orders
   - Ensures Shopify checkout prices match what users see in the calculator

## Result
- Step 2 product card totals now exactly match Step 3 summary totals
- All three views (Step 2 cards, Step 3 breakdown, Shopify checkout) use identical math
- Eliminated rounding discrepancies by calculating in cents and rounding once
- No UI changes, no route changes, only unified pricing logic
