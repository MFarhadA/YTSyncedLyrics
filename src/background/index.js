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

async function handleFetchLyrics({ title, artist, album, duration }) {
  const baseUrl = 'https://lrclib.net/api';
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
    duration: Math.round(duration)
  });
  if (album) params.append('album_name', album);

  console.log('[SyncYTMusic-BG] Fetching:', params.toString());

  const response = await fetch(`${baseUrl}/get?${params.toString()}`);
  
  if (!response.ok) {
    if (response.status === 404) {
      return null; // Not found is not an error state for us
    }
    throw new Error(`API Error: ${response.status}`);
  }

  return await response.json();
}

async function handleFetchRomaji({ lines }) {
    console.log('[YTSyncedLyrics-BG] Fetching Romaji line-by-line, count:', lines.length);
    
    try {
        // Fetch each line individually to ensure Google doesn't merge them
        // We use Promise.all for speed, but batch them to be polite to the API
        const results = [];
        const BATCH_SIZE = 10;
        
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
                await new Promise(r => setTimeout(r, 100));
            }
        }
        
        console.log('[YTSyncedLyrics-BG] Final Romaji Lines count:', results.length);
        return results;
    } catch (e) {
        console.error('[YTSyncedLyrics-BG] Romaji Error:', e);
        throw e;
    }
}
