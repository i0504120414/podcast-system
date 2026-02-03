// Fetch top podcasts and their feed URLs
const https = require('https');
const fs = require('fs');
const path = require('path');

const COUNTRY = process.env.COUNTRY || 'IL';
const COUNTRIES = ['IL', 'US', 'GB'];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'PodcastProxy/1.0' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: () => data, json: () => JSON.parse(data) }));
    }).on('error', reject);
  });
}

async function getTopPodcasts(country, limit = 25) {
  const url = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}/explicit=true/json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch top podcasts for ${country}`);
  return response.json();
}

async function lookupPodcast(itunesId) {
  const url = `https://itunes.apple.com/lookup?id=${itunesId}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = response.json();
  if (data.results && data.results.length > 0) {
    const item = data.results[0];
    return {
      itunesId,
      title: item.collectionName || item.trackName || '',
      author: item.artistName || '',
      feedUrl: item.feedUrl || '',
      imageUrl: item.artworkUrl600 || item.artworkUrl100 || '',
      genre: item.primaryGenreName || ''
    };
  }
  return null;
}

function extractItunesId(url) {
  const match = url.match(/id(\d+)/);
  return match ? match[1] : null;
}

async function processCountry(country) {
  console.log(`Processing ${country}...`);
  
  try {
    const topData = await getTopPodcasts(country);
    
    // Save raw top data
    const topPath = path.join('data', `top_${country}.json`);
    fs.writeFileSync(topPath, JSON.stringify(topData, null, 2));
    console.log(`  Saved: ${topPath}`);
    
    // Extract iTunes IDs and do lookups
    const entries = topData.feed?.entry || [];
    const lookups = {};
    
    for (const entry of entries) {
      const idUrl = entry.id?.label || '';
      const itunesId = extractItunesId(idUrl);
      
      if (itunesId) {
        console.log(`  Looking up ${itunesId}...`);
        try {
          const lookup = await lookupPodcast(itunesId);
          if (lookup && lookup.feedUrl) {
            lookups[itunesId] = lookup;
            
            // Save individual lookup
            const lookupPath = path.join('data', 'lookups', `${itunesId}.json`);
            fs.writeFileSync(lookupPath, JSON.stringify({ success: true, result: lookup }, null, 2));
          }
        } catch (e) {
          console.log(`    Error: ${e.message}`);
        }
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    // Save combined lookups for this country
    const lookupsPath = path.join('data', `lookups_${country}.json`);
    fs.writeFileSync(lookupsPath, JSON.stringify({ success: true, country, count: Object.keys(lookups).length, lookups }, null, 2));
    console.log(`  Saved ${Object.keys(lookups).length} lookups to ${lookupsPath}`);
    
    return lookups;
  } catch (e) {
    console.error(`  Error processing ${country}: ${e.message}`);
    return {};
  }
}

async function main() {
  // Ensure directories exist
  if (!fs.existsSync('data')) fs.mkdirSync('data');
  if (!fs.existsSync('data/lookups')) fs.mkdirSync('data/lookups');
  
  // Process requested country
  await processCountry(COUNTRY);
  
  // Also process other countries if doing scheduled update
  if (!process.env.SINGLE_COUNTRY) {
    for (const country of COUNTRIES) {
      if (country !== COUNTRY) {
        await processCountry(country);
      }
    }
  }
  
  // Update master lookups file
  const allLookups = {};
  const lookupsDir = path.join('data', 'lookups');
  if (fs.existsSync(lookupsDir)) {
    for (const file of fs.readdirSync(lookupsDir)) {
      if (file.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(path.join(lookupsDir, file)));
        if (data.success && data.result) {
          allLookups[data.result.itunesId] = data.result;
        }
      }
    }
  }
  
  fs.writeFileSync(path.join('data', 'all_lookups.json'), JSON.stringify({ 
    success: true, 
    count: Object.keys(allLookups).length,
    updated: new Date().toISOString(),
    lookups: allLookups 
  }, null, 2));
  
  console.log('Done!');
}

main().catch(console.error);
