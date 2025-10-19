# Admin Calculator Implementation Summary

## Overview
Implemented a complete rebuild of the Admin Calculator according to specifications. The new calculator follows a 3-screen flow with dynamic margin pricing and Shopify CSV export.

## Features Implemented

### 1. Screen 1: Product Link Input
- Single screen with multiline textarea for pasting product URLs
- "Fetch Products" button scrapes all URLs via existing `/api/scrape` endpoint
- Clean, modern UI with no intro page

### 2. Screen 2: Dimensions & Costs
- **Product Display**: Each scraped product shows:
  - Thumbnail image
  - Title (from scraped data)
  - Editable vendor field
  - Source URL (readonly)
  - Editable base price

- **Multi-Box Dimension Editor**:
  - Each product supports multiple shipping boxes
  - Each box has: Length, Width, Height, Weight (all in inches/lbs)
  - "+ Add Box" button to add additional boxes
  - "Remove" button on each box (when multiple boxes exist)
  - Cubic feet calculated from sum of all boxes

- **Dynamic Margin System**:
  - Margin automatically determined by total landed cost:
    - Under $200: **60%** margin
    - $200-$499: **50%** margin
    - $500-$999: **45%** margin
    - $1,000-$2,499: **40%** margin
    - Over $2,500: **38%** margin
  - Editable margin input box per product
  - Shows suggested margin tier in small text
  - Custom margin overrides automatic tier

- **Pricing Calculation**:
  - Product Price (editable)
  - Freight Cost: $8.50 per cubic foot, $30 minimum
  - Duty: 25% of item price
  - Wharfage: 1.5% of item price
  - **Total Landed Cost** (highlighted)
  - Profit Margin (% and $)
  - MSRP before rounding
  - **FINAL MSRP** (rounded UP to next $5)

### 3. Screen 3: Review & Export
- Table view of all products showing:
  - Title
  - Vendor (editable)
  - Type (editable, defaults to "Furniture")
  - Tags (editable)
  - Landed Cost (readonly)
  - Margin % (readonly)
  - Price (editable, in $5 increments)
  - SKU (editable)
  - Collection (auto-assigned with badge)

- **Auto-Collection Assignment**:
  - Analyzes product name, category, and retailer
  - Assigns to collections:
    - Sofas & Sectionals
    - Chairs & Seating
    - Tables
    - Bedroom
    - Lighting
    - Rugs
    - Home Decor
    - Outdoor
    - Uncategorized (uncertain badge)
  - Uncertain collections show warning badge

- **Shopify CSV Export**:
  - Generates complete Shopify Products CSV
  - Includes all required columns:
    - Handle (kebab-case from title)
    - Title, Vendor, Type, Tags
    - Variant Price (rounded)
    - Cost per item (landed cost)
    - Image URL
    - Collection
    - Status (active)
  - Uncertain collections prefixed with `REVIEW_COLLECTION:`

## Rounding Rule
All prices are rounded **UP** to the next multiple of $5:
- $199 → $200
- $200 → $200
- $201 → $205
- $444 → $445
- $446 → $450

## Pricing Formula
```
Total Landed Cost = Base Price + Freight + Duty + Wharfage

Where:
- Freight = max($30, Total Cubic Feet × $8.50)
- Duty = Base Price × 0.25
- Wharfage = Base Price × 0.015

MSRP Before Rounding = Landed Cost × (1 + Margin%)
FINAL MSRP = ceil(MSRP Before Rounding / 5) × 5
```

## Design
- Modern gradient header (blue/red/gold)
- Clean card-based layout for products
- Color-coded sections:
  - Boxes: Orange theme
  - Pricing: Green theme
  - Margin: Yellow theme
- Responsive design for mobile/tablet
- Smooth animations and hover effects

## Technical Implementation
- Single HTML file: `/frontend/admin-calculator.html`
- Pure JavaScript (no frameworks)
- Uses existing `/api/scrape` backend endpoint
- Client-side CSV generation
- No dependencies on other files

## Usage
1. Access at: `http://localhost:3000/admin-calculator` (requires admin:1064 auth)
2. Paste product URLs (one per line)
3. Click "Fetch Products"
4. Review and edit dimensions/margins
5. Click "Review & Export"
6. Download Shopify CSV

## File Modified
- `/frontend/admin-calculator.html` - Complete rewrite implementing all specifications
