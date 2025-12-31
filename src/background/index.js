// Background service worker
console.log('SyncYTMusic background script loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FETCH_LYRICS') {
    handleFetchLyrics(request.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.type === 'FETCH_ROMAJI') {
    handleFetchRomaji(request.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; 
  }
});

const CACHE_LIMIT = 100;
const CACHE_KEY_PREFIX = 'lyric_cache_';

async function handleFetchLyrics({ title, artist, album, duration }) {
  const cacheKey = `${CACHE_KEY_PREFIX}${artist.toLowerCase()}_${title.toLowerCase()}`.replace(/\s+/g, '_');
  
  // 1. Try Cache
  const cached = await getFromCache(cacheKey);
  if (cached) {
    console.log('[SyncYTMusic-BG] Cache Hit:', title);
    return cached;
  }

  const baseUrl = 'https://lrclib.net/api';
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
    duration: Math.round(duration)
  });
  if (album) params.append('album_name', album);

  console.log('[SyncYTMusic-BG] Cache Miss. Fetching:', params.toString());

  const response = await fetch(`${baseUrl}/get?${params.toString()}`);
  
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`API Error: ${response.status}`);
  }

  const data = await response.json();
  
  // 2. Save to Cache
  if (data && data.syncedLyrics) {
    saveToCache(cacheKey, data);
  }

  return data;
}

async function getFromCache(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

async function saveToCache(key, data) {
  // Simple LRU: Keep track of order in a separate key
  chrome.storage.local.get(['cache_order'], (result) => {
    let order = result.cache_order || [];
    
    // Remove if already exists (move to front)
    order = order.filter(k => k !== key);
    order.unshift(key);

    const updates = { [key]: data };

    // Evict if limit reached
    if (order.length > CACHE_LIMIT) {
      const punc = order.pop();
      chrome.storage.local.remove(punc);
    }

    updates.cache_order = order;
    chrome.storage.local.set(updates);
  });
}

async function handleFetchRomaji({ lines }) {
    console.log('[YTSyncedLyrics-BG] Fetching Romaji line-by-line, count:', lines.length);
    
    try {
        // Fetch each line individually to ensure Google doesn't merge them
        // We use Promise.all for speed, but batch them to be polite to the API
        const results = [];
        const BATCH_SIZE = 15;
        
        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            const batch = lines.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (line) => {
                if (!line.trim()) return "";
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=rm&q=${encodeURIComponent(line)}`;
                const response = await fetch(url);
                if (!response.ok) return "";
                const data = await response.json();
                // Transliteration is at data[0][0][3] for single lines
                return (data && data[0] && data[0][0] && data[0][0][3]) || "";
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Tiny delay between batches to avoid 429
            if (i + BATCH_SIZE < lines.length) {
                await new Promise(r => setTimeout(r, 50));
            }
        }
        
        console.log('[YTSyncedLyrics-BG] Final Romaji Lines count:', results.length);
        return results;
    } catch (e) {
        console.error('[YTSyncedLyrics-BG] Romaji Error:', e);
        throw e;
    }
}
