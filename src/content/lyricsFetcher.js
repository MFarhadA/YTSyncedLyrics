export class LyricsFetcher {
  async fetchLyrics(title, artist, album, duration) {
    // Delegate to background script to avoid CORS/CSP issues
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'FETCH_LYRICS',
        payload: { title, artist, album, duration }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[YTSyncedLyrics] Runtime error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }

        if (response && response.success) {
          console.log('[YTSyncedLyrics] Background fetch success');
          // normalize data structure
          const data = response.data;
          if (!data) {
            resolve(null);
          } else {
            resolve({
              synced: data.syncedLyrics,
              plain: data.plainLyrics
            });
          }
        } else {
          console.warn('[YTSyncedLyrics] Background fetch failed or empty:', response?.error);
          resolve(null);
        }
      });
    });
  }

  parseLrc(lrcContent) {
    // Simple LRC parser
    // Returns array of { time: seconds, text: string }
    if (!lrcContent) return [];
    
    const lines = lrcContent.split('\n');
    const lyrics = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    lines.forEach(line => {
      const match = line.match(timeRegex);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const fracStr = match[3];
        const fraction = parseInt(fracStr);
        
        let secondsFrac = 0;
        if (fracStr.length === 3) {
            secondsFrac = fraction / 1000;
        } else {
            secondsFrac = fraction / 100;
        }

        // convert to seconds
        const timeVal = minutes * 60 + seconds + secondsFrac;
        const text = line.replace(timeRegex, '').trim();
        if (text) { // ignore empty lines inside sync often
          lyrics.push({ time: timeVal, text });
        }
      }
    });

    return lyrics;
  }
}
