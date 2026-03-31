const axios = require('axios');
require('dotenv').config();

async function testCategories() {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const testUrl = 'https://dikutip.ai/';
  
  // Build URL with all categories
  let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(testUrl)}&strategy=mobile`;
  
  const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
  categories.forEach(cat => {
    apiUrl += `&category=${cat}`;
  });
  
  apiUrl += `&key=${apiKey}`;
  
  console.log('🔍 Testing with all categories...\n');
  console.log(`URL: ${testUrl}\n`);
  
  try {
    const response = await axios.get(apiUrl, { timeout: 60000 });
    const categories = response.data.lighthouseResult.categories;
    
    console.log('✅ Categories received:\n');
    console.log(`Performance: ${Math.round(categories.performance.score * 100)}/100`);
    console.log(`Accessibility: ${Math.round(categories.accessibility.score * 100)}/100`);
    console.log(`Best Practices: ${Math.round(categories['best-practices'].score * 100)}/100`);
    console.log(`SEO: ${Math.round(categories.seo.score * 100)}/100`);
    
    console.log('\n✅ All categories working correctly!');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testCategories();