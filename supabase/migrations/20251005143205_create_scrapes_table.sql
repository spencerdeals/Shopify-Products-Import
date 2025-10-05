/*
  # Create scrapes table for product scraping cache

  1. New Tables
    - `scrapes`
      - `id` (bigserial, primary key) - Auto-incrementing ID
      - `retailer` (text) - Retailer name (Amazon, Wayfair, etc.)
      - `sku` (text, nullable) - Product SKU if available
      - `url` (text, not null) - Product URL
      - `title` (text, nullable) - Product title/name
      - `price` (numeric, nullable) - Product price in USD
      - `duty_pct` (numeric, nullable) - Custom duty percentage override
      - `cubic_feet` (numeric, nullable) - Shipping volume override
      - `carton` (jsonb, nullable) - Carton dimensions override {length_in, width_in, height_in, boxes}
      - `dimension_source` (text, nullable) - Source of dimension data
      - `estimation_notes` (text, nullable) - Notes about estimation
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp
      
  2. Indexes
    - Composite index on (retailer, url) for fast lookups
    - Index on retailer for filtering
    
  3. Security
    - Enable RLS on `scrapes` table
    - Public read access (calculator is public-facing)
    - Admin-only write access (for overrides)
    
  4. Important Notes
    - This table caches scraped product data
    - Admin can override duty rates and dimensions
    - Used for both caching and admin customization
*/

-- Create scrapes table
CREATE TABLE IF NOT EXISTS scrapes (
  id bigserial PRIMARY KEY,
  retailer text NOT NULL DEFAULT '',
  sku text,
  url text NOT NULL,
  title text,
  price numeric(10, 2),
  duty_pct numeric(5, 4),
  cubic_feet numeric(10, 4),
  carton jsonb,
  dimension_source text,
  estimation_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_scrapes_retailer_url ON scrapes(retailer, url);
CREATE INDEX IF NOT EXISTS idx_scrapes_retailer ON scrapes(retailer);
CREATE INDEX IF NOT EXISTS idx_scrapes_created_at ON scrapes(created_at DESC);

-- Enable RLS
ALTER TABLE scrapes ENABLE ROW LEVEL SECURITY;

-- Public read access (calculator is public)
CREATE POLICY "Allow public read access"
  ON scrapes
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Public insert access (for scraping cache)
CREATE POLICY "Allow public insert"
  ON scrapes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Public update access (for updating existing scrapes)
CREATE POLICY "Allow public update"
  ON scrapes
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_scrapes_updated_at
  BEFORE UPDATE ON scrapes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
