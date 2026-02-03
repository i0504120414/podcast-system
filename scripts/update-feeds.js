// Update all subscribed feeds - check for new episodes
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 10) return reject(new Error('Too many redirects'));
      
      protocol.get(currentUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location, redirectCount + 1);
        }
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: data }));
      }).on('error', reject);
    };
    
    request(url);
  });
}

function parseRSS(xml) {
  const episodes = [];
  const channel = {};
  
  const titleMatch = xml.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (titleMatch) channel.title = titleMatch[1].trim();
  
  const authorMatch = xml.match(/<itunes:author>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/itunes:author>/);
  if (authorMatch) channel.author = authorMatch[1].trim();
  
  const imageMatch = xml.match(/<itunes:image[^>]*href=["']([^"']+)["']/);
  if (imageMatch) channel.imageUrl = imageMatch[1];
  
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const episode = {};
    
    const epTitleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    if (epTitleMatch) episode.title = epTitleMatch[1].trim();
    
    const enclosureMatch = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*(?:type=["']([^"']+)["'])?[^>]*(?:length=["']([^"']+)["'])?/);
    if (enclosureMatch) {
      episode.url = enclosureMatch[1];
      episode.type = enclosureMatch[2] || 'audio/mpeg';
      episode.size = parseInt(enclosureMatch[3] || '0');
    }
    
    const pubDateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);
    if (pubDateMatch) episode.pubDate = pubDateMatch[1].trim();
    
    const guidMatch = item.match(/<guid[^>]*>([^<]+)<\/guid>/);
    if (guidMatch) episode.guid = guidMatch[1].trim();
    
    const durationMatch = item.match(/<itunes:duration>([^<]+)<\/itunes:duration>/);
    if (durationMatch) episode.duration = durationMatch[1].trim();
    
    if (episode.url) {
      episodes.push(episode);
    }
  }
  
  return { channel, episodes };
}

async function updateFeed(subscription) {
  console.log(`Updating: ${subscription.title} (${subscription.id})`);
  
  try {
    const response = await fetch(subscription.feedUrl);
    if (!response.ok) {
      console.log(`  Failed to fetch: ${response.status}`);
      return { updated: false, error: `HTTP ${response.status}` };
    }
    
    const { channel, episodes } = parseRSS(response.text);
    
    // Load existing episodes
    const episodesDir = path.join('data', 'episodes', subscription.id);
    const episodesListPath = path.join(episodesDir, 'list.json');
    
    let existingEpisodes = [];
    let existingGuids = new Set();
    
    if (fs.existsSync(episodesListPath)) {
      const existing = JSON.parse(fs.readFileSync(episodesListPath, 'utf8'));
      existingEpisodes = existing.episodes || [];
      existingGuids = new Set(existingEpisodes.map(ep => ep.guid || ep.url));
    }
    
    // Find new episodes
    const newEpisodes = episodes.filter(ep => {
      const id = ep.guid || ep.url;
      return !existingGuids.has(id);
    });
    
    console.log(`  Found ${newEpisodes.length} new episodes`);
    
    if (newEpisodes.length > 0) {
      // Merge episodes (new first)
      const allEpisodes = [
        ...newEpisodes.map((ep, i) => ({
          ...ep,
          id: ep.guid || `new-${Date.now()}-${i}`,
          podcastId: subscription.id,
          isNew: true
        })),
        ...existingEpisodes.map(ep => ({ ...ep, isNew: false }))
      ];
      
      // Save updated episodes list
      if (!fs.existsSync(episodesDir)) fs.mkdirSync(episodesDir, { recursive: true });
      
      fs.writeFileSync(episodesListPath, JSON.stringify({
        success: true,
        podcastId: subscription.id,
        count: allEpisodes.length,
        lastUpdated: new Date().toISOString(),
        episodes: allEpisodes
      }, null, 2));
    }
    
    // Update feed info
    const feedPath = path.join('data', 'feeds', `${subscription.id}.json`);
    fs.writeFileSync(feedPath, JSON.stringify({
      success: true,
      podcastId: subscription.id,
      channel: {
        ...channel,
        title: subscription.title,
        imageUrl: channel.imageUrl || subscription.imageUrl
      },
      episodeCount: episodes.length,
      lastUpdated: new Date().toISOString()
    }, null, 2));
    
    return {
      updated: true,
      newEpisodes: newEpisodes.length,
      totalEpisodes: episodes.length
    };
    
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    return { updated: false, error: e.message };
  }
}

async function main() {
  // Ensure directories exist
  ['data', 'data/feeds', 'data/episodes'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  
  // Load subscriptions
  const subsPath = path.join('data', 'subscriptions.json');
  if (!fs.existsSync(subsPath)) {
    console.log('No subscriptions found');
    return;
  }
  
  const subscriptions = JSON.parse(fs.readFileSync(subsPath, 'utf8'));
  const podcastIds = Object.keys(subscriptions);
  
  console.log(`Updating ${podcastIds.length} subscriptions...`);
  
  const results = {};
  
  for (const id of podcastIds) {
    const subscription = subscriptions[id];
    results[id] = await updateFeed(subscription);
    
    // Update subscription record
    subscriptions[id].lastUpdated = new Date().toISOString();
    if (results[id].totalEpisodes) {
      subscriptions[id].episodeCount = results[id].totalEpisodes;
    }
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Save updated subscriptions
  fs.writeFileSync(subsPath, JSON.stringify(subscriptions, null, 2));
  
  // Save update summary
  const summaryPath = path.join('data', 'last_update.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    subscriptionsUpdated: podcastIds.length,
    results
  }, null, 2));
  
  console.log('Done!');
}

main().catch(console.error);
