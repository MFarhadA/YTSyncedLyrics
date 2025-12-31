
// --- PlayerObserver.js ---
class PlayerObserver {
  constructor() {
    this.videoElement = null;
    this.callbacks = {
      onSongChange: [],
      onTimeUpdate: [],
      onStateChange: []
    };
    this.currentMeta = {
      title: '',
      artist: '',
      album: '',
      duration: 0
    };
    this.observer = null;
    this.init();
  }

  init() {
    // Attempt to attach to video element
    this.attachVideoListener();
    // Observe DOM for song changes
    this.observeMetadata();
  }

  attachVideoListener() {
    const checkVideo = setInterval(() => {
      const video = document.querySelector('video');
      if (video) {
        clearInterval(checkVideo);
        this.videoElement = video;
        this.bindVideoEvents();
        console.log('[SyncYTMusic] Video element attached');
        // Re-check metadata now that we have the video element (for duration)
        this.updateMetadata();
      }
    }, 1000);
  }

  bindVideoEvents() {
    this.videoElement.addEventListener('timeupdate', () => {
      this.trigger('onTimeUpdate', this.videoElement.currentTime);
    });
    
    this.videoElement.addEventListener('durationchange', () => {
       // If duration changes (e.g. loads), and we have metadata, we might need to re-trigger song change or just update currentMeta
       if (this.currentMeta.title && (this.currentMeta.duration === 0 || this.currentMeta.duration !== this.videoElement.duration)) {
         this.currentMeta.duration = this.videoElement.duration;
         console.log('[SyncYTMusic] Duration updated:', this.currentMeta.duration);
         // Optionally re-trigger song change if it was invalid before
         this.trigger('onSongChange', this.currentMeta);
       }
    });
    
    this.videoElement.addEventListener('play', () => this.trigger('onStateChange', 'playing'));
    this.videoElement.addEventListener('pause', () => this.trigger('onStateChange', 'paused'));
  }

  observeMetadata() {
    // Strategy: Observe the player bar for text changes.
    // Selector for title: yt-formatted-string.title
    // Selector for artist: yt-formatted-string.byline (complex, might contain Artist - Album - Year)
    
    const targetNode = document.querySelector('ytmusic-player-bar');
    if (!targetNode) {
      setTimeout(() => this.observeMetadata(), 1000);
      return;
    }

    this.updateMetadata(); // Initial check

    this.observer = new MutationObserver(() => {
      this.updateMetadata();
    });

    this.observer.observe(targetNode, {
      subtree: true,
      characterData: true,
      childList: true
    });
  }

  updateMetadata() {
    try {
      if (!navigator.mediaSession || !navigator.mediaSession.metadata) return;
      
      const meta = navigator.mediaSession.metadata;
      const newDuration = this.videoElement ? this.videoElement.duration : 0;
      
      // Check if song changed OR if we just got a valid duration for the current song
      if (meta.title !== this.currentMeta.title || 
          meta.artist !== this.currentMeta.artist ||
          (this.currentMeta.duration === 0 && newDuration > 0)) {
            
        this.currentMeta = {
          title: meta.title,
          artist: meta.artist,
          album: meta.album || '', // Album might be empty sometimes
          duration: newDuration
        };
        console.log('[SyncYTMusic] Song detected/updated:', this.currentMeta);
        this.trigger('onSongChange', this.currentMeta);
      }
    } catch (e) {
      // Fallback to DOM scraping if MediaSession fails (rare on YTM)
      console.warn('MediaSession read failed, falling back logic pending...', e);
    }
  }

  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback);
    }
  }

  trigger(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => cb(data));
    }
  }
}

// --- LyricsFetcher.js ---
class LyricsFetcher {
  async fetchLyrics(title, artist, album, duration) {
    if (!title || !artist || !duration || duration <= 0) {
      console.warn('[SyncYTMusic] Invalid params for fetchLyrics:', { title, artist, album, duration });
      return null;
    }

    // Delegate to background script to avoid CORS/CSP issues
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'FETCH_LYRICS',
        payload: { title, artist, album, duration }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[SyncYTMusic] Runtime error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }

        if (response && response.success) {
          console.log('[SyncYTMusic] Background fetch success');
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
          console.warn('[SyncYTMusic] Background fetch failed or empty:', response?.error);
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
        const fraction = parseInt(match[3]);
        // convert to seconds
        const timeVal = minutes * 60 + seconds + (fraction / 100);
        const text = line.replace(timeRegex, '').trim();
        if (text) { // ignore empty lines inside sync often
          lyrics.push({ time: timeVal, text });
        }
      }
    });

    return lyrics;
  }
}

// --- LyricsRenderer.js ---
class LyricsRenderer {
  constructor() {
    this.container = null;
    this.lyrics = []; // Array of { time, text }
    this.statusMessage = ''; // 'Waiting...', 'Fetching...', etc.
    this.currentIndex = -1;
    this.observer = null;
    this.isAttached = false;
    this.init();
  }

  init() {
    this.observeForLyricsTab();
  }

