// config.js
require('dotenv').config();

const config = {
  // API Configuration
  apiKey: process.env.PAGESPEED_API_KEY || 'YOUR_API_KEY_HERE',
  
  // Sitemap Configuration
  sitemapUrl: process.env.SITEMAP_URL || 'https://yourwebsite.com/sitemap.xml',
  
  // PageSpeed Test Configuration
  strategies: ['mobile', 'desktop'],
  delay: 2500,
  timeout: 90000,
  
  // URL Filtering & Limiting
  maxUrls: null,
  filterPattern: null,
  deduplicateUrls: true, // NEW: Remove duplicate URLs
  normalizeUrls: true, // NEW: Normalize URLs (trailing slash, etc)
  
  // Batching Configuration (NEW)
  batchSize: 10, // Process 10 URLs per batch
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
  retryDelay: 5000,
};

module.exports = config;