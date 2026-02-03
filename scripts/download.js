// Download episode and upload to Internet Archive
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const EPISODE_URL = process.env.EPISODE_URL || '';
const EPISODE_ID = process.env.EPISODE_ID || Date.now().toString();
const PODCAST_ID = process.env.PODCAST_ID || 'unknown';
const REQUEST_ID = process.env.REQUEST_ID || Date.now().toString();
const IA_ACCESS_KEY = process.env.IA_ACCESS_KEY || '';
const IA_SECRET_KEY = process.env.IA_SECRET_KEY || '';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    
    const request = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 10) return reject(new Error('Too many redirects'));
      
      protocol.get(currentUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          const newFile = fs.createWriteStream(dest);
          const newUrl = new URL(response.headers.location, currentUrl).href;
          return request(newUrl, redirectCount + 1);
        }
        
        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed: ${response.statusCode}`));
        }
        
        const totalSize = parseInt(response.headers['content-length'] || '0');
        let downloadedSize = 0;
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            process.stdout.write(`\rDownloading: ${percent}%`);
          }
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete!');
          resolve({ size: downloadedSize, contentType: response.headers['content-type'] });
        });
      }).on('error', (e) => {
        fs.unlink(dest, () => {});
        reject(e);
      });
    };
    
    request(url);
  });
}

function uploadToInternetArchive(filePath, identifier, metadata) {
  return new Promise((resolve, reject) => {
    if (!IA_ACCESS_KEY || !IA_SECRET_KEY) {
      console.log('No Internet Archive credentials, skipping upload');
      return resolve({ uploaded: false, reason: 'no_credentials' });
    }
    
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);
    
    const options = {
      hostname: 's3.us.archive.org',
      port: 443,
      path: `/${identifier}/${fileName}`,
      method: 'PUT',
      headers: {
        'Authorization': `LOW ${IA_ACCESS_KEY}:${IA_SECRET_KEY}`,
        'Content-Type': metadata.contentType || 'audio/mpeg',
        'Content-Length': fileSize,
        'x-amz-auto-make-bucket': '1',
        'x-archive-meta-mediatype': 'audio',
        'x-archive-meta-collection': 'opensource_audio',
        'x-archive-meta-title': metadata.title || identifier,
        'x-archive-meta-creator': metadata.author || 'Unknown'
      }
    };
    
    console.log(`Uploading to Internet Archive: ${identifier}/${fileName}`);
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const iaUrl = `https://archive.org/download/${identifier}/${fileName}`;
          console.log(`Uploaded: ${iaUrl}`);
          resolve({ uploaded: true, url: iaUrl, identifier });
        } else {
          reject(new Error(`Upload failed: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function main() {
  if (!EPISODE_URL) {
    console.error('No episode URL provided');
    process.exit(1);
  }
  
  // Ensure directories exist
  if (!fs.existsSync('data')) fs.mkdirSync('data');
  if (!fs.existsSync('data/downloads')) fs.mkdirSync('data/downloads');
  if (!fs.existsSync('data/requests')) fs.mkdirSync('data/requests');
  if (!fs.existsSync('temp')) fs.mkdirSync('temp');
  
  const urlParts = new URL(EPISODE_URL);
  const ext = path.extname(urlParts.pathname) || '.mp3';
  const tempFile = path.join('temp', `${EPISODE_ID}${ext}`);
  
  try {
    console.log(`Downloading: ${EPISODE_URL}`);
    const downloadResult = await downloadFile(EPISODE_URL, tempFile);
    
    // Create unique identifier for Internet Archive
    const iaIdentifier = `podcast-${PODCAST_ID}-${EPISODE_ID}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Upload to Internet Archive
    const uploadResult = await uploadToInternetArchive(tempFile, iaIdentifier, {
      contentType: downloadResult.contentType,
      title: `Podcast Episode ${EPISODE_ID}`,
      author: PODCAST_ID
    });
    
    // Save download record
    const record = {
      success: true,
      requestId: REQUEST_ID,
      episodeId: EPISODE_ID,
      podcastId: PODCAST_ID,
      originalUrl: EPISODE_URL,
      size: downloadResult.size,
      timestamp: new Date().toISOString(),
      storage: uploadResult
    };
    
    // Save by episode ID
    const recordPath = path.join('data', 'downloads', `${EPISODE_ID}.json`);
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
    
    // Save by request ID for polling
    const requestPath = path.join('data', 'requests', `${REQUEST_ID}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(record, null, 2));
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    console.log('Done!');
    
  } catch (e) {
    const errorRecord = {
      success: false,
      requestId: REQUEST_ID,
      episodeId: EPISODE_ID,
      error: e.message,
      timestamp: new Date().toISOString()
    };
    
    const requestPath = path.join('data', 'requests', `${REQUEST_ID}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(errorRecord, null, 2));
    
    // Clean up temp file
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    
    console.error('Download failed:', e.message);
    process.exit(1);
  }
}

main();
