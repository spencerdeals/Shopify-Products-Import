# Quick Reference - Freight API

## Endpoints

### 1. `/api/scrape` - Calculate Freight
**Method:** POST

**Request:**
```json
{
  "retailer": "Wayfair",
  "sku": "W100063422",
  "price": 939.99,
  "profile": "sofa",
  "vendorTier": "neutral",
  "assembled": {
    "L": 89.5,
    "W": 65,
    "H": 33
  }
}
```

**Response:**
```json
{
  "product": { "sku": "W100063422", "price": 939.99 },
  "carton_estimate": {
    "cubic_feet": 56.5,
    "source": "admin_override",
    "boxes": 2,
    "confidence": 1.0
  },
  "freight": { "amount": 480.25 }
}
```

### 2. `/api/admin/ping` - Check Environment
**Method:** GET

**Response:**
```json
{
  "ok": true,
  "env": {
    "rate": 8.5,
    "min": 30,
    "njTaxRate": 6.625
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| OCEAN_RATE_PER_FT3 | 8.5 | Ocean freight rate per cubic foot |
| MIN_FREIGHT_USD | 30 | Minimum freight charge in USD |
| NJ_TAX_RATE_PCT | 6.625 | NJ sales tax rate percentage |

## Profiles

- `sofa` - Sofas, sectionals, loveseats
- `chair` - Chairs, armchairs, recliners
- `table` - Tables, desks
- `bed` - Beds, mattresses
- `default` - All other items

## Vendor Tiers

- `flatpack` - IKEA, South Shore (0.60x multiplier)
- `premium` - High-end brands (1.00x multiplier)
- `neutral` - Standard brands (1.00x multiplier)

## Console Logs

```
🧮 Freight: 480.25 ft³: 56.5 from admin_override
```

Format: `🧮 Freight: {amount} ft³: {cubic_feet} from {source}`

## cURL Examples

```bash
# Check environment config
curl -s http://localhost:3000/api/admin/ping | jq '.'

# Calculate freight
curl -s -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "retailer": "Wayfair",
    "sku": "W100063422",
    "price": 939.99,
    "profile": "sofa",
    "vendorTier": "neutral",
    "assembled": {"L": 89.5, "W": 65, "H": 33}
  }' | jq '.'
```

## Production Testing (After Deploy)

```bash
# Test on Railway
curl -s -X POST https://bermuda-import-calculator-production.up.railway.app/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "retailer": "Wayfair",
    "sku": "W100063422",
    "price": 939.99,
    "profile": "sofa",
    "vendorTier": "neutral",
    "assembled": {"L": 89.5, "W": 65, "H": 33}
  }' | jq '{cf:.carton_estimate.cubic_feet, freight:.freight.amount}'
```

Expected: `{ "cf": 56.5, "freight": 480.25 }`
