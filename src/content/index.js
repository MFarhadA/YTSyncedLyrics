import { PlayerObserver } from './playerObserver.js';
import { LyricsFetcher } from './lyricsFetcher.js';
import { LyricsRenderer } from './ui/LyricsRenderer.js';

console.log('[SyncYTMusic] Content script initializing...');

const observer = new PlayerObserver();
const fetcher = new LyricsFetcher();
const renderer = new LyricsRenderer();

// State
let currentSongTitle = '';
let currentSongArtist = '';
let globalOffset = 0;
let isEnabled = true;

// Load settings
chrome.storage.sync.get(['enabled', 'offset'], (items) => {
  isEnabled = items.enabled !== false;
  globalOffset = items.offset || 0;
  if (!isEnabled) renderer.hide();
});

// Listen for messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'UPDATE_SETTINGS') {
    if (message.payload.enabled !== undefined) {
      isEnabled = message.payload.enabled;
      isEnabled ? renderer.show() : renderer.hide();
    }
    if (message.payload.offset !== undefined) {
      globalOffset = message.payload.offset;
    }
  }
});

observer.on('onSongChange', async (meta) => {
  console.log('[SyncYTMusic] Song changed:', meta);
  
  if (!isEnabled) return; // Still fetch? Maybe no, to save bandwidth. But if they toggle on, we want it.
  // For now, let's allow fetching even if disabled so it's ready when enabled.
  
  // Avoid refetching if same song (sometimes observer triggers on metadata updates)
  if (currentSongTitle === meta.title && currentSongArtist === meta.artist) return;
  
  currentSongTitle = meta.title;
  currentSongArtist = meta.artist;

  renderer.setLyrics([]); // Clear old
  renderer.container.innerHTML = '<div class="sym-lyrics-line">Fetching lyrics...</div>';

  const lyricsData = await fetcher.fetchLyrics(
    meta.title,
    meta.artist,
    meta.album,
    meta.duration
  );

  if (lyricsData && lyricsData.synced) {
    const parsed = fetcher.parseLrc(lyricsData.synced);
    renderer.setLyrics(parsed);
    console.log('[SyncYTMusic] Lyrics set:', parsed.length, 'lines');
  } else if (lyricsData && lyricsData.plain) {
    renderer.container.innerHTML = '<div class="sym-lyrics-line" style="white-space: pre-wrap;">' + lyricsData.plain + '</div>';
  } else {
    renderer.container.innerHTML = '<div class="sym-lyrics-line">No lyrics found</div>';
  }
});

observer.on('onTimeUpdate', (time) => {
  if (isEnabled) {
    // Apply offset (ms to s)
    const adjTime = time + (globalOffset / 1000);
    renderer.updateTime(adjTime);
  }
});

observer.on('onStateChange', (state) => {
  console.log('[SyncYTMusic] Player state:', state);
});
