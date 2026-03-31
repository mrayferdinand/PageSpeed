const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Sitemapper = require('sitemapper');
const config = require('./config');

// Normalize URL (remove trailing slash, lowercase, etc)
function normalizeUrl(url) {
  if (!config.normalizeUrls) return url;
  
  try {
    const urlObj = new URL(url);
    // Remove trailing slash
    urlObj.pathname = urlObj.pathname.replace(/\/$/, '') || '/';
    // Lowercase hostname
    urlObj.hostname = urlObj.hostname.toLowerCase();
    return urlObj.toString();
  } catch (e) {
    return url;
  }
}

// Deduplicate URLs
function deduplicateUrls(urls) {
  if (!config.deduplicateUrls) return urls;
  
  const seen = new Set();
  const unique = [];
  
  urls.forEach(url => {
    const normalized = normalizeUrl(url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(url);
    }
  });
  
  if (urls.length !== unique.length) {
    console.log(`🔄 Deduplication: ${urls.length} → ${unique.length} URLs (removed ${urls.length - unique.length} duplicates)\n`);
  }
  
  return unique;
}

// Load processed state
function loadProcessedState() {
  if (!config.skipProcessedUrls) return { processed: new Set(), results: [] };
  
  try {
    if (fs.existsSync(config.stateFile)) {
      const data = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
      console.log(`📋 Loaded state: ${data.processed.length} URLs already processed\n`);
      return {
        processed: new Set(data.processed),
        results: data.results || []
      };
    }
  } catch (error) {
    console.warn(`⚠️  Could not load state file: ${error.message}\n`);
  }
  
  return { processed: new Set(), results: [] };
}

