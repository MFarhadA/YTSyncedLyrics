// Background service worker
console.log('SyncYTMusic background script loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FETCH_LYRICS') {
    handleFetchLyrics(request.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // Keep message channel open for async response
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
