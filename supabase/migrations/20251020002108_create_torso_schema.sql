/*
  # Torso Database Schema - Product Master Data System

  ## Overview
  Torso is the single source of truth for all product data, costing, pricing, and inventory.
  This schema supports the flow: Zyte → Torso → AdminCalc → Shopify CSV.

  ## Tables Created

  ### 1. products
  Master product records with enriched Zyte data
  - `handle` (text, primary key) - Unique product identifier (kebab-case)
  - `title` (text) - Product display name
  - `brand` (text) - Vendor/brand name
  - `canonical_url` (text) - Source product URL
  - `breadcrumbs` (jsonb) - Category breadcrumb trail
  - `rating` (numeric) - Product rating (e.g., 4.8)
  - `reviews` (integer) - Review count
  - `description_html` (text) - Rich HTML description
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. variants
  Product variants (color/size combinations)
  - `id` (uuid, primary key)
  - `handle` (text, foreign key) - References products.handle
  - `sku_base` (text) - Base SKU from Zyte
  - `variant_sku` (text, unique) - Full variant SKU with suffixes
  - `option1_name` (text) - First option axis (Color, Size, Title)
  - `option1_value` (text) - First option value
  - `option2_name` (text) - Second option axis (if applicable)
  - `option2_value` (text) - Second option value (if applicable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. packaging
  Shipping box dimensions and weight data
  - `id` (uuid, primary key)
  - `variant_id` (uuid, foreign key) - References variants.id
  - `box_length_in` (numeric) - Box length in inches
  - `box_width_in` (numeric) - Box width in inches
  - `box_height_in` (numeric) - Box height in inches
  - `box_weight_lb` (numeric) - Box weight in pounds
  - `boxes_per_unit` (integer) - Number of boxes per unit
  - `source` (text) - Data source (zyte, manual, etc.)
  - `conf_level` (numeric) - Confidence level (0-1)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. media
  Product images and media assets
  - `id` (uuid, primary key)
  - `variant_id` (uuid, foreign key) - References variants.id
  - `image_url` (text) - Full image URL
  - `position` (integer) - Display order
  - `color_key` (text) - Color variant association
  - `created_at` (timestamptz)

  ### 5. costing
  Landed cost calculations from AdminCalc
  - `id` (uuid, primary key)
  - `variant_id` (uuid, foreign key, unique) - References variants.id
  - `first_cost_usd` (numeric) - Base product cost
  - `duty_rate` (numeric) - Duty percentage (e.g., 0.25 for 25%)
  - `us_tax_rate` (numeric) - US tax percentage
  - `freight_rate_per_ft3` (numeric) - Freight cost per cubic foot
  - `fixed_fee_alloc` (numeric) - Fixed fee allocation
  - `landed_cost_usd` (numeric) - Total landed cost per unit
  - `calc_version` (text) - AdminCalc version used
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 6. pricing
  Retail pricing calculations from AdminCalc
  - `id` (uuid, primary key)
  - `variant_id` (uuid, foreign key, unique) - References variants.id
  - `retail_price_usd` (numeric) - Final customer price (rounded)
  - `compare_at_price_usd` (numeric) - Strike-through price (optional)
  - `card_fee_pct` (numeric) - Card processing fee percentage
  - `margin_applied_pct` (numeric) - Profit margin percentage
  - `rounding_rule` (text) - Rounding rule applied (NEAREST_5_UP)
  - `admincalc_version` (text) - AdminCalc version used
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 7. inventory
  Stock levels and barcode information
  - `id` (uuid, primary key)
  - `variant_id` (uuid, foreign key, unique) - References variants.id
  - `quantity` (integer) - Available quantity
  - `barcode` (text) - Product barcode
  - `grams` (integer) - Weight in grams (for Shopify)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Policies allow authenticated users full access
  - Service role has unrestricted access for backend operations

  ## Indexes
  - Primary keys and foreign keys auto-indexed
  - Additional indexes on frequently queried fields
*/

-- =============================================
-- 1. PRODUCTS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS products (
  handle text PRIMARY KEY,
  title text NOT NULL,
  brand text DEFAULT '',
  canonical_url text DEFAULT '',
  breadcrumbs jsonb DEFAULT '[]'::jsonb,
  rating numeric DEFAULT NULL,
  reviews integer DEFAULT NULL,
  description_html text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read products"
  ON products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update products"
  ON products FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 2. VARIANTS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL REFERENCES products(handle) ON DELETE CASCADE,
  sku_base text DEFAULT '',
  variant_sku text UNIQUE NOT NULL,
  option1_name text DEFAULT '',
  option1_value text DEFAULT '',
  option2_name text DEFAULT '',
  option2_value text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variants_handle ON variants(handle);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON variants(variant_sku);

ALTER TABLE variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read variants"
  ON variants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert variants"
  ON variants FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update variants"
  ON variants FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 3. PACKAGING TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  box_length_in numeric DEFAULT 0,
  box_width_in numeric DEFAULT 0,
  box_height_in numeric DEFAULT 0,
  box_weight_lb numeric DEFAULT 0,
  boxes_per_unit integer DEFAULT 1,
  source text DEFAULT 'manual',
  conf_level numeric DEFAULT 0.99,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packaging_variant ON packaging(variant_id);

ALTER TABLE packaging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read packaging"
  ON packaging FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert packaging"
  ON packaging FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update packaging"
  ON packaging FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 4. MEDIA TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  position integer DEFAULT 1,
  color_key text DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_variant ON media(variant_id);
CREATE INDEX IF NOT EXISTS idx_media_position ON media(variant_id, position);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read media"
  ON media FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert media"
  ON media FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update media"
  ON media FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 5. COSTING TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS costing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid UNIQUE NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  first_cost_usd numeric DEFAULT 0,
  duty_rate numeric DEFAULT 0.25,
  us_tax_rate numeric DEFAULT 0,
  freight_rate_per_ft3 numeric DEFAULT 0,
  fixed_fee_alloc numeric DEFAULT 0,
  landed_cost_usd numeric DEFAULT 0,
  calc_version text DEFAULT 'v1.0',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_costing_variant ON costing(variant_id);

ALTER TABLE costing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read costing"
  ON costing FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert costing"
  ON costing FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update costing"
  ON costing FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 6. PRICING TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid UNIQUE NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  retail_price_usd numeric DEFAULT 0,
  compare_at_price_usd numeric DEFAULT NULL,
  card_fee_pct numeric DEFAULT 0.03,
  margin_applied_pct numeric DEFAULT 0,
  rounding_rule text DEFAULT 'NEAREST_5_UP',
  admincalc_version text DEFAULT 'v1.0',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_variant ON pricing(variant_id);

ALTER TABLE pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pricing"
  ON pricing FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert pricing"
  ON pricing FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update pricing"
  ON pricing FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 7. INVENTORY TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid UNIQUE NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity integer DEFAULT 0,
  barcode text DEFAULT '',
  grams integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory(variant_id);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inventory"
  ON inventory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert inventory"
  ON inventory FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update inventory"
  ON inventory FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_variants_updated_at BEFORE UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_packaging_updated_at BEFORE UPDATE ON packaging
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_costing_updated_at BEFORE UPDATE ON costing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pricing_updated_at BEFORE UPDATE ON pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();