===== COPY MULAI DARI SINI =====

text
# 📊 PageSpeed Insights Bulk Checker

Bulk PageSpeed Insights checker untuk menganalisis ratusan/ribuan URLs dari sitemap.xml secara otomatis.

## ✨ Features

- ✅ Extract URLs otomatis dari sitemap.xml
- ✅ Test mobile & desktop bersamaan
- ✅ 4 Categories: Performance, Accessibility, Best Practices, SEO
- ✅ Batch processing dengan state management
- ✅ Output: JSON, CSV, dan HTML report

## 🚀 Setup

### 1. Install Dependencies

```bash
npm install
2. Get API Key
Buka Google Cloud Console

Create/pilih project

Enable PageSpeed Insights API di APIs & Services → Library

Create API key di APIs & Services → Credentials

Copy API key

3. Setup Environment
Copy .env.example ke .env:

bash
cp .env.example .env
Edit .env:

text
PAGESPEED_API_KEY=your_actual_api_key_here
SITEMAP_URL=https://yourwebsite.com/sitemap.xml
4. Verify Setup (Optional)
bash
node test-categories.js
⚙️ Configuration
Edit config.js:

javascript
const config = {
  sitemapUrl: process.env.SITEMAP_URL,
  
  strategies: ['mobile', 'desktop'],  // Atau ['mobile'] saja
  delay: 2500,                        // Delay antar request (ms)
  
  batchSize: 100,                     // URLs per batch (null = unlimited)
  maxUrls: null,                      // Limit URLs (null = unlimited)
  filterPattern: null,                // Regex filter: /\/blog\//
  
  outputFormats: ['json', 'csv', 'html'],
};
Common Configurations
Test 10 URLs saja (debugging):

javascript
maxUrls: 10,
Process 100 URLs per batch:

javascript
batchSize: 100,
Filter hanya blog posts:

javascript
filterPattern: /\/blog\//,
Mobile only:

javascript
strategies: ['mobile'],
🏃 Run Script
Basic Run
bash
node pagespeed-checker.js
Batch Processing (untuk 100+ URLs)
Set batchSize: 100 di config.js, lalu run berkali-kali:

bash
node pagespeed-checker.js  # Batch 1
node pagespeed-checker.js  # Batch 2 (auto skip batch 1)
node pagespeed-checker.js  # Batch 3 (auto skip batch 1-2)
Script otomatis skip URLs yang sudah di-process.

Reset State (start fresh)
bash
rm results/processed-state.json
📁 Output
Results disimpan di folder results/:

pagespeed-results-complete.json - Complete results (all batches)

pagespeed-results-complete.csv - CSV format

pagespeed-results-complete.html - HTML report dengan visualisasi

processed-state.json - Progress tracking

📊 Score Interpretation
Score	Rating
90-100	🟢 Good
50-89	🟡 Needs Improvement
0-49	🔴 Red
🐛 Common Issues
Error: "API key not valid"

Check .env file (no spaces di API key)

Error: "API has not been enabled"

Enable PageSpeed Insights API di Google Cloud Console

All scores are 0

Run node test-categories.js untuk verify

Daily Limit Exceeded

Free tier: 25,000 requests/day

Wait until reset (midnight Pacific Time)

📈 API Quota
Free: 25,000 requests/day

1 URL × 2 strategies = 2 requests

Example: 100 URLs = 200 requests

Estimated Runtime
URLs	Batch	Runtime
< 50	null	~5 min
100-200	100	~30 min
500+	100	Multiple batches
📂 Project Structure
text
pagespeed-bulk-checker/
├── pagespeed-checker.js
├── config.js
├── test-categories.js
├── package.json
├── .env
├── .env.example
├── .gitignore
└── results/
Made with ❤️ for better web performance

text

**===== AKHIR FILE =====**