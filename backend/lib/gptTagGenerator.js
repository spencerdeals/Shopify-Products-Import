/**
 * GPT Tag Generator
 *
 * Uses OpenAI GPT to generate high-quality product tags based on title, vendor, type,
 * description, and features. Ensures tags cover functionality, room/usage, and style/material.
 */

const OpenAI = require('openai');

let openaiClient = null;

/**
 * Get or create OpenAI client
 */
function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Build GPT prompt for tag generation
 */
function buildTagPrompt(productData) {
  const {
    title = '',
    vendor = '',
    type = '',
    description = '',
    features = [],
    category = '',
    breadcrumbs = []
  } = productData;

  const featureText = Array.isArray(features) && features.length > 0
    ? features.slice(0, 5).join('; ')
    : '';

  const categoryText = breadcrumbs && breadcrumbs.length > 0
    ? breadcrumbs.join(' > ')
    : category;

  return `Generate 5-10 product tags for this furniture item. Tags should be short, lowercase, and comma-separated with no special characters.

REQUIRED: Include at least one tag from each category:
1. Functionality (e.g., adjustable, sectional, storage, outdoor, convertible)
2. Room/Usage (e.g., living room, bedroom, home office, patio, dining room)
3. Style/Material (e.g., modern, rustic, wood, metal, fabric, leather)

Product Details:
Title: ${title}
Vendor: ${vendor || 'N/A'}
Type: ${type || 'N/A'}
Category: ${categoryText || 'N/A'}
${featureText ? `Key Features: ${featureText}` : ''}
${description ? `Description: ${description.substring(0, 300)}...` : ''}

Output ONLY the comma-separated tags with no other text. Example format:
standing desk, adjustable desk, home office, modern office, ergonomic furniture, height adjustable, workspace solution`;
}

/**
 * Parse GPT response into clean tag array
 */