  observeForLyricsTab() {
    const selector = 'ytmusic-description-shelf-renderer.style-scope.ytmusic-player-secondary-action-renderer';
    
    const checkForContainer = () => {
        const shelves = document.querySelectorAll('ytmusic-description-shelf-renderer');
        let target = null;
        
        for (const shelf of shelves) {
            // Check if this shelf renders lyrics (often checking header or content)
            // YTM 'Lyrics' tab mainly contains this renderer.
            if (shelf.offsetParent !== null) { // is visible
                target = shelf;
                break;
            }
        }

        if (target) {
            if (!this.isAttached || !this.container || !document.contains(this.container)) {
              this.attachToContainer(target);
            }
        } else {
             if (this.isAttached) {
                 console.log('[SyncYTMusic] Lyrics tab hidden/closed');
             }
             this.isAttached = false;
             this.container = null; // References lost if tab switched usually
        }
    };

    setInterval(checkForContainer, 1000);
  }

  attachToContainer(shelf) {
    // Find the description div inside
    // User identified specific selector: .wrapper.style-scope.ytmusic-description-shelf-renderer
    let description = shelf.querySelector('.wrapper.style-scope.ytmusic-description-shelf-renderer');
    
    if (!description && shelf.shadowRoot) {
        description = shelf.shadowRoot.querySelector('.wrapper.style-scope.ytmusic-description-shelf-renderer');
    }

    // Fallback: Check Light/Shadow DOM for ID #description
    if (!description) {
        description = shelf.querySelector('#description');
    }
    if (!description && shelf.shadowRoot) {
        description = shelf.shadowRoot.querySelector('#description');
    }

    // Fallback: Check Light/Shadow DOM for class .description
    if (!description) {
        description = shelf.querySelector('.description');
    }
    if (!description && shelf.shadowRoot) {
        description = shelf.shadowRoot.querySelector('.description');
    }

    // Fallback: yt-formatted-string
    if (!description) {
        const strings = shelf.querySelectorAll('yt-formatted-string');
        if (strings.length > 0) description = strings[strings.length - 1]; 
    }
    if (!description && shelf.shadowRoot) {
        const strings = shelf.shadowRoot.querySelectorAll('yt-formatted-string');
        if (strings.length > 0) description = strings[strings.length - 1]; 
    }
    
    let footer = shelf.querySelector('#footer');
    if (!footer && shelf.shadowRoot) footer = shelf.shadowRoot.querySelector('#footer');

    // If still no description container found, use the shelf itself as the container
    let appendTarget = description ? description.parentNode : shelf;
    let insertReference = description ? description.nextSibling : null;
    
    // Check duplication
    if (shelf.querySelector('.sym-lyrics-container') || (description && description.parentNode.querySelector('.sym-lyrics-container'))) {
        this.container = shelf.querySelector('.sym-lyrics-container') || description.parentNode.querySelector('.sym-lyrics-container');
        this.isAttached = true;
        return;
    }



    // 1. Setup Containers
    this.container = document.createElement('div');
    this.container.className = 'sym-lyrics-container';
    this.container.style.display = 'none';

    // 2. Capture Original Content
    this.originalTarget = description || shelf; // What to hide when showing synced
    this.originalFooter = footer;
    
    // If we are using the shelf directly, we might be hiding EVERYTHING inside it when we switch
    if (appendTarget === shelf) {
        // We will toggle all current children
        this.originalContent = Array.from(shelf.children);
    } else {
        // We will just toggle the description
         this.originalTarget = description;
    }

    // 3. Create Toggle Button
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'sym-switch-btn';
    this.toggleBtn.textContent = 'Switch to Synced Lyrics';
    this.toggleBtn.style.marginTop = '20px';
    this.toggleBtn.style.display = 'block';
    this.toggleBtn.style.margin = '20px auto';
    this.toggleBtn.onclick = () => this.toggleView();
    
    // 4. Append New Elements
    if (appendTarget === shelf) {
        appendTarget.appendChild(this.container);
        appendTarget.appendChild(this.toggleBtn);
    } else {
        appendTarget.insertBefore(this.container, insertReference);
        appendTarget.insertBefore(this.toggleBtn, this.container.nextSibling);
    }
    
    // 5. Hide Footer
    if (footer) footer.style.display = 'none';
    if (this.originalFooter) this.originalFooter.style.display = 'none';

    this.isAttached = true;
    this.isSyncedView = true;
    this.updateViewVisibility();
    
    this.render();
  }

  toggleView() {
    this.isSyncedView = !this.isSyncedView;
    this.updateViewVisibility();
  }

  updateViewVisibility() {
    if (!this.container) return;

    if (this.isSyncedView) {
        this.container.style.display = 'flex';
        // Hide original content
        if (this.originalContent) {
           this.originalContent.forEach(c => c.style.display = 'none');
        } else if (this.originalTarget) {
            this.originalTarget.style.display = 'none';
        }
        this.toggleBtn.textContent = 'Show Native Lyrics';
    } else {
        this.container.style.display = 'none';
         if (this.originalContent) {
           this.originalContent.forEach(c => c.style.display = '');
        } else if (this.originalTarget) {
            this.originalTarget.style.display = 'block'; // or ''
        }
        this.toggleBtn.textContent = 'Switch to Synced Lyrics';
    }
  }



