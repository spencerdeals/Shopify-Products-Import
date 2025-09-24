# Instant Import API

The Instant Import API provides automated product data extraction and shipping cost calculation for the Bermuda Import Calculator.

## Overview

This API accepts product URLs from major retailers and returns normalized product data including:
- Product name, price, and images
- Dimensions and weight (when available)
- Variant information (color, size, style)
- Shipping cost estimates for Bermuda import

## Endpoints

### POST /
### POST /instant-import

Extract product data from a URL and calculate shipping estimates.

**Request Body:**
```json
{
  "url": "https://www.wayfair.com/furniture/pdp/example-product"
}
```

**Response:**
```json
{
  "success": true,
  "engine": "zyte",
  "confidence": 0.95,
  "product": {
    "url": "https://www.wayfair.com/furniture/pdp/example-product",
    "name": "Modern 3-Seat Sofa",
    "price": 899.99,
    "currency": "USD",
    "image": "https://example.com/image.jpg",
    "brand": "Example Brand",
    "category": "Furniture > Sofas",
    "inStock": true,
    "dimensions": {
      "length": 84,
      "width": 36,
      "height": 32
    },
    "weight": 85.5,
    "variant": "Color: Navy Blue • Size: 3-Seat",
    "allVariants": ["Color: Navy Blue", "Size: 3-Seat"],
    "retailer": "Wayfair",
    "extractedAt": "2024-01-15T10:30:00.000Z",
    "shippingEstimate": {
      "cubicFeet": 4.375,
      "baseShipping": 35.00,
      "oversizeFee": 50.00,
      "highValueFee": 18.00,
      "handlingFee": 15.00,
      "totalShipping": 118.00,
      "dutyAmount": 238.50,
      "deliveryFee": 25.00,
      "totalImportCost": 1281.49,
      "currency": "USD"
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET /products

Legacy endpoint for backward compatibility. Accepts URL as query parameter.

**Request:**
```
GET /products?url=https://www.wayfair.com/furniture/pdp/example-product
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "scrapers": {
    "zyte": "enabled",
    "gpt": "enabled"
  }
}
```

## Supported Retailers

- Amazon
- Wayfair
- Target
- Walmart
- Best Buy
- Home Depot
- Lowes
- Costco
- Macy's
- IKEA
- Crate & Barrel
- CB2
- West Elm
- Pottery Barn

## Data Extraction Methods

The API uses multiple extraction methods in priority order:

1. **Zyte API** (Primary) - High-accuracy structured data extraction
2. **GPT Parser** (Fallback) - AI-powered HTML parsing when Zyte fails or has low confidence

## Shipping Cost Calculation

Shipping estimates are calculated based on:

- **Base Cost:** $8 per cubic foot (minimum $15)
- **Oversize Fee:** $50 for items over 48" in any dimension
- **High-Value Fee:** 2% of price for items over $500
- **Handling Fee:** $15 flat fee
- **Duty:** 26.5% of product price
- **Delivery Fee:** $25 per retailer

## Error Handling

### Error Codes

- `400 MISSING_URL` - URL not provided in request
- `502 SCRAPE_FAILED` - All extraction methods failed
- `500 INTERNAL_ERROR` - Unexpected server error

### Error Response Format

```json
{
  "error": "SCRAPE_FAILED",
  "message": "All scraping methods failed. Please check the URL and try again.",
  "url": "https://example.com/invalid-product"
}
```

## Configuration

### Environment Variables

- `ZYTE_API_KEY` - Zyte API key for primary extraction
- `OPENAI_API_KEY` - OpenAI API key for GPT fallback parsing
- `PORT` - Server port (default: 8080)

### Server Integration

To integrate with your Express server:

```javascript
const express = require('express');
const instantImport = require('./server/routes/instantImport');

const app = express();

// Required middleware
app.use(express.json({ limit: '5mb' }));

// Mount instant import routes
app.use('/', instantImport());

app.listen(8080, () => {
  console.log('Server running on port 8080');
});
```

## Data Normalization

The `importer/normalize.js` module handles conversion of raw Zyte data to standardized format:

- **Price Selection:** Prioritizes sale/current prices over regular/list prices
- **Dimension Parsing:** Supports multiple format patterns (H×W×D, etc.)
- **Variant Extraction:** Combines color, size, style, and material variants
- **Image Selection:** Chooses highest quality main product image
- **Weight Conversion:** Handles both lbs and kg units

## Development

### Testing

Test the API with curl:

```bash
# Test instant import
curl -X POST http://localhost:8080/instant-import \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.wayfair.com/furniture/pdp/example"}'

# Test health check
curl http://localhost:8080/health
```

### Debugging

Enable debug logging by setting environment variables:

```bash
DEBUG=instant-import:* npm start
```

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │───▶│  Instant Import  │───▶│  Zyte Scraper   │
│                 │    │      API         │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                │                        ▼
                                │               ┌─────────────────┐
                                │               │   Normalizer    │
                                │               │                 │
                                │               └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   GPT Parser    │    │  Shipping Calc  │
                       │   (Fallback)    │    │                 │
                       └─────────────────┘    └─────────────────┘
```

## License

This project is part of the Bermuda Import Calculator system.