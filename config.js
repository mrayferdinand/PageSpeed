// config.js
require('dotenv').config();

const config = {
  // API Configuration
  apiKey: process.env.PAGESPEED_API_KEY || 'YOUR_API_KEY_HERE',

  // URL Source: 'sitemap' or 'list'
  urlSource: 'sitemap',

  // Sitemap Configuration (used when urlSource = 'sitemap')
  sitemapUrl: process.env.SITEMAP_URL || 'https://yourwebsite.com/sitemap.xml',

  // Manual URL List (used when urlSource = 'list')
  urlList: [
    // 'https://yourwebsite.com/',
    // 'https://yourwebsite.com/about',
    // 'https://yourwebsite.com/contact',
  ],
  
  // PageSpeed Test Configuration
  strategies: ['mobile','desktop'],//['mobile', 'desktop'],
  delay: 2500,
  timeout: 90000,
  
  // URL Filtering & Limiting
  maxUrls: null,
  filterPattern: null,
  deduplicateUrls: true, // NEW: Remove duplicate URLs
  normalizeUrls: true, // NEW: Normalize URLs (trailing slash, etc)
  
  // Batching Configuration (NEW)
  batchSize: 5, // Process 10 URLs per batch
  skipProcessedUrls: true, // Skip URLs that were already processed
  stateFile: './results/processed-state.json', // Track processed URLs
  
  // Output Configuration
  outputDir: './results',
  outputFormats: ['json', 'csv', 'html'],
  
  // Display Configuration
  showProgress: true,
  showTopPerformers: 5,
  
  // Advanced Options
  categories: ['performance', 'accessibility', 'best-practices', 'seo'],
  locale: 'id',
  
  // Retry Configuration
  maxRetries: 2,
  retryDelay: 60000,
};

module.exports = config;