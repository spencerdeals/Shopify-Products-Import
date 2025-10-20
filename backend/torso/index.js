/**
 * Torso Data Access Layer
 *
 * Single source of truth for all product data, costing, pricing, and inventory.
 * Provides idempotent upsert operations for all Torso tables.
 * Uses Supabase PostgreSQL for data persistence.
 */

const { createClient } = require('@supabase/supabase-js');

// Lazy-initialize Supabase client
let supabase = null;

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Torso: Missing VITE_SUPABASE_URL or SUPABASE key in environment variables');
    }

    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Torso] Supabase client initialized');
  }
  return supabase;
}

// =============================================
// PRODUCTS
// =============================================

async function upsertProduct(data) {
  const {
    handle,
    title,
    brand = '',
    canonical_url = '',
    breadcrumbs = [],
    rating = null,
    reviews = null,
    description_html = ''
  } = data;

  const { data: result, error } = await getSupabase()
    .from('products')
    .upsert({
      handle,
      title,
      brand,
      canonical_url,
      breadcrumbs,
      rating,
      reviews,
      description_html
    }, { onConflict: 'handle' })
    .select()
    .single();

  if (error) {
    console.error('[Torso] Error upserting product:', error);
    throw error;
  }

  console.log(`[Torso] Product upserted: ${handle}`);
  return handle;
}

async function getProduct(handle) {
  const { data, error } = await getSupabase()
    .from('products')
    .select('*')
    .eq('handle', handle)
    .maybeSingle();

  if (error) {
    console.error('[Torso] Error getting product:', error);
    throw error;
  }

  return data;
}

// =============================================
// VARIANTS
// =============================================

async function upsertVariant(data) {
  const {
    handle,
    sku_base = '',
    variant_sku,
    option1_name = '',
    option1_value = '',
    option2_name = '',
    option2_value = ''
  } = data;

  const { data: result, error } = await getSupabase()
    .from('variants')
    .upsert({
      handle,
      sku_base,
      variant_sku,
      option1_name,
      option1_value,
      option2_name,
      option2_value
    }, { onConflict: 'variant_sku' })
    .select()
    .single();

  if (error) {
    console.error('[Torso] Error upserting variant:', error);
    throw error;
  }

  console.log(`[Torso] Variant upserted: ${variant_sku} (${result.id})`);
  return result.id;
}

async function listVariants(handle) {
  const { data, error } = await getSupabase()
    .from('variants')
    .select('*')
    .eq('handle', handle)
    .order('created_at');

  if (error) {
    console.error('[Torso] Error listing variants:', error);
    throw error;
  }

  return data || [];
}

// =============================================
// PACKAGING
// =============================================

async function upsertPackaging(data) {
  const {
    variant_id,
    box_length_in = 0,
    box_width_in = 0,
    box_height_in = 0,
    box_weight_lb = 0,
    boxes_per_unit = 1,
    source = 'zyte',
    conf_level = 0.99
  } = data;

  // Check if exists
  const { data: existing } = await getSupabase()
    .from('packaging')
    .select('id')
    .eq('variant_id', variant_id)
    .maybeSingle();

  if (existing) {
    // Update
    const { error } = await getSupabase()
      .from('packaging')
      .update({
        box_length_in,
        box_width_in,
        box_height_in,
        box_weight_lb,
        boxes_per_unit,
        source,
        conf_level
      })
      .eq('variant_id', variant_id);

    if (error) throw error;
  } else {
    // Insert
    const { error } = await getSupabase()
      .from('packaging')
      .insert({
        variant_id,
        box_length_in,
        box_width_in,
        box_height_in,
        box_weight_lb,
        boxes_per_unit,
        source,
        conf_level
      });

    if (error) throw error;
  }

  console.log(`[Torso] Packaging upserted for variant: ${variant_id}`);
  return variant_id;
}

async function getPackaging(variantId) {
  const { data, error } = await getSupabase()
    .from('packaging')
    .select('*')
    .eq('variant_id', variantId)
    .maybeSingle();

  if (error) {
    console.error('[Torso] Error getting packaging:', error);
    throw error;
  }

  return data;
}

// =============================================
// MEDIA
// =============================================

async function upsertMedia(data) {
  const {
    variant_id,
    image_url,
    position = 1,
    color_key = null
  } = data;

  // Check if exists
  const { data: existing } = await getSupabase()
    .from('media')
    .select('id')
    .eq('variant_id', variant_id)
    .eq('position', position)
    .maybeSingle();

  if (existing) {
    // Update
    const { error } = await getSupabase()
      .from('media')
      .update({ image_url, color_key })
      .eq('variant_id', variant_id)
      .eq('position', position);

    if (error) throw error;
  } else {
    // Insert
    const { error } = await getSupabase()
      .from('media')
      .insert({ variant_id, image_url, position, color_key });

    if (error) throw error;
  }

  console.log(`[Torso] Media upserted for variant: ${variant_id} (position ${position})`);
  return variant_id;
}

