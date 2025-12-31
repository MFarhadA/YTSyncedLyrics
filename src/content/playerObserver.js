export class PlayerObserver {
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
      }
    }, 1000);
  }

  bindVideoEvents() {
    this.lastVideoTime = 0;
    this.lastSystemTime = 0;
    this.isPaused = true;

    this.videoElement.addEventListener('timeupdate', () => {
      this.lastVideoTime = this.videoElement.currentTime;
      this.lastSystemTime = performance.now();
      // Regular fallback update
      this.trigger('onTimeUpdate', this.lastVideoTime);
    });
    
    this.videoElement.addEventListener('play', () => {
        this.isPaused = false;
        this.lastSystemTime = performance.now();
        this.trigger('onStateChange', 'playing');
    });

    this.videoElement.addEventListener('pause', () => {
        this.isPaused = true;
        this.trigger('onStateChange', 'paused');
    });

    this.videoElement.addEventListener('seeking', () => {
        this.lastVideoTime = this.videoElement.currentTime;
        this.lastSystemTime = performance.now();
    });

    this.startInterpolationLoop();
  }

  startInterpolationLoop() {
    const loop = () => {
      if (!this.isPaused && this.videoElement) {
        const now = performance.now();
        const delta = (now - this.lastSystemTime) / 1000;
        const interpolatedTime = this.lastVideoTime + delta;
        
        // Safety check: don't drift too far from actual video duration
        if (interpolatedTime <= this.videoElement.duration) {
            this.trigger('onTimeUpdate', interpolatedTime);
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
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
      // Use MediaSession API as it's cleaner than scraping DOM often
      if (meta.title !== this.currentMeta.title || meta.artist !== this.currentMeta.artist) {
        this.currentMeta = {
          title: meta.title,
          artist: meta.artist,
          album: meta.album || '', // Album might be empty sometimes
          duration: this.videoElement ? this.videoElement.duration : 0
        };
        console.log('[YTSyncedLyrics] Song detected:', this.currentMeta);
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

  getCurrentTime() {
    return this.videoElement ? this.videoElement.currentTime : 0;
  }
}
