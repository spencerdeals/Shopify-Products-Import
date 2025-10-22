/**
 * Collection Classifier
 *
 * Classifies products into Shopify collections based on title, vendor, category, type, tags, and keywords.
 * Returns collection name and confidence level.
 */

/**
 * Collection classification rules
 */
const COLLECTION_RULES = [
  // Living Room
  {
    collection: 'Living Room Furniture',
    confidence: 0.95,
    keywords: ['sofa', 'couch', 'sectional', 'loveseat', 'recliner', 'chaise'],
    categories: ['sofas', 'sectionals', 'living room']
  },
  {
    collection: 'Living Room Furniture',
    confidence: 0.90,
    keywords: ['coffee table', 'end table', 'console table', 'tv stand', 'media console', 'entertainment center'],
    categories: ['living room tables', 'tv stands', 'entertainment']
  },

  // Bedroom
  {
    collection: 'Bedroom Furniture',
    confidence: 0.95,
    keywords: ['bed', 'headboard', 'footboard', 'bed frame', 'platform bed', 'canopy bed'],
    categories: ['beds', 'bedroom']
  },
  {
    collection: 'Bedroom Furniture',
    confidence: 0.90,
    keywords: ['dresser', 'chest of drawers', 'nightstand', 'bedside table', 'wardrobe', 'armoire'],
    categories: ['bedroom storage', 'dressers', 'nightstands']
  },

  // Dining
  {
    collection: 'Dining Room Furniture',
    confidence: 0.95,
    keywords: ['dining table', 'dining set', 'dining chair', 'bar stool', 'counter stool'],
    categories: ['dining', 'dining tables', 'dining chairs']
  },
  {
    collection: 'Dining Room Furniture',
    confidence: 0.90,
    keywords: ['buffet', 'sideboard', 'china cabinet', 'bar cart', 'wine rack'],
    categories: ['dining storage', 'buffets']
  },

  // Office
  {
    collection: 'Office Furniture',
    confidence: 0.95,
    keywords: ['desk', 'computer desk', 'writing desk', 'standing desk', 'sit stand desk', 'office chair', 'desk chair', 'executive chair'],
    categories: ['office', 'desks', 'office chairs', 'home office']
  },
  {
    collection: 'Office Furniture',
    confidence: 0.90,
    keywords: ['bookcase', 'bookshelf', 'filing cabinet', 'credenza', 'hutch'],
    categories: ['office storage', 'bookcases']
  },

  // Outdoor
  {
    collection: 'Outdoor Furniture',
    confidence: 0.95,
    keywords: ['patio', 'outdoor', 'garden', 'deck', 'balcony', 'porch'],
    categories: ['outdoor', 'patio', 'garden']
  },
  {
    collection: 'Outdoor Furniture',
    confidence: 0.90,
    keywords: ['adirondack', 'lawn chair', 'outdoor dining', 'fire pit', 'umbrella'],
    categories: ['outdoor seating', 'outdoor dining']
  },

  // Storage
  {
    collection: 'Storage & Organization',
    confidence: 0.90,
    keywords: ['cabinet', 'storage', 'shelf', 'shelving', 'organizer', 'rack', 'cart'],
    categories: ['storage', 'cabinets', 'shelving']
  },

  // Lighting
  {
    collection: 'Lighting',
    confidence: 0.95,
    keywords: ['lamp', 'light', 'chandelier', 'pendant', 'sconce', 'floor lamp', 'table lamp', 'ceiling light'],
    categories: ['lighting', 'lamps']
  },

  // Decor
  {
    collection: 'Home Decor',
    confidence: 0.85,
    keywords: ['mirror', 'wall art', 'picture frame', 'vase', 'plant stand', 'throw pillow', 'rug', 'curtain'],
    categories: ['decor', 'home accents', 'wall decor']
  },

  // Seating (generic)
  {
    collection: 'Chairs & Seating',
    confidence: 0.85,
    keywords: ['chair', 'stool', 'bench', 'ottoman', 'pouf'],
    categories: ['seating', 'chairs']
  }
];

/**
 * Normalize text for matching
 */
function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

/**
 * Calculate match score for a collection rule
 */
function calculateMatchScore(rule, { title, vendor, category, type, tags, breadcrumbs }) {
  let score = 0;
  let matches = [];

  const searchText = [
    normalize(title),
    normalize(category),
    normalize(type),
    normalize(tags),
    normalize(breadcrumbs ? breadcrumbs.join(' ') : '')
  ].join(' ');

  // Check keyword matches
  let keywordMatches = 0;
  if (rule.keywords) {
    rule.keywords.forEach(keyword => {
      if (searchText.includes(normalize(keyword))) {
        keywordMatches++;
        matches.push(`keyword: ${keyword}`);
      }
    });
  }

  // Check category matches
  let categoryMatches = 0;
  if (rule.categories) {
    rule.categories.forEach(cat => {
      if (searchText.includes(normalize(cat))) {
        categoryMatches++;
        matches.push(`category: ${cat}`);
      }
    });
  }

  // Calculate score
  if (keywordMatches > 0) {
    score += keywordMatches * 0.4;
  }

  if (categoryMatches > 0) {
    score += categoryMatches * 0.3;
  }

  // Bonus for multiple matches
  if (keywordMatches > 1) {
    score += 0.2;
  }

  return {
    score: Math.min(score, 1.0),
    confidence: rule.confidence,
    matches
  };
}

/**
 * Classify product into collection
 * Returns: { collection: string, confidence: number, unsure: boolean, matches: string[] }
 */
function classifyCollection(productData) {
  const {
    title = '',
    vendor = '',
    category = '',
    type = '',
    tags = '',
    breadcrumbs = []
  } = productData;

  let bestMatch = {
    collection: 'REVIEW_COLLECTION',
    confidence: 0,
    unsure: true,
    matches: []
  };

  // Test each rule
  COLLECTION_RULES.forEach(rule => {
    const matchResult = calculateMatchScore(rule, {
      title,
      vendor,
      category,
      type,
      tags,
      breadcrumbs
    });

    // Combine rule confidence with match score
    const finalConfidence = rule.confidence * matchResult.score;

    if (finalConfidence > bestMatch.confidence) {
      bestMatch = {
        collection: rule.collection,
        confidence: finalConfidence,
        unsure: finalConfidence < 0.6, // Low confidence if < 60%
        matches: matchResult.matches
      };
    }
  });

  console.log(`[Collection] Classified "${title.substring(0, 40)}..." → ${bestMatch.collection} (conf: ${(bestMatch.confidence * 100).toFixed(0)}%, unsure: ${bestMatch.unsure})`);

  return bestMatch;
}

/**
 * Batch classify multiple products
 */
function batchClassifyCollections(products) {
  return products.map(product => ({
    ...product,
    collectionData: classifyCollection(product)
  }));
}

module.exports = {
  classifyCollection,
  batchClassifyCollections,
  COLLECTION_RULES
};
