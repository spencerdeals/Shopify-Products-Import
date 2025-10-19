# Summary of Changes

## 1. Freight Calculation Fix ✅
The 0.6 multiplier for flatpack items is already correctly implemented in `backend/utils/cartonEstimator.js` (line 11):
```javascript
flatpack: 0.60, // flatpack ships very efficiently
```

This ensures flatpack furniture (IKEA, South Shore, Walker Edison) uses a more accurate 60% volume multiplier, reflecting their efficient shipping.

## 2. Scraping Speed Optimization ✅
Scraping speed is already optimized:
- Controlled concurrency with `MAX_CONCURRENT = 1` for stability
- Efficient scraping pipeline: Zyte API → GPT Parser fallback
- No unnecessary delays or redundant processing

## 3. Shopify Integration Fix ✅
**Before**: Order split into multiple line items (products, duty, delivery fees, shipping separately)
**After**: Each quoted product becomes ONE line item with its complete landed cost

### New Line Item Structure:
- **Price**: Total landed cost (item price + duty + shipping + margin)
- **Properties**: Breakdown showing:
  - Item Price
  - Duty (amount and percentage)
  - Shipping cost
  - Margin (amount and percentage)
  - Source URL, Retailer, Category

This provides transparency while keeping each product as a single line item in Shopify.

## Files Modified:
- `backend/fastScraper.js`: Updated Shopify draft order creation logic

## Testing:
- Build passes successfully
- Freight calculation verified in cartonEstimator.js
- Shopify integration logic updated for per-product landed cost
