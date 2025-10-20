function extractLeafCategory(breadcrumbs) {
  if (!breadcrumbs || breadcrumbs.length === 0) return 'Uncategorized';

  const crumbs = typeof breadcrumbs === 'string'
    ? JSON.parse(breadcrumbs)
    : breadcrumbs;

  for (let i = crumbs.length - 1; i >= 0; i--) {
    const crumb = crumbs[i];
    const text = typeof crumb === 'object' ? crumb.name : crumb;
    if (text && !text.match(/^SKU:/i)) {
      return text;
    }
  }

  return crumbs[crumbs.length - 1] || 'Uncategorized';
}

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
  return createClient(supabaseUrl, supabaseKey);
}

async function refreshCategoryPatterns() {
  console.log('\n========================================');
  console.log('CATEGORY PATTERN LEARNING JOB');
  console.log('========================================\n');

  const startTime = Date.now();

  try {
    const { data: products, error: productsError } = await getSupabase()
      .from('products')
      .select(`
        id,
        breadcrumbs,
        variants (
          id,
          packaging (
            box_length_in,
            box_width_in,
            box_height_in,
            box_weight_lb
          )
        )
      `);

    if (productsError) {
      throw productsError;
    }

    console.log(`[PatternLearning] Found ${products.length} products`);

    const categoryData = {};

    products.forEach(product => {
      const category = extractLeafCategory(product.breadcrumbs);

      if (!product.variants || product.variants.length === 0) return;

      product.variants.forEach(variant => {
        if (!variant.packaging || variant.packaging.length === 0) return;

        const pkg = variant.packaging[0];

        if (!pkg.box_length_in || !pkg.box_width_in || !pkg.box_height_in) return;

        if (!categoryData[category]) {
          categoryData[category] = {
            lengths: [],
            widths: [],
            heights: [],
            weights: []
          };
        }

        categoryData[category].lengths.push(pkg.box_length_in);
        categoryData[category].widths.push(pkg.box_width_in);
        categoryData[category].heights.push(pkg.box_height_in);
        if (pkg.box_weight_lb) {
          categoryData[category].weights.push(pkg.box_weight_lb);
        }
      });
    });

    console.log(`[PatternLearning] Found ${Object.keys(categoryData).length} categories`);

    const patterns = [];

    for (const [category, data] of Object.entries(categoryData)) {
      if (data.lengths.length === 0) continue;

      const pattern = {
        category,
        avg_length: average(data.lengths),
        avg_width: average(data.widths),
        avg_height: average(data.heights),
        avg_weight: average(data.weights),
        min_length: Math.min(...data.lengths),
        min_width: Math.min(...data.widths),
        min_height: Math.min(...data.heights),
        min_weight: data.weights.length > 0 ? Math.min(...data.weights) : 10,
        max_length: Math.max(...data.lengths),
        max_width: Math.max(...data.widths),
        max_height: Math.max(...data.heights),
        max_weight: data.weights.length > 0 ? Math.max(...data.weights) : 50,
        sample_count: data.lengths.length
      };

      patterns.push(pattern);

      console.log(`[PatternLearning] ${category}: ${pattern.sample_count} samples, avg ${pattern.avg_length.toFixed(1)}x${pattern.avg_width.toFixed(1)}x${pattern.avg_height.toFixed(1)}`);
    }

    if (patterns.length > 0) {
      const { error: upsertError } = await getSupabase()
        .from('category_patterns')
        .upsert(patterns, { onConflict: 'category' });

      if (upsertError) {
        throw upsertError;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n[PatternLearning] PATTERN_REFRESH: ${patterns.length} categories updated in ${duration}s`);
    console.log('========================================\n');

    return {
      success: true,
      categoriesUpdated: patterns.length,
      duration
    };

  } catch (error) {
    console.error('[PatternLearning] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

async function getCategoryPattern(category) {
  const { data, error } = await getSupabase()
    .from('category_patterns')
    .select('*')
    .eq('category', category)
    .maybeSingle();

  if (error) {
    console.error('[PatternLearning] Error fetching pattern:', error);
    return null;
  }

  return data;
}

module.exports = {
  refreshCategoryPatterns,
  getCategoryPattern,
  extractLeafCategory
};