// Save processed state
function saveProcessedState(processed, results) {
  if (!config.skipProcessedUrls) return;
  
  try {
    ensureOutputDir();
    const data = {
      processed: Array.from(processed),
      results: results,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(config.stateFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`⚠️  Could not save state file: ${error.message}`);
  }
}

// Extract URLs dari sitemap
async function extractUrlsFromSitemap(sitemapUrl) {
  try {
    console.log(`📥 Fetching sitemap from: ${sitemapUrl}\n`);

    const sitemap = new Sitemapper({
      url: sitemapUrl,
      timeout: 15000,
      requestHeaders: {
        'User-Agent': 'Mozilla/5.0 (compatible; PageSpeedBulkChecker/1.0;)'
      }
    });

    const { sites, errors } = await sitemap.fetch();

    if (errors && errors.length > 0) {
      console.warn(`⚠️  Sitemap fetch warnings: ${JSON.stringify(errors)}\n`);
    }

    if (sites.length === 0) {
      throw new Error(`Sitemap returned 0 URLs. Possible causes: network timeout, blocked request, or invalid sitemap format.\nURL: ${sitemapUrl}`);
    }

    console.log(`✅ Found ${sites.length} URLs in sitemap\n`);

    return sites;
  } catch (error) {
    console.error('❌ Error fetching sitemap:', error.message);
    throw error;
  }
}

// Get URLs dari source yang dikonfigurasi (sitemap atau list)
async function getUrls() {
  if (config.urlSource === 'list') {
    const urls = (config.urlList || []).filter(url => typeof url === 'string' && url.trim() !== '');
    if (urls.length === 0) {
      throw new Error('urlSource is set to "list" but urlList is empty. Please add URLs to config.urlList.');
    }
    console.log(`📋 Using URL list: ${urls.length} URLs\n`);
    return urls;
  }

  // Default: sitemap
  return extractUrlsFromSitemap(config.sitemapUrl);
}

// ===== CRITICAL AUDIT HELPERS =====

function formatItemValue(val, valueType) {
  if (val === undefined || val === null) return '';

  if (typeof val === 'object') {
    if (val.type === 'url' || val.url) {
      const url = val.url || val.value || '';
      return url.length > 80 ? '...' + url.slice(-77) : url;
    }
    if (val.type === 'code') return val.value || '';
    if (val.type === 'link') return val.text || val.url || '';
    if (val.type === 'source-location') return `${val.url || ''}:${val.line || 0}`;
    if (val.type === 'node') return val.snippet || val.nodeLabel || '';
    return String(val.value || val.text || val.url || '').slice(0, 100);
  }

  const num = Number(val);
  if (!isNaN(num) && String(val).trim() !== '') {
    if (valueType === 'timespanMs' || valueType === 'ms') {
      return num >= 1000 ? `${(num / 1000).toFixed(1)} s` : `${Math.round(num)} ms`;
    }
    if (valueType === 'bytes') {
      if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
      return `${Math.round(num / 1024)} KB`;
    }
    if (valueType === 'numeric') return String(Math.round(num));
  }

  return String(val).slice(0, 120);
}

function simplifyAuditDetails(details) {
  if (!details) return null;
  const { type, items = [], headings = [] } = details;

  if (type !== 'table' && type !== 'opportunity') return null;
  if (!items.length) return null;

  const cols = headings
    .filter(h => h.key && h.key !== 'node')
    .map(h => ({
      key: h.key,
      label: typeof h.label === 'string' ? h.label : (h.text || h.key),
      valueType: h.valueType || h.itemType || 'text'
    }));

  if (!cols.length) return null;

  const simplifiedItems = items.slice(0, 8).map(item => {
    const row = {};
    cols.forEach(col => {
      const formatted = formatItemValue(item[col.key], col.valueType);
      if (formatted) row[col.key] = formatted;
    });
    return row;
  });

  return { cols, items: simplifiedItems };
}

function extractCriticalAudits(lighthouseResult) {
  const auditRefs = lighthouseResult.categories?.performance?.auditRefs || [];
  const audits = lighthouseResult.audits || {};
  const critical = [];

  auditRefs.forEach(ref => {
    const audit = audits[ref.id];
    if (!audit) return;
    if (audit.score === null || audit.score === undefined) return;
    if (audit.score >= 0.5) return;

    critical.push({
      id: audit.id,
      title: audit.title,
      displayValue: audit.displayValue || null,
      score: Math.round(audit.score * 100),
      details: simplifyAuditDetails(audit.details)
    });
  });

  critical.sort((a, b) => a.score - b.score);
  return critical;
}

// ===== END CRITICAL AUDIT HELPERS =====

// Check PageSpeed untuk satu URL dan strategy
async function checkPageSpeed(url, strategy) {
  try {
    // Build API URL with multiple category parameters
    let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}`;
    
    // Add each category as separate parameter (CRITICAL!)
    // API requires ?category=X&category=Y format, NOT comma-separated
    const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
    categories.forEach(cat => {
      apiUrl += `&category=${cat}`;
    });
    
    // Add API key
    apiUrl += `&key=${config.apiKey}`;
    
    if (config.showProgress) {
      console.log(`🔍 Checking [${strategy.toUpperCase()}]: ${url}...`);
    }
    
    const response = await axios.get(apiUrl, { timeout: config.timeout });
    
    const data = response.data;
    
    if (!data.lighthouseResult) {
      throw new Error('Invalid API response: lighthouseResult not found');
    }
    
    const lighthouseResult = data.lighthouseResult;
    
    if (!lighthouseResult.categories) {
      throw new Error('Invalid API response: categories not found');
    }
    
    // Safely get scores with fallback
    const getScore = (category) => {
      try {
        // Handle both 'best-practices' and 'best_practices' formats
        const categoryKey = category === 'best-practices' ? 'best-practices' : category;
        const score = lighthouseResult.categories[categoryKey]?.score;
        return score !== undefined && score !== null ? Math.round(score * 100) : 0;
      } catch (e) {
        console.warn(`Warning: Could not get score for ${category}`);
        return 0;
      }
    };
    
    // Safely get audit value
    const getAuditValue = (auditName) => {
      return lighthouseResult.audits?.[auditName]?.displayValue || 'N/A';
    };
    
    return {
      url: url,
      strategy: strategy,
      performanceScore: getScore('performance'),
      accessibilityScore: getScore('accessibility'),
      bestPracticesScore: getScore('best-practices'),
      seoScore: getScore('seo'),
      fcp: getAuditValue('first-contentful-paint'),
      lcp: getAuditValue('largest-contentful-paint'),
      cls: getAuditValue('cumulative-layout-shift'),
      tti: getAuditValue('interactive'),
      tbt: getAuditValue('total-blocking-time'),
      speedIndex: getAuditValue('speed-index'),
      timestamp: new Date().toISOString(),
      status: 'success',
      criticalAudits: extractCriticalAudits(lighthouseResult)
    };
  } catch (error) {
    let errorMessage = error.message;
    
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      const errorData = error.response.data?.error;
      
      if (status === 429) {
        errorMessage = 'API Rate Limit Exceeded';
      } else if (status === 400) {
        errorMessage = errorData?.message || 'Bad Request';
      } else if (status === 403) {
        errorMessage = 'API Key Invalid or Access Forbidden';
      } else if (status === 500) {
        errorMessage = 'PageSpeed API Internal Error';
      } else {
        errorMessage = `API Error (${status}): ${errorData?.message || statusText}`;
      }
      
      // Show more details for debugging
      if (config.showProgress && errorData) {
        console.error(`   Details: ${JSON.stringify(errorData)}`);
      }
    }
    
    console.error(`❌ Error checking ${url} [${strategy}]: ${errorMessage}`);
    
    return {
      url: url,
      strategy: strategy,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      status: 'failed'
    };
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function ensureOutputDir() {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
    console.log(`📁 Created output directory: ${config.outputDir}\n`);
  }
}

// Main function
async function runBulkCheck() {
  console.log('🚀 Starting Bulk PageSpeed Check from Sitemap\n');
  console.log('='.repeat(60) + '\n');
  
  try {
    ensureOutputDir();
    
    // Load processed state
    const state = loadProcessedState();
    const previousResults = state.results;
    
    // Step 1: Extract URLs
    let urls = await getUrls();
    
    // Step 2: Deduplicate URLs
    urls = deduplicateUrls(urls);
    
    // Step 3: Filter URLs
    if (config.filterPattern) {
      const originalCount = urls.length;
      urls = urls.filter(url => config.filterPattern.test(url));
      console.log(`🔍 Filtered URLs: ${originalCount} → ${urls.length} (matching pattern)\n`);
    }
    
    // Step 4: Filter out already processed URLs
    if (config.skipProcessedUrls && state.processed.size > 0) {
      const originalCount = urls.length;
      urls = urls.filter(url => {
        const normalized = normalizeUrl(url);
        // Check if this URL+strategy combo was processed
        const wasProcessed = config.strategies.every(strategy => {
          const key = `${normalized}|${strategy}`;
          return state.processed.has(key);
        });
        return !wasProcessed;
      });
      
      if (originalCount !== urls.length) {
        console.log(`⏭️  Skipped ${originalCount - urls.length} already processed URLs\n`);
      }
    }
    
    // Step 5: Apply batch size limit
    let currentBatch = urls;
    if (config.batchSize && urls.length > config.batchSize) {
      currentBatch = urls.slice(0, config.batchSize);
      console.log(`📦 Batch mode: Processing ${currentBatch.length} of ${urls.length} URLs\n`);
      console.log(`   Remaining URLs: ${urls.length - currentBatch.length} (will be processed in next run)\n`);
    }
    
    // Step 6: Limit URLs if maxUrls is set
    if (config.maxUrls && currentBatch.length > config.maxUrls) {
      console.log(`⚠️  Limiting to first ${config.maxUrls} URLs (from ${currentBatch.length} total)\n`);
      currentBatch = currentBatch.slice(0, config.maxUrls);
    }
    
    if (currentBatch.length === 0) {
      console.log('✅ All URLs have been processed!\n');
      console.log(`Total processed: ${state.processed.size / config.strategies.length} URLs\n`);
      return;
    }
    
    console.log('='.repeat(60) + '\n');
    console.log(`📊 Processing ${currentBatch.length} URLs with ${config.strategies.length} strategies...\n`);
    console.log(`Strategies: ${config.strategies.map(s => s.toUpperCase()).join(', ')}\n`);
    
    // Step 7: Check PageSpeed
    const results = [];
    let successCount = 0;
    let failCount = 0;
    const totalChecks = currentBatch.length * config.strategies.length;
    let currentCheck = 0;
    
    for (const url of currentBatch) {
      const normalizedUrl = normalizeUrl(url);
      
      for (const strategy of config.strategies) {
        currentCheck++;
        console.log(`[${currentCheck}/${totalChecks}] Processing...`);
        
        let result = null;
        let retryCount = 0;
        
        while (retryCount <= config.maxRetries && !result) {
          if (retryCount > 0) {
            console.log(`   ⚠️  Retry attempt ${retryCount}/${config.maxRetries}...`);
            await sleep(config.retryDelay);
          }
          
          const tempResult = await checkPageSpeed(url, strategy);
          
          if (tempResult.status === 'success') {
            result = tempResult;
          } else if (retryCount === config.maxRetries) {
            result = tempResult;
          } else {
            const isRetryable = !tempResult.error.includes('Invalid') && 
                               !tempResult.error.includes('Forbidden');
            if (!isRetryable) {
              result = tempResult;
              break;
            }
          }
          
          retryCount++;
        }
        
        results.push(result);
        
        // Mark as processed
        const processKey = `${normalizedUrl}|${strategy}`;
        state.processed.add(processKey);
        
        if (result.status === 'success') {
          successCount++;
          if (config.showProgress) {
            console.log(`✅ Performance: ${result.performanceScore}/100\n`);
          }
        } else {
          failCount++;
          if (config.showProgress) {
            console.log(`❌ Failed\n`);
          }
        }
        
        if (currentCheck < totalChecks) {
          await sleep(config.delay);
        }
      }
    }
    
    // Combine with previous results
    const allResults = [...previousResults, ...results];
    
    // Save state after each batch
    saveProcessedState(state.processed, allResults);
    
    // Step 8: Save results
    console.log('='.repeat(60) + '\n');
    console.log('💾 Saving results...\n');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    
    // Save JSON
    if (config.outputFormats.includes('json')) {
      const jsonOutput = JSON.stringify(allResults, null, 2);
      const jsonFilePath = path.join(config.outputDir, `pagespeed-results-complete.json`);
      fs.writeFileSync(jsonFilePath, jsonOutput);
      console.log(`✅ Saved: ${jsonFilePath}`);
      
      // Also save current batch
      const batchJsonPath = path.join(config.outputDir, `pagespeed-results-${timestamp}.json`);
      fs.writeFileSync(batchJsonPath, JSON.stringify(results, null, 2));
      console.log(`✅ Saved batch: ${batchJsonPath}`);
    }
    
    // Save CSV
    if (config.outputFormats.includes('csv')) {
      const csvOutput = convertToCSV(allResults);
      const csvFilePath = path.join(config.outputDir, `pagespeed-results-complete.csv`);
      fs.writeFileSync(csvFilePath, csvOutput);
      console.log(`✅ Saved: ${csvFilePath}`);
    }
    
    // Save HTML
    if (config.outputFormats.includes('html')) {
      const htmlOutput = generateHTMLReport(allResults, state.processed.size / config.strategies.length);
      const htmlFilePath = path.join(config.outputDir, `pagespeed-results-complete.html`);
      fs.writeFileSync(htmlFilePath, htmlOutput);
      console.log(`✅ Saved: ${htmlFilePath}`);
    }
    
    // Display summary
    displaySummary(results, successCount, failCount, currentBatch.length, state.processed.size / config.strategies.length);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Display summary
function displaySummary(results, successCount, failCount, batchUrls, totalProcessed) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 BATCH SUMMARY');
  console.log('='.repeat(60));
  console.log(`Batch URLs: ${batchUrls}`);
  console.log(`Batch checks: ${results.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\n📈 Overall Progress: ${totalProcessed} URLs processed total`);
  
  if (successCount > 0) {
    config.strategies.forEach(strategy => {
      const strategyResults = results.filter(r => r.strategy === strategy && r.status === 'success');
      if (strategyResults.length > 0) {
        const avgPerformance = strategyResults.reduce((sum, r) => sum + r.performanceScore, 0) / strategyResults.length;
        console.log(`\nAverage Performance Score [${strategy.toUpperCase()}]: ${Math.round(avgPerformance)}/100`);
        
        strategyResults.sort((a, b) => b.performanceScore - a.performanceScore);
        const topCount = Math.min(config.showTopPerformers, strategyResults.length);
        
        console.log(`\n🏆 Top ${topCount} Best [${strategy.toUpperCase()}]:`);
        strategyResults.slice(0, topCount).forEach((r, i) => {
          console.log(`${i + 1}. [${r.performanceScore}/100] ${r.url}`);
        });
      }
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Batch completed!\n');
  console.log('💡 Run the script again to process remaining URLs');
}

// Convert to CSV
function convertToCSV(results) {
  if (results.length === 0) return '';
  
  const headers = [
    'url',
    'strategy',
    'status',
    'performanceScore',
    'accessibilityScore',
    'bestPracticesScore',
    'seoScore',
    'fcp',
    'lcp',
    'cls',
    'tti',
    'tbt',
    'speedIndex',
    'timestamp',
    'error'
  ];
  
  const rows = results.map(r => {
    return headers.map(header => {
      const value = r[header] || '';
      return typeof value === 'string' && (value.includes(',') || value.includes('"'))
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    }).join(',');
  });
  
  return `${headers.join(',')}\n${rows.join('\n')}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCriticalIssuesHTML(results) {
  const successResults = results.filter(r => r.status === 'success' && r.criticalAudits?.length > 0);
  if (!successResults.length) return '';

  // Group by URL
  const urlMap = {};
  successResults.forEach(result => {
    if (!urlMap[result.url]) urlMap[result.url] = {};
    urlMap[result.url][result.strategy] = result.criticalAudits;
  });

  const urlBlocks = Object.entries(urlMap).map(([url, strategies]) => {
    // Merge audits across strategies: same id = same issue
    const auditMap = {};
    Object.entries(strategies).forEach(([strategy, audits]) => {
      audits.forEach(audit => {
        if (!auditMap[audit.id]) {
          auditMap[audit.id] = { ...audit, strategies: [], displayValues: {} };
        }
        auditMap[audit.id].strategies.push(strategy);
        if (audit.displayValue) {
          auditMap[audit.id].displayValues[strategy] = audit.displayValue;
        }
        if (!auditMap[audit.id].details && audit.details) {
          auditMap[audit.id].details = audit.details;
        }
      });
    });

    const totalIssues = Object.keys(auditMap).length;

    const auditCards = Object.values(auditMap).map(audit => {
      // Strategy badge
      const allStrategies = config.strategies;
      const coversAll = allStrategies.every(s => audit.strategies.includes(s));
      const strategyBadge = coversAll
        ? `<span class="strat-badge strat-both">Mobile + Desktop</span>`
        : audit.strategies.map(s =>
            `<span class="strat-badge strat-${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</span>`
          ).join('');

      // Display value — show combined if same, per-strategy if different
      const dvEntries = Object.entries(audit.displayValues);
      let displayValueHtml = '';
      if (dvEntries.length === 0) {
        displayValueHtml = '';
      } else if (dvEntries.length === 1 || dvEntries[0][1] === dvEntries[1]?.[1]) {
        displayValueHtml = `<span class="audit-saving">${escapeHtml(dvEntries[0][1])}</span>`;
      } else {
        displayValueHtml = dvEntries
          .map(([s, v]) => `<span class="audit-saving">${escapeHtml(s)}: ${escapeHtml(v)}</span>`)
          .join(' ');
      }

      // Details table
      let detailsHtml = '';
      if (audit.details?.items?.length > 0) {
        const headers = audit.details.cols
          .map(c => `<th>${escapeHtml(c.label)}</th>`)
          .join('');
        const rows = audit.details.items.map(item => {
          const cells = audit.details.cols.map(col => {
            const val = item[col.key] || '';
            const isUrl = col.valueType === 'url' || col.key === 'url';
            const display = escapeHtml(String(val));
            return isUrl
              ? `<td class="detail-url" title="${display}">${display}</td>`
              : `<td>${display}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');

        const itemCount = audit.details.items.length;
        detailsHtml = `
          <details class="detail-table-wrap">
            <summary>Lihat detail (${itemCount} item${itemCount > 1 ? 's' : ''})</summary>
            <div class="table-scroll">
              <table class="detail-table">
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </details>`;
      }

      return `
        <div class="audit-card">
          <div class="audit-header-row">
            <div class="audit-left">
              <span class="audit-title">${escapeHtml(audit.title)}</span>
              ${strategyBadge}
            </div>
            <div class="audit-right">${displayValueHtml}</div>
          </div>
          ${detailsHtml}
        </div>`;
    }).join('');

    return `
      <details class="url-block" open>
        <summary class="url-summary">
          <span class="url-text">${escapeHtml(url)}</span>
          <span class="issue-badge">${totalIssues} issue${totalIssues > 1 ? 's' : ''}</span>
        </summary>
        <div class="audit-list">${auditCards}</div>
      </details>`;
  }).join('');

  return `
    <div class="critical-section">
      <h2>🚨 Critical Performance Issues</h2>
      <p class="critical-note">Menampilkan audit dengan skor &lt; 50 dari kategori Performance.</p>
      ${urlBlocks}
    </div>`;
}

// Generate HTML Report
function generateHTMLReport(results, totalUrls) {
  const successResults = results.filter(r => r.status === 'success');
  const failedResults = results.filter(r => r.status === 'failed');
  
  // Group by URL for comparison
  const urlGroups = {};
  results.forEach(r => {
    if (!urlGroups[r.url]) {
      urlGroups[r.url] = {};
    }
    urlGroups[r.url][r.strategy] = r;
  });
  
  // Calculate averages per strategy
  const strategyStats = {};
  config.strategies.forEach(strategy => {
    const strategyResults = results.filter(r => r.strategy === strategy && r.status === 'success');
    if (strategyResults.length > 0) {
      strategyStats[strategy] = {
        avgPerformance: Math.round(strategyResults.reduce((sum, r) => sum + r.performanceScore, 0) / strategyResults.length),
        avgAccessibility: Math.round(strategyResults.reduce((sum, r) => sum + r.accessibilityScore, 0) / strategyResults.length),
        avgBestPractices: Math.round(strategyResults.reduce((sum, r) => sum + r.bestPracticesScore, 0) / strategyResults.length),
        avgSeo: Math.round(strategyResults.reduce((sum, r) => sum + r.seoScore, 0) / strategyResults.length),
      };
    }
  });
  
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PageSpeed Insights Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      padding: 20px;
      color: #333;
    }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #1a73e8; margin-bottom: 10px; font-size: 32px; }
    .meta { color: #666; margin-bottom: 30px; font-size: 14px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .summary-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; }
    .summary-card h3 { font-size: 14px; opacity: 0.9; margin-bottom: 10px; }
    .summary-card .number { font-size: 32px; font-weight: bold; }
    .strategy-stats { margin-bottom: 30px; }
    .strategy-stats h2 { margin-bottom: 15px; font-size: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat-box { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
    .stat-box .label { font-size: 12px; color: #666; margin-bottom: 5px; }
    .stat-box .value { font-size: 24px; font-weight: bold; }
    .score-good { color: #0cce6b; }
    .score-average { color: #ffa400; }
    .score-poor { color: #ff4e42; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f8f9fa; font-weight: 600; font-size: 14px; color: #666; position: sticky; top: 0; }
    td { font-size: 14px; }
    .url-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 12px; }
    .badge-good { background: #e6f4ea; color: #137333; }
    .badge-average { background: #fef7e0; color: #ea8600; }
    .badge-poor { background: #fce8e6; color: #c5221f; }
    .strategy-label { display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .mobile { background: #e8f0fe; color: #1967d2; }
    .desktop { background: #e6f4ea; color: #137333; }
    .failed { color: #c5221f; }
    .metrics { font-size: 12px; color: #666; }
    /* Critical Issues */
    .critical-section { margin-top: 48px; }
    .critical-section h2 { font-size: 24px; margin-bottom: 8px; }
    .critical-note { color: #666; font-size: 14px; margin-bottom: 20px; }
    .url-block { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
    .url-summary { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: #f8f9fa; cursor: pointer; list-style: none; font-weight: 600; font-size: 14px; }
    .url-summary::-webkit-details-marker { display: none; }
    .url-summary::before { content: '▶'; margin-right: 8px; font-size: 11px; transition: transform 0.2s; }
    details[open] > .url-summary::before { transform: rotate(90deg); }
    .url-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1a73e8; }
    .issue-badge { background: #fce8e6; color: #c5221f; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-left: 12px; white-space: nowrap; }
    .audit-list { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
    .audit-card { background: #fff; border: 1px solid #e8eaed; border-radius: 6px; padding: 12px 16px; }
    .audit-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .audit-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; }
    .audit-title { font-weight: 600; font-size: 14px; }
    .strat-badge { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 3px; text-transform: uppercase; white-space: nowrap; }
    .strat-both { background: #e8f0fe; color: #1967d2; }
    .strat-mobile { background: #e8f0fe; color: #1967d2; }
    .strat-desktop { background: #e6f4ea; color: #137333; }
    .audit-saving { font-size: 13px; color: #c5221f; font-weight: 600; background: #fce8e6; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
    .detail-table-wrap { margin-top: 10px; }
    .detail-table-wrap > summary { cursor: pointer; font-size: 13px; color: #1a73e8; list-style: none; padding: 4px 0; }
    .detail-table-wrap > summary::-webkit-details-marker { display: none; }
    .table-scroll { overflow-x: auto; margin-top: 8px; }
    .detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .detail-table th { background: #f8f9fa; padding: 8px 10px; text-align: left; font-weight: 600; color: #666; border-bottom: 2px solid #e0e0e0; white-space: nowrap; }
    .detail-table td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; }
    .detail-table tr:last-child td { border-bottom: none; }
    .detail-url { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 PageSpeed Insights Report</h1>
    <div class="meta">
      Generated: ${new Date().toLocaleString('id-ID')} | 
      Total URLs: ${totalUrls} | 
      Strategies: ${config.strategies.map(s => s.toUpperCase()).join(', ')}
    </div>
    
    <div class="summary">
      <div class="summary-card">
        <h3>Total Checks</h3>
        <div class="number">${results.length}</div>
      </div>
      <div class="summary-card" style="background: linear-gradient(135deg, #0cce6b 0%, #0a9f55 100%);">
        <h3>Successful</h3>
        <div class="number">${successResults.length}</div>
      </div>
      <div class="summary-card" style="background: linear-gradient(135deg, #ff4e42 0%, #d93025 100%);">
        <h3>Failed</h3>
        <div class="number">${failedResults.length}</div>
      </div>
    </div>
    
    ${config.strategies.map(strategy => {
      const stats = strategyStats[strategy];
      if (!stats) return '';
      
      return `
      <div class="strategy-stats">
        <h2>📱 ${strategy.charAt(0).toUpperCase() + strategy.slice(1)} Strategy</h2>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="label">Performance</div>
            <div class="value ${getScoreClass(stats.avgPerformance)}">${stats.avgPerformance}</div>
          </div>
          <div class="stat-box">
            <div class="label">Accessibility</div>
            <div class="value ${getScoreClass(stats.avgAccessibility)}">${stats.avgAccessibility}</div>
          </div>
          <div class="stat-box">
            <div class="label">Best Practices</div>
            <div class="value ${getScoreClass(stats.avgBestPractices)}">${stats.avgBestPractices}</div>
          </div>
          <div class="stat-box">
            <div class="label">SEO</div>
            <div class="value ${getScoreClass(stats.avgSeo)}">${stats.avgSeo}</div>
          </div>
        </div>
      </div>
      `;
    }).join('')}
    
    <h2>📋 Detailed Results</h2>
    <table>
      <thead>
        <tr>
          <th>URL</th>
          <th>Strategy</th>
          <th>Performance</th>
          <th>Accessibility</th>
          <th>Best Practices</th>
          <th>SEO</th>
          <th>Core Web Vitals</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(urlGroups).map(([url, strategies]) => {
          return config.strategies.map(strategy => {
            const result = strategies[strategy];
            if (!result) return '';
            
            if (result.status === 'failed') {
              return `
                <tr>
                  <td class="url-cell" title="${url}">${url}</td>
                  <td><span class="strategy-label ${strategy}">${strategy}</span></td>
                  <td colspan="5" class="failed">❌ ${result.error}</td>
                </tr>
              `;
            }
            
            return `
              <tr>
                <td class="url-cell" title="${url}">${url}</td>
                <td><span class="strategy-label ${strategy}">${strategy}</span></td>
                <td><span class="score-badge ${getScoreBadgeClass(result.performanceScore)}">${result.performanceScore}</span></td>
                <td><span class="score-badge ${getScoreBadgeClass(result.accessibilityScore)}">${result.accessibilityScore}</span></td>
                <td><span class="score-badge ${getScoreBadgeClass(result.bestPracticesScore)}">${result.bestPracticesScore}</span></td>
                <td><span class="score-badge ${getScoreBadgeClass(result.seoScore)}">${result.seoScore}</span></td>
                <td class="metrics">
                  FCP: ${result.fcp}<br>
                  LCP: ${result.lcp}<br>
                  CLS: ${result.cls}
                </td>
              </tr>
            `;
          }).join('');
        }).join('')}
      </tbody>
    </table>

    ${renderCriticalIssuesHTML(results)}
  </div>
</body>
</html>`;
  
  return html;
}

function getScoreClass(score) {
  if (score >= 90) return 'score-good';
  if (score >= 50) return 'score-average';
  return 'score-poor';
}

function getScoreBadgeClass(score) {
  if (score >= 90) return 'badge-good';
  if (score >= 50) return 'badge-average';
  return 'badge-poor';
}

// Run
runBulkCheck();