// Subscribe to podcast - fetch feed and episodes
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ACTION = process.env.ACTION || 'subscribe';
const FEED_URL = process.env.FEED_URL || '';
const PODCAST_ID = process.env.PODCAST_ID || '';
const PODCAST_TITLE = process.env.PODCAST_TITLE || '';
const REQUEST_ID = process.env.REQUEST_ID || Date.now().toString();

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
  // Simple RSS parser - extract episodes
  const episodes = [];
  const channel = {};
  
  // Extract channel info
  const titleMatch = xml.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (titleMatch) channel.title = titleMatch[1].trim();
  
  const authorMatch = xml.match(/<itunes:author>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/itunes:author>/);
  if (authorMatch) channel.author = authorMatch[1].trim();
  
  const imageMatch = xml.match(/<itunes:image[^>]*href=["']([^"']+)["']/);
  if (imageMatch) channel.imageUrl = imageMatch[1];
  
  const descMatch = xml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
  if (descMatch) channel.description = descMatch[1].trim().substring(0, 500);
  
  // Extract episodes
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
    
    const epDescMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    if (epDescMatch) episode.description = epDescMatch[1].trim().substring(0, 300);
    
    if (episode.url) {
      episodes.push(episode);
    }
  }
  
  return { channel, episodes };
}

function generatePodcastId(feedUrl) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(feedUrl).digest('hex').substring(0, 12);
}

async function subscribe() {
  if (!FEED_URL) {
    throw new Error('No feed URL provided');
  }
  
  const podcastId = PODCAST_ID || generatePodcastId(FEED_URL);
  
  console.log(`Subscribing to: ${FEED_URL}`);
  console.log(`Podcast ID: ${podcastId}`);
  
  // Fetch and parse feed
  const response = await fetch(FEED_URL);
  if (!response.ok) throw new Error(`Failed to fetch feed: ${response.status}`);
  
  const { channel, episodes } = parseRSS(response.text);
  console.log(`Found ${episodes.length} episodes`);
  
  // Load existing subscriptions
  const subsPath = path.join('data', 'subscriptions.json');
  let subscriptions = {};
  if (fs.existsSync(subsPath)) {
    subscriptions = JSON.parse(fs.readFileSync(subsPath, 'utf8'));
  }
  
  // Add subscription
  subscriptions[podcastId] = {
    id: podcastId,
    title: PODCAST_TITLE || channel.title || 'Unknown',
    author: channel.author || '',
    feedUrl: FEED_URL,
    imageUrl: channel.imageUrl || '',
    description: channel.description || '',
    episodeCount: episodes.length,
    lastUpdated: new Date().toISOString(),
    subscribedAt: subscriptions[podcastId]?.subscribedAt || new Date().toISOString()
  };
  
  // Save subscriptions
  fs.writeFileSync(subsPath, JSON.stringify(subscriptions, null, 2));
  
  // Save feed data
  const feedPath = path.join('data', 'feeds', `${podcastId}.json`);
  fs.writeFileSync(feedPath, JSON.stringify({
    success: true,
    podcastId,
    channel,
    episodeCount: episodes.length,
    lastUpdated: new Date().toISOString()
  }, null, 2));
  
  // Save episodes
  const episodesDir = path.join('data', 'episodes', podcastId);
  if (!fs.existsSync(episodesDir)) fs.mkdirSync(episodesDir, { recursive: true });
  
  const episodesList = episodes.map((ep, index) => ({
    ...ep,
    id: ep.guid || `ep-${index}`,
    podcastId
  }));
  
  fs.writeFileSync(path.join(episodesDir, 'list.json'), JSON.stringify({
    success: true,
    podcastId,
    count: episodesList.length,
    episodes: episodesList
  }, null, 2));
  
  return {
    success: true,
    action: 'subscribe',
    podcastId,
    title: subscriptions[podcastId].title,
    episodeCount: episodes.length
  };
}

async function unsubscribe() {
  const podcastId = PODCAST_ID || generatePodcastId(FEED_URL);
  
  console.log(`Unsubscribing: ${podcastId}`);
  
  // Load existing subscriptions
  const subsPath = path.join('data', 'subscriptions.json');
  let subscriptions = {};
  if (fs.existsSync(subsPath)) {
    subscriptions = JSON.parse(fs.readFileSync(subsPath, 'utf8'));
  }
  
  const title = subscriptions[podcastId]?.title || 'Unknown';
  delete subscriptions[podcastId];
  
  // Save subscriptions
  fs.writeFileSync(subsPath, JSON.stringify(subscriptions, null, 2));
  
  return {
    success: true,
    action: 'unsubscribe',
    podcastId,
    title
  };
}

async function main() {
  // Ensure directories exist
  ['data', 'data/subscriptions', 'data/feeds', 'data/episodes', 'data/requests'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  
  try {
    let result;
    
    if (ACTION === 'unsubscribe') {
      result = await unsubscribe();
    } else {
      result = await subscribe();
    }
    
    result.requestId = REQUEST_ID;
    result.timestamp = new Date().toISOString();
    
    // Save request result for polling
    const requestPath = path.join('data', 'requests', `${REQUEST_ID}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(result, null, 2));
    
    console.log('Done!', result);
    
  } catch (e) {
    const errorResult = {
      success: false,
      action: ACTION,
      requestId: REQUEST_ID,
      error: e.message,
      timestamp: new Date().toISOString()
    };
    
    const requestPath = path.join('data', 'requests', `${REQUEST_ID}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(errorResult, null, 2));
    
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main();
