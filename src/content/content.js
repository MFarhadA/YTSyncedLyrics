
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
        console.log('[YTSyncedLyrics] Video element attached');
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
         console.log('[YTSyncedLyrics] Duration updated:', this.currentMeta.duration);
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

    let debounceTimeout = null;
    this.observer = new MutationObserver(() => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
          this.updateMetadata();
      }, 200); // 200ms settlement
    });

    this.observer.observe(targetNode, {
      subtree: true,
      characterData: true,
      childList: true
    });
  }

  updateMetadata() {
    try {
      let title = '';
      let artist = '';
      let album = '';
      
      // 1. Try MediaSession (often accurate but can be delayed)
      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        const meta = navigator.mediaSession.metadata;
        title = meta.title;
        artist = meta.artist;
        album = meta.album || '';
      }
      
      // 2. Fallback/Augment with DOM scraping (very fast, but artist/album can be messy)
      const playerBar = document.querySelector('ytmusic-player-bar');
      if (playerBar) {
          const titleEl = playerBar.querySelector('yt-formatted-string.title');
          const bylineEl = playerBar.querySelector('yt-formatted-string.byline');
          
          if (titleEl && (!title || title === '')) {
              title = titleEl.textContent;
          }
          if (bylineEl && (!artist || artist === '')) {
              // Byline usually is "Artist • Album • Year"
              const text = bylineEl.textContent;
              const parts = text.split('•').map(p => p.trim());
              artist = parts[0];
              if (parts.length > 1 && !album) album = parts[1];
          }
      }

      if (!title) return; // Still nothing, maybe player is truly empty

      const newDuration = this.videoElement ? this.videoElement.duration : 0;
      
      // Check if song changed OR if we just got a valid duration for the current song
      if (title !== this.currentMeta.title || 
          artist !== this.currentMeta.artist ||
          (this.currentMeta.duration === 0 && newDuration > 0)) {
            
        this.currentMeta = {
          title: title,
          artist: artist,
          album: album,
          duration: newDuration
        };
        const songId = `${title} - ${artist}`;
        console.log(`[YTSyncedLyrics] Song detected/updated: ${songId}`, this.currentMeta);
        this.trigger('onSongChange', this.currentMeta);
      }
    } catch (e) {
      console.warn('[YTSyncedLyrics] Metadata update failed:', e);
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
    if (!title || !artist) {
      console.warn('[YTSyncedLyrics] Missing required params for fetchLyrics:', { title, artist });
      return null;
    }

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

  needsRomanization(text) {
    // Check for scripts that typically require romanization:
    // CJK (Chinese, Japanese, Korean), Cyrillic, Greek, Arabic, Hebrew, Thai, etc.
    return /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
  }

  async fetchRomaji(lines) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'FETCH_ROMAJI',
        payload: { lines: lines }
      }, (response) => {
        if (response && response.success && response.data) {
          console.log('[YTSyncedLyrics] Romaji lines received:', response.data.length);
          resolve(response.data);
        } else {
          console.warn('[YTSyncedLyrics] Romaji fetch failed:', response?.error);
          resolve(null);
        }
      });
    });
  }
}

