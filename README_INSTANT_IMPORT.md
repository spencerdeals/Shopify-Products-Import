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

### GET /instant-import/health

Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "scrapers": {
    "zyte": "enabled",
    "gpt": "enabled",
    "normalizer": "enabled"
  }
}
```

### GET /products

Legacy endpoint for backward compatibility. Accepts URL as query parameter.

**Request:**
```
GET /products?url=https://www.wayfair.com/furniture/pdp/example-product
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
3. **Mock Data** (Final Fallback) - Returns sample data when scrapers are not configured

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
- `500 INTERNAL_ERROR` - Unexpected server error

### Error Response Format

```json
{
  "error": "MISSING_URL",
  "message": "URL is required in request body"
}
```

## Configuration

### Environment Variables

- `ZYTE_API_KEY` - Zyte API key for primary extraction
- `OPENAI_API_KEY` - OpenAI API key for GPT fallback parsing
- `PORT` - Server port (default: 8080)

### Server Integration

The instant import router is automatically mounted at the root level in `server.js`:

```javascript
const express = require('express');
const createInstantImportRouter = require('./server/routes/instantImport');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/', createInstantImportRouter());
```

## Development

### Testing

Test the API endpoints:

```bash
# Start the server
npm run dev

# Test health check
curl http://localhost:8080/instant-import/health

# Test instant import (requires valid product URL)
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.wayfair.com/furniture/pdp/example"}'
```

### Using Node.js for Testing (when curl is not available)

```javascript
// Test health check
node -e "require('http').get('http://localhost:8080/instant-import/health',r=>{let d='';r.on('data',c=>d+=c).on('end',()=>console.log(d))}).on('error',e=>console.error(e.message))"

// Test POST endpoint
node -e "const http=require('http');const data=JSON.stringify({url:'https://example.com/product'});const req=http.request({hostname:'localhost',port:8080,path:'/',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}},res=>{let d='';res.on('data',c=>d+=c).on('end',()=>console.log(d));});req.on('error',e=>console.error(e.message));req.write(data);req.end();"
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

## Operations Guide

### Quick Start
1. **Environment Setup**: Configure required API keys in Railway
2. **Health Check**: Verify `/instant-import/health` returns `{ ok: true }`
3. **Test Request**: Send POST to `/` with product URL
4. **Monitor Logs**: Watch for `[META]` lines showing successful processing

### Troubleshooting

#### Common Issues

**"Scrapers not configured" error**
- Missing `ZYTE_API_KEY` or `OPENAI_API_KEY`
- Check Railway environment variables
- Restart service after adding keys

**CORS blocked requests**
- Update `CORS_ALLOWLIST` environment variable
- Include your domain: `https://yourdomain.com`
- Restart service after CORS changes

**Low extraction confidence**
- Zyte confidence < 80% triggers GPT fallback
- Check OpenAI API quota and key validity
- Some retailers have lower success rates

**Empty product data**
- Verify product URL is accessible
- Check if retailer is supported
- Review extraction logs for specific errors

#### Log Analysis

**Successful extraction:**
```
[META] zyte | Wayfair | $899.99 | Modern 3-Seat Sofa...
```

**Fallback to GPT:**
```
[META] gpt-enhanced | Amazon | $129.99 | Coffee Table...
```

**Configuration issues:**
```
[instant-import] error: Zyte not configured - missing API key
```

### Performance Optimization

1. **Zyte First**: Primary scraper with highest accuracy
2. **GPT Fallback**: Activates when Zyte confidence < 80%
3. **Mock Data**: Final fallback when scrapers unavailable
4. **Caching**: Consider implementing for frequently requested products

### Scaling Considerations

- **Rate Limits**: Zyte and OpenAI have API quotas
- **Cost Management**: Monitor usage across both services
- **Error Handling**: Graceful degradation when services unavailable
- **Monitoring**: Track success rates and response times