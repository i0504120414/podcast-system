// Search podcasts via iTunes API
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const QUERY = process.env.QUERY || '';
const REQUEST_ID = process.env.REQUEST_ID || Date.now().toString();
const LIMIT = parseInt(process.env.LIMIT || '25');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'PodcastProxy/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, json: () => JSON.parse(data) }));
    }).on('error', reject);
  });
}

async function searchPodcasts(query, limit) {
  const params = new URLSearchParams({ 
    term: query, 
    media: 'podcast', 
    entity: 'podcast', 
    limit: limit.toString() 
  });
  
  const url = `https://itunes.apple.com/search?${params}`;
  console.log(`Searching: ${query}`);
  
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  
  const data = response.json();
  const results = [];
  
  for (const item of data.results || []) {
    if (item.feedUrl) {
      results.push({
        itunesId: item.collectionId || item.trackId || 0,
        title: item.collectionName || item.trackName || '',
        author: item.artistName || '',
        feedUrl: item.feedUrl,
        imageUrl: item.artworkUrl600 || item.artworkUrl100 || '',
        description: item.description || '',
        genre: item.primaryGenreName || '',
        trackCount: item.trackCount || 0
      });
    }
  }
  
  return results;
}

function hashQuery(query) {
  return crypto.createHash('md5').update(query.toLowerCase().trim()).digest('hex').substring(0, 12);
}

async function main() {
  if (!QUERY) {
    console.error('No query provided');
    process.exit(1);
  }
  
  // Ensure directories exist
  if (!fs.existsSync('data')) fs.mkdirSync('data');
  if (!fs.existsSync('data/search')) fs.mkdirSync('data/search');
  if (!fs.existsSync('data/requests')) fs.mkdirSync('data/requests');
  
  try {
    const results = await searchPodcasts(QUERY, LIMIT);
    
    const response = {
      success: true,
      query: QUERY,
      requestId: REQUEST_ID,
      resultCount: results.length,
      timestamp: new Date().toISOString(),
      results
    };
    
    // Save by query hash (for caching)
    const queryHash = hashQuery(QUERY);
    const cachePath = path.join('data', 'search', `${queryHash}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(response, null, 2));
    console.log(`Saved cache: ${cachePath}`);
    
    // Save by request ID (for app to poll)
    const requestPath = path.join('data', 'requests', `${REQUEST_ID}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(response, null, 2));
    console.log(`Saved request: ${requestPath}`);
    
    // Also save to lookups for future use
    if (!fs.existsSync('data/lookups')) fs.mkdirSync('data/lookups');
    for (const result of results) {
      if (result.itunesId) {
        const lookupPath = path.join('data', 'lookups', `${result.itunesId}.json`);
        if (!fs.existsSync(lookupPath)) {
          fs.writeFileSync(lookupPath, JSON.stringify({ success: true, result }, null, 2));
        }
      }
    }
    
    console.log(`Found ${results.length} results for "${QUERY}"`);
    
  } catch (e) {
    const errorResponse = {
      success: false,
      query: QUERY,
      requestId: REQUEST_ID,
      error: e.message,
      timestamp: new Date().toISOString()
    };
    
    const requestPath = path.join('data', 'requests', `${REQUEST_ID}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(errorResponse, null, 2));
    
    console.error('Search failed:', e.message);
    process.exit(1);
  }
}

main();
