export class LyricsRenderer {
  constructor() {
    this.container = null;
    this.linesContainer = null;
    this.lyrics = []; // Array of { time, text }
    this.currentIndex = -1;
    this.init();
  }

  init() {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'sym-lyrics-container';
    
    // We might need to inject this into a specific place in YTM to overlay neatly,
    // or just document.body for now with high z-index
    document.body.appendChild(this.container);

    // If we want it to be toggleable or integrate with YTM layout, we can refine this later.
    // For now, overlay is safest.
    
    this.renderEmptyState();
  }

  setLyrics(lyrics) {
    this.lyrics = lyrics;
    this.currentIndex = -1;
    this.renderLyrics();
  }

  renderEmptyState() {
    this.container.innerHTML = '<div class="sym-lyrics-line">Waiting for song...</div>';
  }

  renderLyrics() {
    this.container.innerHTML = '';
    
    if (!this.lyrics || this.lyrics.length === 0) {
      this.container.innerHTML = '<div class="sym-lyrics-line">No synced lyrics found</div>';
      return;
    }

    this.lyrics.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'sym-lyrics-line';
      lineEl.dataset.index = index;
      lineEl.dataset.time = line.time;
      lineEl.textContent = line.text;
      this.container.appendChild(lineEl);
    });
  }

  updateTime(time) {
    if (!this.lyrics.length) return;

    // improved binary search or just simple loop since typical song len < 100 lines
    // finding the last line where time >= line.time
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
    // remove active class from all
    const allLines = this.container.querySelectorAll('.sym-lyrics-line');
    allLines.forEach(l => l.classList.remove('active'));

    if (index >= 0 && index < allLines.length) {
      allLines[index].classList.add('active');
    }
  }

  scrollToLine(index) {
    if (index < 0) return;
    const line = this.container.children[index];
    if (line) {
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  
  show() {
    this.container.style.display = 'flex';
  }
  
  hide() {
    this.container.style.display = 'none';
  }
}
