// CHANGES FOR YOUR server.js:

// 1. REMOVE this line (around line 7):
// const { ApifyClient } = require('apify-client');

// 2. ADD this instead (with other requires at top):
const ApifyScraper = require('./apifyScraper');

// 3. CHANGE the apifyClient initialization (around line 22-23):
// Remove: const apifyClient = USE_APIFY_FOR_AMAZON ? new ApifyClient({ token: APIFY_API_KEY }) : null;
// Add this instead:
const apifyScraper = new ApifyScraper(APIFY_API_KEY);
const USE_APIFY_FOR_AMAZON = apifyScraper.isAvailable();

// 4. REMOVE all these Apify-related functions from server.js (they're now in apifyScraper.js):
// - scrapeAmazonWithApify()
// - parseApifyAmazonData()
// - extractDimensionsFromApify()
// - extractWeightFromApify()
// - parseDimensionString()  (if it's duplicated)
// - parseWeightString()      (if it's duplicated)

// 5. UPDATE the scrapeProduct function - change this section:
// FROM:
if (retailer === 'Amazon' && USE_APIFY_FOR_AMAZON) {
  try {
    console.log(`🎯 Using Apify for Amazon product: ${url}`);
    const apifyData = await scrapeAmazonWithApify(url);  // OLD LINE
    // ... rest of the code

// TO:
if (retailer === 'Amazon' && USE_APIFY_FOR_AMAZON) {
  try {
    console.log(`🎯 Using Apify for Amazon product: ${url}`);
    const apifyData = await apifyScraper.scrapeAmazon(url);  // NEW LINE - using apifyScraper instance
    // ... rest of the code stays the same