  setLyrics(lyrics) {
    this.lyrics = lyrics;
    this.statusMessage = '';
    this.currentIndex = -1;
    this.render();
  }

  setStatus(msg) {
    this.statusMessage = msg;
    this.lyrics = [];
    this.render();
  }

  render() {
    if (!this.container) return; // Not visible/attached, do nothing

    this.container.innerHTML = '';
    
    if (this.statusMessage) {
        this.container.innerHTML = `<div class="sym-lyrics-line">${this.statusMessage}</div>`;
        return;
    }

    if (!this.lyrics || this.lyrics.length === 0) {
      this.container.innerHTML = '<div class="sym-lyrics-line">No synced lyrics found</div>';
      return;
    }

    this.lyrics.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'sym-lyrics-line';
      lineEl.dataset.index = index;
      lineEl.dataset.time = line.time;
      
      // Calculate duration for karaoke effect
      // Default to 4s if last line
      let duration = 4; 
      if (index < this.lyrics.length - 1) {
          duration = this.lyrics[index + 1].time - line.time;
      }
      // Clamp weird durations
      if (duration <= 0) duration = 3;
      if (duration > 10) duration = 10; // Cap at 10s so it doesn't move too slow
      
      lineEl.style.setProperty('--line-duration', `${duration}s`);
      
      // Split into words for jump animation
      const words = line.text.split(' ');
      words.forEach((word, wIndex) => {
          const span = document.createElement('span');
          span.className = 'sym-word';
          span.textContent = word + ' '; // restore space
          span.style.setProperty('--word-index', wIndex);
          lineEl.appendChild(span);
      });
      
      // Click to seek (optional implementation)
      lineEl.onclick = () => {
         const video = document.querySelector('video');
         if (video) video.currentTime = line.time;
      };

      this.container.appendChild(lineEl);
    });
  }

  updateTime(time) {
    if (!this.container || !this.lyrics.length) return;

    let activeIndex = -1;
    for (let i = 0; i < this.lyrics.length; i++) {
      if (time >= this.lyrics[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }

    if (activeIndex !== this.currentIndex) {
      this.currentIndex = activeIndex;
      this.highlightLine(activeIndex);
      this.scrollToLine(activeIndex);
    }
  }

  highlightLine(index) {
    if (!this.container) return;
    const allLines = this.container.querySelectorAll('.sym-lyrics-line');
    allLines.forEach(l => l.classList.remove('active'));

    if (index >= 0 && index < allLines.length) {
      allLines[index].classList.add('active');
    }
  }

  scrollToLine(index) {
    if (!this.container || index < 0) return;
    const line = this.container.children[index];
    if (line) {
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  
  show() {
    if (this.container) this.container.style.display = 'flex';
  }
  
  hide() {
    if (this.container) this.container.style.display = 'none';
  }
} // End LyricsRenderer

// --- Main Index ---

console.log('[SyncYTMusic] Content script initializing...');

const observer = new PlayerObserver();
const fetcher = new LyricsFetcher();
const renderer = new LyricsRenderer();

// State
let currentSongTitle = '';
let currentSongArtist = '';
let currentSongDuration = 0;
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
  
  // Avoid refetching if same song AND we already had a valid duration
  // If we had no duration (0) and now we do, we SHOULD refetch.
  if (currentSongTitle === meta.title && currentSongArtist === meta.artist && currentSongDuration > 0) return;
  
  currentSongTitle = meta.title;
  currentSongArtist = meta.artist;
  currentSongDuration = meta.duration;

  if (currentSongDuration === 0) {
      console.log('[SyncYTMusic] Waiting for duration...');
      renderer.setStatus('Waiting for duration...');
      return; 
  }

  renderer.setLyrics([]); // Clear old
  renderer.setStatus('Fetching lyrics...');

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
    
    // Immediate sync
    const currentTime = observer.getCurrentTime();
    if (currentTime > 0) {
        const adjTime = currentTime + (globalOffset / 1000);
        renderer.updateTime(adjTime);
    }
    
  } else if (lyricsData && lyricsData.plain) {
    // For plain lyrics, we can just pass them as one large text block via special handling or just text lines
    // simpler to just call setStatus for now or adapt setLyrics
    renderer.setStatus(lyricsData.plain); // Hacky reuse of status for plain text
  } else {
    renderer.setStatus('No lyrics found');
  }
});

observer.on('onTimeUpdate', (time) => {
  if (isEnabled) {
    // Apply offset (ms to s)
    // "2ms faster" -> Interpret as 0.2s earlier trigger (add 0.2 to current time to match future timestamp)
    const adjTime = time + (globalOffset / 1000) + 0.2; 
    renderer.updateTime(adjTime);
  }
});

observer.on('onStateChange', (state) => {
  console.log('[SyncYTMusic] Player state:', state);
});