async function listMedia(variantId) {
  const { data, error } = await getSupabase()
    .from('media')
    .select('*')
    .eq('variant_id', variantId)
    .order('position');

  if (error) {
    console.error('[Torso] Error listing media:', error);
    throw error;
  }

  return data || [];
}

// =============================================
// COSTING
// =============================================

async function upsertCosting(data) {
  const {
    variant_id,
    first_cost_usd = 0,
    duty_rate = 0.25,
    us_tax_rate = 0,
    freight_rate_per_ft3 = 0,
    fixed_fee_alloc = 0,
    landed_cost_usd = 0,
    calc_version = 'v1.0'
  } = data;

  const { data: result, error } = await getSupabase()
    .from('costing')
    .upsert({
      variant_id,
      first_cost_usd,
      duty_rate,
      us_tax_rate,
      freight_rate_per_ft3,
      fixed_fee_alloc,
      landed_cost_usd,
      calc_version
    }, { onConflict: 'variant_id' })
    .select()
    .single();

  if (error) {
    console.error('[Torso] Error upserting costing:', error);
    throw error;
  }

  console.log(`[Torso] Costing upserted for variant: ${variant_id}`);
  return variant_id;
}

async function getCosting(variantId) {
  const { data, error } = await getSupabase()
    .from('costing')
    .select('*')
    .eq('variant_id', variantId)
    .maybeSingle();

  if (error) {
    console.error('[Torso] Error getting costing:', error);
    throw error;
  }

  return data;
}

// =============================================
// PRICING
// =============================================

async function upsertPricing(data) {
  const {
    variant_id,
    retail_price_usd = 0,
    compare_at_price_usd = null,
    card_fee_pct = 0.03,
    margin_applied_pct = 0,
    rounding_rule = 'NEAREST_5_UP',
    admincalc_version = 'v1.0'
  } = data;

  const { data: result, error } = await getSupabase()
    .from('pricing')
    .upsert({
      variant_id,
      retail_price_usd,
      compare_at_price_usd,
      card_fee_pct,
      margin_applied_pct,
      rounding_rule,
      admincalc_version
    }, { onConflict: 'variant_id' })
    .select()
    .single();

  if (error) {
    console.error('[Torso] Error upserting pricing:', error);
    throw error;
  }

  console.log(`[Torso] Pricing upserted for variant: ${variant_id}`);
  return variant_id;
}

async function getPricing(variantId) {
  const { data, error } = await getSupabase()
    .from('pricing')
    .select('*')
    .eq('variant_id', variantId)
    .maybeSingle();

  if (error) {
    console.error('[Torso] Error getting pricing:', error);
    throw error;
  }

  return data;
}

// =============================================
// INVENTORY
// =============================================

async function upsertInventory(data) {
  const {
    variant_id,
    quantity = 0,
    barcode = '',
    grams = 0
  } = data;

  const { data: result, error } = await getSupabase()
    .from('inventory')
    .upsert({
      variant_id,
      quantity,
      barcode,
      grams
    }, { onConflict: 'variant_id' })
    .select()
    .single();

  if (error) {
    console.error('[Torso] Error upserting inventory:', error);
    throw error;
  }

  console.log(`[Torso] Inventory upserted for variant: ${variant_id}`);
  return variant_id;
}

async function getInventory(variantId) {
  const { data, error} = await getSupabase()
    .from('inventory')
    .select('*')
    .eq('variant_id', variantId)
    .maybeSingle();

  if (error) {
    console.error('[Torso] Error getting inventory:', error);
    throw error;
  }

  return data;
}

// =============================================
// COMPREHENSIVE QUERIES
// =============================================

/**
 * Get complete product data with all variants and related data
 */
async function getProductComplete(handle) {
  const product = await getProduct(handle);
  if (!product) return null;

  const variants = await listVariants(handle);

  // Enrich each variant with packaging, media, costing, pricing, inventory
  const enrichedVariants = await Promise.all(
    variants.map(async (variant) => {
      const [packaging, media, costing, pricing, inventory] = await Promise.all([
        getPackaging(variant.id),
        listMedia(variant.id),
        getCosting(variant.id),
        getPricing(variant.id),
        getInventory(variant.id)
      ]);

      return {
        ...variant,
        packaging,
        media,
        costing,
        pricing,
        inventory
      };
    })
  );

  return {
    ...product,
    variants: enrichedVariants
  };
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
  // Products
  upsertProduct,
  getProduct,

  // Variants
  upsertVariant,
  listVariants,

  // Packaging
  upsertPackaging,
  getPackaging,

  // Media
  upsertMedia,
  listMedia,

  // Costing
  upsertCosting,
  getCosting,

  // Pricing
  upsertPricing,
  getPricing,

  // Inventory
  upsertInventory,
  getInventory,

  // Comprehensive
  getProductComplete
};