// --- LyricsRenderer.js ---
class LyricsRenderer {
  constructor() {
    this.container = null;
    this.lyrics = []; // Array of { time, text }
    this.statusMessage = 'Waiting for song...'; 
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
                 console.log('[YTSyncedLyrics] Lyrics tab hidden/closed');
             }
             this.isAttached = false;
             this.container = null; // References lost if tab switched usually
        }
    };

    setInterval(checkForContainer, 500);
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
    const existingContainer = shelf.querySelector('.sym-lyrics-container') || (description && description.parentNode.querySelector('.sym-lyrics-container'));
    const existingSourceGroup = shelf.querySelector('.sym-source-group') || (description && description.parentNode.querySelector('.sym-source-group'));
    
    if (existingContainer) {
        this.container = existingContainer;
        this.sourceGroup = existingSourceGroup;
        this.isAttached = true;
        
        // Re-find children if they were lost from properties
        if (this.sourceGroup) {
            this.ytBtn = this.sourceGroup.querySelector('.sym-source-btn:nth-child(1)');
            this.lrcBtn = this.sourceGroup.querySelector('.sym-source-btn:nth-child(2)');
        }
        
        this.updateViewVisibility();
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

    // 3. Create Source Toggle Group
    this.sourceGroup = document.createElement('div');
    this.sourceGroup.className = 'sym-source-group';
    
    this.ytBtn = document.createElement('button');
    this.ytBtn.className = 'sym-source-btn';
    this.ytBtn.textContent = 'YTMusic';
    this.ytBtn.onclick = () => {
        this.isSyncedView = false;
        this.updateViewVisibility();
    };

    this.lrcBtn = document.createElement('button');
    this.lrcBtn.className = 'sym-source-btn';
    this.lrcBtn.textContent = 'LRCLib';
    this.lrcBtn.onclick = () => {
        this.isSyncedView = true;
        this.updateViewVisibility();
    };

    this.sourceGroup.appendChild(this.ytBtn);
    this.sourceGroup.appendChild(this.lrcBtn);
    
    // 4. Append New Elements
    // Prepend source group to ensure it stays at the top above all lyrics (Native or Synced)
    appendTarget.prepend(this.sourceGroup);
    
    if (appendTarget === shelf) {
        appendTarget.appendChild(this.container);
    } else {
        // Insert synced container after the source buttons
        appendTarget.insertBefore(this.container, this.sourceGroup.nextSibling);
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
    if (!this.container || !this.sourceGroup) return;

    if (this.isSyncedView) {
        this.container.style.display = 'flex';
        // Hide original content
        if (this.originalContent) {
           this.originalContent.forEach(c => c.style.display = 'none');
        } else if (this.originalTarget) {
            this.originalTarget.style.display = 'none';
        }
        
        this.lrcBtn.classList.add('active');
        this.ytBtn.classList.remove('active');
    } else {
        this.container.style.display = 'none';
         if (this.originalContent) {
           this.originalContent.forEach(c => c.style.display = '');
        } else if (this.originalTarget) {
            this.originalTarget.style.display = 'block'; // or ''
        }
        
        this.ytBtn.classList.add('active');
        this.lrcBtn.classList.remove('active');
    }
  }



  setLyrics(lyrics) {
    this.lyrics = lyrics;
    this.romajiLyrics = null; // Clear old romaji
    this.statusMessage = '';
    this.currentIndex = -1;
    this.render();
  }

  setRomaji(romaji) {
    this.romajiLyrics = romaji;
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
        if (this.statusMessage === 'Fetching lyrics...' || this.statusMessage === 'Waiting for duration...') {
            this.container.innerHTML = `
                <div class="sym-loading-container">
                    <div class="sym-loading-line"></div>
                    <div class="sym-loading-line" style="width: 80%"></div>
                    <div class="sym-loading-line" style="width: 60%"></div>
                    <div class="sym-loading-line" style="width: 70%"></div>
                    <div class="sym-loading-line" style="width: 50%"></div>
                    <div class="sym-loading-text">${this.statusMessage}</div>
                </div>
            `;
        } else {
            this.container.innerHTML = `<div class="sym-lyrics-line">${this.statusMessage}</div>`;
        }
        return;
    }

    if (!this.lyrics || this.lyrics.length === 0) {
      if (this.statusMessage === 'Waiting for song...') {
          this.container.innerHTML = '<div class="sym-lyrics-line">Waiting for song metadata...</div>';
      } else {
          this.container.innerHTML = '<div class="sym-lyrics-line">No synced lyrics found</div>';
      }
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
      // Container for word spans
      const primaryEl = document.createElement('div');
      primaryEl.className = 'sym-primary-line';
      
      const words = line.text.split(' ');
      words.forEach((word, wIndex) => {
          const span = document.createElement('span');
          span.className = 'sym-word';
          span.textContent = word + '\u00A0'; // force space (nbsp)
          span.style.setProperty('--word-index', wIndex);
          primaryEl.appendChild(span);
      });
      lineEl.appendChild(primaryEl);

      // Add Romaji if available
      if (this.romajiLyrics && this.romajiLyrics[index]) {
          const romajiEl = document.createElement('div');
          romajiEl.className = 'sym-romaji-line';
          
          const rWords = this.romajiLyrics[index].split(' ');
          rWords.forEach((word, wIndex) => {
              const span = document.createElement('span');
              span.className = 'sym-word sym-romaji-word';
              span.textContent = word + '\u00A0';
              span.style.setProperty('--word-index', wIndex);
              romajiEl.appendChild(span);
          });
          lineEl.appendChild(romajiEl);
      }
      
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
    if (!this.container || index < 0 || this.statusMessage) return;
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

console.log('[YTSyncedLyrics] Content script initializing...');

const observer = new PlayerObserver();
const fetcher = new LyricsFetcher();
const renderer = new LyricsRenderer();

// State
let currentSongTitle = '';
let currentSongArtist = '';
let currentSongDuration = 0;
let globalOffset = 0;
let isEnabled = true;
let currentFetchId = 0; 

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
  const fetchId = ++currentFetchId;
  console.log(`[YTSyncedLyrics] Song changed (FetchId: ${fetchId}):`, meta);
  
  if (!isEnabled) return;
  
  // Update state immediately
  currentSongTitle = meta.title;
  currentSongArtist = meta.artist;
  currentSongDuration = meta.duration;

  renderer.setStatus('Fetching lyrics...');

  const lyricsData = await fetcher.fetchLyrics(
    meta.title,
    meta.artist,
    meta.album,
    meta.duration
  );

  // If a newer fetch has started, discard this result
  if (fetchId !== currentFetchId) {
    console.log(`[YTSyncedLyrics] Fetch ${fetchId} discarded, newer fetch ${currentFetchId} in progress`);
    return;
  }

  if (lyricsData && lyricsData.synced) {
    const parsed = fetcher.parseLrc(lyricsData.synced);
    
    // Add a tiny artificial delay to ensure the loading state is visible
    // and provide a smooth transition even if cached.
    setTimeout(() => {
        // Late check
        if (fetchId !== currentFetchId) return;

        renderer.setLyrics(parsed);
        console.log('[YTSyncedLyrics] Lyrics set:', parsed.length, 'lines');
        
        // Romanization Support: Check for non-latin scripts
        const needsRomaji = parsed.some(line => fetcher.needsRomanization(line.text));
        if (needsRomaji) {
            console.log('[YTSyncedLyrics] Non-latin script detected, fetching Romanization...');
            const linesOnly = parsed.map(l => l.text);
            fetcher.fetchRomaji(linesOnly).then(romaji => {
                if (fetchId !== currentFetchId) return;
                if (romaji) renderer.setRomaji(romaji);
            });
        }
    }, 200); // 200ms "breath" transition
  } else if (lyricsData && lyricsData.plain) {
    setTimeout(() => {
      if (fetchId === currentFetchId) renderer.setStatus(lyricsData.plain);
    }, 200);
  } else {
    setTimeout(() => {
      if (fetchId === currentFetchId) renderer.setStatus('No lyrics found');
    }, 200);
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
  console.log('[YTSyncedLyrics] Player state:', state);
});