function parseTagResponse(gptResponse) {
  if (!gptResponse || typeof gptResponse !== 'string') {
    return [];
  }

  // Remove any markdown, quotes, or extra formatting
  let cleaned = gptResponse
    .replace(/```/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  // Split by comma, newline, or semicolon
  const tags = cleaned
    .split(/[,;\n]/)
    .map(tag => tag.trim().toLowerCase())
    .filter(tag => {
      // Remove empty tags and tags with special characters
      if (!tag || tag.length < 3) return false;
      // Allow only letters, numbers, spaces, and hyphens
      return /^[a-z0-9\s-]+$/.test(tag);
    })
    .slice(0, 10); // Max 10 tags

  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Validate that tags cover required categories
 */
function validateTagCoverage(tags) {
  const tagString = tags.join(' ').toLowerCase();

  const coverage = {
    functionality: false,
    room: false,
    style: false
  };

  // Functionality keywords
  const functionalityKeywords = [
    'adjustable', 'sectional', 'storage', 'outdoor', 'convertible',
    'reclining', 'swivel', 'extendable', 'folding', 'stackable',
    'modular', 'height adjustable', 'sit stand', 'standing'
  ];

  // Room/Usage keywords
  const roomKeywords = [
    'living room', 'bedroom', 'office', 'home office', 'dining',
    'patio', 'outdoor', 'kitchen', 'bathroom', 'entryway',
    'workspace', 'commercial', 'residential'
  ];

  // Style/Material keywords
  const styleKeywords = [
    'modern', 'rustic', 'wood', 'metal', 'fabric', 'leather',
    'contemporary', 'traditional', 'industrial', 'farmhouse',
    'minimalist', 'vintage', 'upholstered', 'glass', 'steel'
  ];

  // Check coverage
  coverage.functionality = functionalityKeywords.some(kw => tagString.includes(kw));
  coverage.room = roomKeywords.some(kw => tagString.includes(kw));
  coverage.style = styleKeywords.some(kw => tagString.includes(kw));

  return coverage;
}

/**
 * Add fallback tags if coverage is missing
 */
function ensureTagCoverage(tags, productData) {
  const coverage = validateTagCoverage(tags);
  const fallbackTags = [];

  const { title = '', type = '', breadcrumbs = [] } = productData;
  const titleLower = title.toLowerCase();

  // Add functionality tag if missing
  if (!coverage.functionality) {
    if (titleLower.includes('adjustable')) fallbackTags.push('adjustable');
    else if (titleLower.includes('storage')) fallbackTags.push('storage');
    else if (type.toLowerCase().includes('sectional')) fallbackTags.push('sectional');
  }

  // Add room tag if missing
  if (!coverage.room) {
    const breadcrumbString = breadcrumbs.join(' ').toLowerCase();
    if (breadcrumbString.includes('living')) fallbackTags.push('living room');
    else if (breadcrumbString.includes('bedroom')) fallbackTags.push('bedroom');
    else if (breadcrumbString.includes('office')) fallbackTags.push('home office');
    else if (breadcrumbString.includes('dining')) fallbackTags.push('dining room');
    else if (breadcrumbString.includes('outdoor') || breadcrumbString.includes('patio')) {
      fallbackTags.push('outdoor');
    }
  }

  // Add style tag if missing
  if (!coverage.style) {
    if (titleLower.includes('modern')) fallbackTags.push('modern');
    else if (titleLower.includes('wood')) fallbackTags.push('wood');
    else fallbackTags.push('contemporary'); // Default fallback
  }

  // Merge and deduplicate
  const allTags = [...tags, ...fallbackTags];
  return [...new Set(allTags)].slice(0, 10);
}

/**
 * Generate tags using GPT
 */
async function generateTags(productData) {
  const startTime = Date.now();

  console.log(`[GPT Tags] Generating tags for: ${productData.title?.substring(0, 50)}...`);

  try {
    const openai = getOpenAIClient();
    const prompt = buildTagPrompt(productData);

    console.log('[GPT Tags] Calling OpenAI API...');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a furniture e-commerce tag generator. Generate concise, SEO-friendly product tags that cover functionality, room usage, and style/material. Output only comma-separated tags.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    const gptOutput = response.choices[0]?.message?.content;

    if (!gptOutput) {
      throw new Error('Empty response from GPT');
    }

    console.log(`[GPT Tags] Raw GPT output: ${gptOutput}`);

    // Parse and validate tags
    let tags = parseTagResponse(gptOutput);

    // Ensure coverage of all required categories
    tags = ensureTagCoverage(tags, productData);

    const duration = Date.now() - startTime;
    console.log(`[GPT Tags] Generated ${tags.length} tags in ${duration}ms: ${tags.join(', ')}`);

    // Validate coverage
    const coverage = validateTagCoverage(tags);
    console.log(`[GPT Tags] Coverage: functionality=${coverage.functionality}, room=${coverage.room}, style=${coverage.style}`);

    return {
      tags,
      coverage,
      gptModel: 'gpt-4o-mini',
      duration
    };

  } catch (error) {
    console.error(`[GPT Tags] Error generating tags:`, error.message);

    // Fallback: generate basic tags from product data
    return generateFallbackTags(productData);
  }
}

/**
 * Generate fallback tags without GPT
 */
function generateFallbackTags(productData) {
  console.log('[GPT Tags] Using fallback tag generation');

  const {
    title = '',
    type = '',
    vendor = '',
    breadcrumbs = []
  } = productData;

  const tags = new Set();
  const titleLower = title.toLowerCase();
  const typeLower = type.toLowerCase();
  const breadcrumbString = breadcrumbs.join(' ').toLowerCase();

  // Extract functionality tags
  if (titleLower.includes('adjustable')) tags.add('adjustable');
  if (titleLower.includes('sectional')) tags.add('sectional');
  if (titleLower.includes('storage')) tags.add('storage');
  if (titleLower.includes('outdoor')) tags.add('outdoor');
  if (titleLower.includes('reclining') || titleLower.includes('recliner')) tags.add('reclining');

  // Extract room tags
  if (breadcrumbString.includes('living')) tags.add('living room');
  if (breadcrumbString.includes('bedroom')) tags.add('bedroom');
  if (breadcrumbString.includes('office')) tags.add('home office');
  if (breadcrumbString.includes('dining')) tags.add('dining room');
  if (breadcrumbString.includes('outdoor') || breadcrumbString.includes('patio')) tags.add('outdoor');

  // Extract style/material tags
  if (titleLower.includes('modern')) tags.add('modern');
  if (titleLower.includes('rustic')) tags.add('rustic');
  if (titleLower.includes('wood')) tags.add('wood');
  if (titleLower.includes('metal')) tags.add('metal');
  if (titleLower.includes('fabric')) tags.add('fabric');
  if (titleLower.includes('leather')) tags.add('leather');

  // Add type as tag
  if (typeLower && typeLower !== 'furniture') {
    tags.add(typeLower);
  }

  // Add vendor if meaningful
  if (vendor && vendor.length > 2 && vendor.toLowerCase() !== 'sdl') {
    tags.add(vendor.toLowerCase());
  }

  const tagArray = Array.from(tags).slice(0, 10);

  console.log(`[GPT Tags] Fallback tags: ${tagArray.join(', ')}`);

  return {
    tags: tagArray,
    coverage: validateTagCoverage(tagArray),
    gptModel: 'fallback',
    duration: 0
  };
}

/**
 * Batch generate tags for multiple products
 */
async function batchGenerateTags(products) {
  console.log(`\n[GPT Tags] Batch generating tags for ${products.length} products`);

  const results = [];

  for (const product of products) {
    try {
      const result = await generateTags(product);
      results.push({
        handle: product.handle,
        title: product.title,
        ...result
      });

      // Rate limiting: wait 500ms between API calls
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`[GPT Tags] Error for ${product.title}:`, error.message);
      results.push({
        handle: product.handle,
        title: product.title,
        tags: [],
        error: error.message
      });
    }
  }

  console.log(`[GPT Tags] Batch complete: ${results.length} products processed`);

  return results;
}

module.exports = {
  generateTags,
  generateFallbackTags,
  batchGenerateTags,
  parseTagResponse,
  validateTagCoverage,
  ensureTagCoverage
};
