console.log("Content script loaded");

/*
 * Table of Contents Feature
 * Requirements:
 *  - Scan <article> for h1-h6 and custom <summary> headers (within <details>)
 *  - Render a fixed panel top-right (below existing buttons) that does not scroll with page
 *  - Indent items proportionally to their font size (fallback to semantic level for h1-h6)
 *  - Highlight (bold) the currently visible heading while scrolling
 *  - Clicking an item scrolls smoothly to that heading; ensure nested <details> are opened
 */

class TableOfContents {
    constructor(options = {}) {
        this.article = options.article || document.querySelector('article') || document.body;
        this.offsetTop = options.offsetTop || 80; // leave room for existing buttons at 20px
        this.container = null;
        this.listEl = null;
        this.toggleButton = null;
        this.isTocVisible = true;
        this.headings = [];
        this.observer = null;
        this.activeId = null;
        this.idCounter = 0;
        this.init();
    }

    init() {
        if (!this.article) return;
        this.collectHeadings();
        if (!this.headings.length) return;
        this.render();
        this.setupIntersectionObserver();
    }

    collectHeadings() {
        // Standard headings
        const selector = 'h1, h2, h3, h4, h5, h6';
        const standard = Array.from(this.article.querySelectorAll(selector));
        console.log(`Found ${standard.length} standard headings`);
        // Custom headers: <summary> elements directly inside <details> within the article hierarchy
        const custom = Array.from(this.article.querySelectorAll('details > summary'));
        const all = [...standard, ...custom];
        const used = new Set();

        this.headings = all.map(el => {
            // Ensure the element has an ID for linking
            let id = el.id;
            if (!id) {
                id = 'toc-auto-' + (++this.idCounter);
                el.id = id;
            }
            // Avoid duplicates due to overlapping queries
            if (used.has(id)) return null;
            used.add(id);

            const level = this.computeLevel(el);
            const fontSizePx = this.extractFontSize(el);
            return { el, id, level, fontSizePx, text: this.getHeadingText(el) };
        }).filter(Boolean);

        // Derive indentation scaling based on font sizes
        const sizes = this.headings.map(h => h.fontSizePx).filter(n => n > 0);
        this.minFont = sizes.length ? Math.min(...sizes) : 14;
        this.maxFont = sizes.length ? Math.max(...sizes) : 32;
    }

    computeLevel(el) {
        // If semantic heading tag, derive from tag name
        if (/^H[1-6]$/.test(el.tagName)) {
            return parseInt(el.tagName.substring(1), 10);
        }
        // For <summary>, attempt to infer level from inline font-size OR nesting depth of <details>
        const depth = this.detailsDepth(el);
        const size = this.extractFontSize(el);
        if (size) {
            // Map relative font size into a pseudo level (1-6)
            // Assume typical sizes 2em ~ H2, 1.5em ~ H3, 1.25em ~ H4, etc.
            if (size >= 30) return 1; // large
            if (size >= 24) return 2;
            if (size >= 20) return 3;
            if (size >= 18) return 4;
            if (size >= 16) return 5;
            return 6;
        }
        return Math.min(6, 1 + depth);
    }

    detailsDepth(el) {
        let depth = 0;
        let current = el.parentElement;
        while (current && current !== this.article) {
            if (current.tagName === 'DETAILS') depth++;
            current = current.parentElement;
        }
        return depth;
    }

    extractFontSize(el) {
        const style = window.getComputedStyle(el);
        const size = parseFloat(style.fontSize) || 0;
        return size;
    }

    getHeadingText(el) {
        // For summary with potential nested elements
        return (el.textContent || '').trim().replace(/\s+/g, ' ');
    }

    calcIndent(fontSizePx, level) {
        // Combine font-size scaling + fallback on level
        if (this.maxFont === this.minFont) {
            return (level - 1) * 12;
        }
        const ratio = (fontSizePx - this.minFont) / (this.maxFont - this.minFont); // 0..1
        const inverted = 1 - ratio; // bigger font -> smaller indent
        const base = inverted * 24; // up to 24px indent difference due to size
        const levelAdj = (level - 1) * 8; // each level adds 8px
        return Math.round(base + levelAdj);
    }

    render() {
        this.container = document.createElement('nav');
        this.container.id = 'ext-toc-container';
        
        // Layout as a right-side column
        const width = '30vw';

        Object.assign(this.container.style, {
            position: 'fixed',
            top: this.offsetTop + 'px',
            right: '0',
            width: width,
            height: `calc(100vh - ${this.offsetTop}px)`,
            overflowY: 'auto',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
            lineHeight: '1.4',
            background: 'rgba(255,255,255,0.98)',
            backdropFilter: 'blur(4px)',
            color: '#222',
            borderLeft: '1px solid #ccc',
            padding: '10px 10px 14px 10px',
            boxShadow: '-2px 0 12px rgba(0,0,0,0.1)',
            zIndex: '10000',
            boxSizing: 'border-box'
        });

        // Shift body content to create "left column"
        document.body.style.transition = 'margin-right 0.3s ease';
        document.body.style.marginRight = width;

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '6px';

        const title = document.createElement('div');
        title.textContent = 'Table of Contents';
        title.style.fontWeight = '600';
        title.style.fontSize = '14px';

        this.toggleButton = document.createElement('button');
        this.toggleButton.textContent = 'Hide';
        Object.assign(this.toggleButton.style, {
            background: 'transparent',
            border: '1px solid #ccc',
            borderRadius: '4px',
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: '12px'
        });
        this.toggleButton.addEventListener('click', () => this.toggleVisibility());

        header.appendChild(title);
        header.appendChild(this.toggleButton);
        this.container.appendChild(header);

        this.listEl = document.createElement('ul');
        Object.assign(this.listEl.style, {
            listStyle: 'none',
            padding: '0',
            margin: '0'
        });

        for (const h of this.headings) {
            const li = document.createElement('li');
            const indent = this.calcIndent(h.fontSizePx, h.level);
            li.style.margin = '0';
            li.style.padding = '0';
            const a = document.createElement('a');
            a.href = '#' + h.id;
            a.textContent = h.text || h.id;
            Object.assign(a.style, {
                display: 'block',
                textDecoration: 'none',
                color: 'inherit',
                fontWeight: '400',
                padding: '2px 4px',
                marginLeft: indent + 'px',
                borderRadius: '4px',
                transition: 'background 0.15s',
                cursor: 'pointer',
                // Allow multi-line wrapping for long headings
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word'
            });
            a.addEventListener('click', (e) => {
                e.preventDefault();
                this.scrollToHeading(h);
            });
            a.addEventListener('mouseover', () => a.style.background = 'rgba(0,0,0,0.08)');
            a.addEventListener('mouseout', () => a.style.background = 'transparent');
            li.appendChild(a);
            this.listEl.appendChild(li);
            h.link = a;
        }
        this.container.appendChild(this.listEl);
        document.body.appendChild(this.container);
    }

    toggleVisibility() {
        this.isTocVisible = !this.isTocVisible;
        
        if (this.isTocVisible) {
            this.listEl.style.display = '';
            this.container.style.width = '30vw';
            this.container.style.background = 'rgba(255,255,255,0.98)';
            this.container.style.borderLeft = '1px solid #ccc';
            this.container.style.boxShadow = '-2px 0 12px rgba(0,0,0,0.1)';
            document.body.style.marginRight = '30vw';
            this.toggleButton.textContent = 'Hide';
            // Show title
            if(this.container.firstChild && this.container.firstChild.firstChild) {
                 this.container.firstChild.firstChild.style.display = '';
            }
        } else {
            this.listEl.style.display = 'none';
            // Collapse to a small button
            this.container.style.width = 'auto';
            this.container.style.background = 'transparent';
            this.container.style.borderLeft = 'none';
            this.container.style.boxShadow = 'none';
            document.body.style.marginRight = '0';
            this.toggleButton.textContent = 'Show';
            // Hide title
            if(this.container.firstChild && this.container.firstChild.firstChild) {
                 this.container.firstChild.firstChild.style.display = 'none';
            }
        }
    }

    setupIntersectionObserver() {
        const opts = { root: null, rootMargin: '0px 0px -60% 0px', threshold: [0, 0.25, 0.6, 1] };
        this.observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting || entry.intersectionRatio > 0) {
                    const id = entry.target.id;
                    if (this.activeId !== id) {
                        this.setActive(id);
                    }
                }
            });
        }, opts);
        this.headings.forEach(h => this.observer.observe(h.el));
    }

    setActive(id) {
        this.activeId = id;
        this.headings.forEach(h => {
            if (!h.link) return;
            if (h.id === id) {
                h.link.style.fontWeight = '700';
                h.link.style.background = 'rgba(66,133,244,0.15)';
                // Auto-scroll TOC panel if active item is outside view
                const rect = h.link.getBoundingClientRect();
                const contRect = this.container.getBoundingClientRect();
                if (rect.top < contRect.top + 40) {
                    this.container.scrollTop -= (contRect.top + 40 - rect.top);
                } else if (rect.bottom > contRect.bottom - 20) {
                    this.container.scrollTop += (rect.bottom - (contRect.bottom - 20));
                }
            } else {
                h.link.style.fontWeight = '400';
                h.link.style.background = 'transparent';
            }
        });
    }

    openDetailsChain(el) {
        let current = el;
        while (current && current !== this.article) {
            if (current.tagName === 'DETAILS') current.open = true;
            current = current.parentElement;
        }
    }

    scrollToHeading(h) {
        // Ensure all parent <details> are open
        this.openDetailsChain(h.el.parentElement);
        h.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.setActive(h.id);
        // Add small flash highlight
        h.el.animate([
            { backgroundColor: 'rgba(255,235,59,0.8)' },
            { backgroundColor: 'transparent' }
        ], { duration: 1000, easing: 'ease-out' });

        // Sync TTS position to the first paragraph following this heading
        if (typeof window.ttsInstance !== 'undefined' && window.ttsInstance.paragraphs) {
            // Find the first paragraph that appears after the heading in the DOM
            const idx = window.ttsInstance.paragraphs.findIndex(p => 
                (h.el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)
            );
            
            if (idx !== -1) {
                window.ttsInstance.currentParagraphIdx = idx;
            }
        }
    }

    destroy() {
        if (this.observer) {
            this.headings.forEach(h => this.observer.unobserve(h.el));
            this.observer.disconnect();
        }
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        
        // Reset body margin
        document.body.style.marginRight = '';

        this.headings = [];
        this.container = null;
        this.toggleButton = null;
    }
}


class TTSToast {

    static show(message) {

        let toast = document.createElement('div');
        toast.id = 'ext-tts-toast';
        toast.className = 'ext-tts-toast';
        Object.assign(toast.style, {
          position: 'fixed',
          top: '70px',
          right: '20px',
          maxWidth: '260px',
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '6px',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          zIndex: '10001',
          opacity: '1',
          transition: 'opacity 0.25s',
          pointerEvents: 'none'
        });
        document.body.appendChild(toast);
        
        toast.textContent = message;
        requestAnimationFrame(() => toast.classList.add('visible'));
        
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 3000);
    }
}

class MyCustomButton {
  static containerId = 'ext-buttons-container';

  static ensureContainer() {
    if (!document.getElementById(MyCustomButton.containerId)) {
      const container = document.createElement('div');
      container.id = MyCustomButton.containerId;
      Object.assign(container.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'row',
        gap: '10px',
        zIndex: '10000'
      });
      document.body.appendChild(container);
    }
  }

  static createInput(inputIdName, className, title, defaultValue, onChangeCallback) {
    MyCustomButton.ensureContainer();
    const container = document.getElementById(MyCustomButton.containerId);
    if (document.getElementById(inputIdName)) return;

    const input = document.createElement('input');
    input.id = inputIdName;
    input.type = 'number';
    input.value = defaultValue;
    input.className = className;
    input.title = title;
    Object.assign(input.style, {
      width: '50px',
      padding: '8px',
      border: '1px solid #ccc',
      borderRadius: '8px',
      textAlign: 'center',
      marginRight: '5px',
      fontFamily: 'system-ui, sans-serif',
      zIndex: '10000'
    });
    input.onchange = onChangeCallback
    if (container) container.appendChild(input);
  }

  static createButtons(buttonText, buttonIdName, title, customStyle, onClickCallback) {
    MyCustomButton.ensureContainer();
    const container = document.getElementById(MyCustomButton.containerId);
    if (document.getElementById(buttonIdName)) return;

    const btn = document.createElement('button');
    btn.id = buttonIdName;
    btn.textContent = buttonText;
    Object.assign(btn.style, {
      padding: '10px 15px',
      cursor: 'pointer',
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
      fontSize: '14px',
      lineHeight: '1',
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: '#444',
      transition: 'filter 0.2s',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    });
    if (customStyle && typeof customStyle === 'object') {
      Object.assign(btn.style, customStyle);
    }
    btn.title = title || '';
    btn.onmouseover = () => btn.style.filter = 'brightness(0.9)';
    btn.onmouseout = () => btn.style.filter = 'brightness(1)';
    
    btn.addEventListener('click', onClickCallback);
    container.appendChild(btn);
  }
  
  static removeButton(buttonIdName) {
    const btn = document.getElementById(buttonIdName);
    if (btn && btn.parentNode) {
      btn.parentNode.removeChild(btn);
    }
  }
}

class ReadParagraphTTS {
    constructor() {
        this.currentParagraphIdx = 0;
        this.delay = 20;
        this.isContinuous = true;
        this.isRandom = false;
        // Store all paragraphs for selection to speak later
        this.paragraphs = Array.from(document.querySelectorAll('p')).filter(p => p.innerText.trim().length > 0);
        this.init();
    }

    init() {

        // Create Delay Input
        MyCustomButton.createInput(
            'tts-delay-input',
            'ext-tts-input',
            'Delay (seconds)',
            this.delay,
            (e) => {
                const val = parseInt(e.target.value, 10);
                if (val > 0) {
                    this.delay = val;
                    TTSToast.show(`Delay set to ${val}s`);
                }
            }
        );

        // Create Loop Button
        MyCustomButton.createButtons('▶️', 'tts-play-btn', 'Start Continuous Mode', { backgroundColor: '#34A853' }, () => {
            TTSToast.show('Play');
            this.play();
        });

        // Create a toggle random button
        MyCustomButton.createButtons('🔀', 'tts-random-btn', 'Start Random Mode', { backgroundColor: '#FBBC05' }, () => {
            TTSToast.show('Random is ' + (this.isRandom ? 'Off' : 'On'));
            this.isRandom = !this.isRandom;
        });

        // Create Stop Button
        MyCustomButton.createButtons('⏹', 'tts-stop-btn', 'Stop', { backgroundColor: '#EA4335' }, () => {
            this.stopAll();
            TTSToast.show('Stopped');
        });

        //Add highlight paragraph styles
        const style = document.createElement('style');
        style.textContent = `
            .ext-tts-highlight {
                outline: 3px solid #4285F4 !important;
                box-shadow: 0 0 15px rgba(66, 133, 244, 0.3) !important;
                background-color: rgba(66, 133, 244, 0.05) !important;
                transition: all 0.3s ease-in-out;
            }
        `;
        document.head.appendChild(style);
    }

    // --- Core Logic ---

    play() {
        let nextParagraphIdx;
        if (this.isRandom) {
            nextParagraphIdx = Math.floor(Math.random() * this.paragraphs.length);
        } else {
            nextParagraphIdx = this.currentParagraphIdx + 1;
        }
        let pastParagraphIdx = this.currentParagraphIdx;
        this.currentParagraphIdx = nextParagraphIdx;

        this.highlightParagraph(pastParagraphIdx);
        this.speak(this.paragraphs[pastParagraphIdx].innerText, () => {
            this.clearHighlight(pastParagraphIdx);
            if (this.isContinuous) {
              setTimeout(() => this.play(), this.delay * 1000);
            }
        });
    }

    stopAll() {
        this.isContinuous = false;
        this.stopSpeech();
        this.clearHighlight(this.currentParagraphIdx);
    }

    // --- Speech & Visuals ---

    highlightParagraph(paragraphIdx) {
        this.paragraphs[paragraphIdx].classList.add('ext-tts-highlight');
        this.paragraphs[paragraphIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    clearHighlight(paragraphIdx) {
        this.paragraphs[paragraphIdx].classList.remove('ext-tts-highlight');
    }

    stopSpeech() {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    speak(text, onEnd) {
        if (!('speechSynthesis' in window)) {
            console.warn("No speech synthesis");
            return;
        }

        // Simple chunking for long text
        const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
        let index = 0;

        const speakNext = () => {
            if (index >= chunks.length) { // Stop if paragraph cleared
                if (onEnd) onEnd();
                return;
            }
            const u = new SpeechSynthesisUtterance(chunks[index++]);
            u.onend = speakNext;
            u.onerror = (e) => { console.warn(e); speakNext(); };
            window.speechSynthesis.speak(u);
        };
        speakNext();
    }

    destroy() {
        this.stopAll();
        ['tts-play-btn', 'tts-stop-btn', 'tts-random-btn'].forEach(id => {
            MyCustomButton.removeButton(id);
        });
        document.getElementById('tts-delay-input')?.remove();
    }
}


class DarkModeFunctionality {
    constructor() {
        this.isDark = false;
        this.styleEl = null;
        this.init();
    }

    init() {
        MyCustomButton.createButtons('🌓 Dark', 'dark-mode-btn', 'Toggle Dark Mode', { backgroundColor: '#222' }, () => this.toggle());
        this.loadPreference();
    }

    get button() {
        return document.getElementById('dark-mode-btn');
    }

    toggle() {
        this.isDark = !this.isDark;
        if (this.isDark) {
            this.applyDark();
        } else {
            this.removeDark();
        }
        try { localStorage.setItem('ext_dark_mode', this.isDark ? '1' : '0'); } catch (_) {}
    }

    loadPreference() {
        try {
            const pref = localStorage.getItem('ext_dark_mode');
            if (pref === '1' && !this.isDark) {
                this.isDark = true;
                this.applyDark();
            }
        } catch (_) {}
    }

    applyDark() {
        if (!this.styleEl) {
            this.styleEl = document.createElement('style');
            this.styleEl.id = 'extension-dark-mode-style';
            this.styleEl.textContent = `/* Dark mode injected by extension */\nhtml, body { background:#121212 !important; color:#e0e0e0 !important; }\nbody * { color: inherit; }\na { color:#8ab4f8 !important; }\npre, code { background:#1e1e1e !important; }\ninput, textarea, select { background:#1e1e1e !important; color:#e0e0e0 !important; border:1px solid #333 !important; }\nimg, video { filter: brightness(0.9) contrast(1.05); }\n#ext-toc-container { background:rgba(32,32,32,0.92) !important; color:#e0e0e0 !important; border-color:#333 !important; }\n#ext-toc-container a { color:#e0e0e0 !important; }\n#ext-toc-container a:hover { background:rgba(255,255,255,0.08) !important; }\n#ext-toc-container a[style*='font-weight: 700'] { background:rgba(138,180,248,0.25) !important; }\n`;
        }
        if (!document.getElementById(this.styleEl.id)) {
            document.head.appendChild(this.styleEl);
        }
        const btn = this.button;
        if (btn) {
            btn.textContent = '🌞 Light';
            btn.style.backgroundColor = '#444';
        }
    }

    removeDark() {
        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
        }
        const btn = this.button;
        if (btn) {
            btn.textContent = '🌓 Dark';
            btn.style.backgroundColor = '#222';
        }
    }

    destroy() {
        MyCustomButton.removeButton('dark-mode-btn');
        if (this.styleEl && this.styleEl.parentNode) this.styleEl.parentNode.removeChild(this.styleEl);
        this.styleEl = null;
    }
}



function startVideoKeepAwake() {
  if (document.getElementById('ext-keepawake-video')) return;

  const v = document.createElement('video');
  v.id = 'ext-keepawake-video';
  v.playsInline = true;
  v.muted = true;
  v.loop = true;
  v.style.position = 'fixed';
  v.style.width = '1px';
  v.style.height = '1px';
  v.style.opacity = '0';
  v.style.pointerEvents = 'none';
  // A 1-second silent WebM or MP4 data URI; this is just an example placeholder
  v.src = 'data:video/webm;base64,GkXfo0AgQoaBAUL...'; // supply a valid tiny silent clip
  document.body.appendChild(v);
  v.play().catch(err => console.warn('Fallback video play failed:', err));
}

function stopVideoKeepAwake() {
  const v = document.getElementById('ext-keepawake-video');
  if (v) {
    v.pause();
    v.remove();
  }
}
setTimeout(() => {
    // Initialize the TTS functionality
    window.ttsInstance = new ReadParagraphTTS();
    // Initialize Dark Mode (button placed to the left of TTS button)
    window.darkModeInstance = new DarkModeFunctionality();
    // Initialize Table of Contents (positioned beneath buttons)
    window.tocInstance = new TableOfContents({ offsetTop: 80 });
    // Attach continuous + stop buttons once dark mode container exists

    if (window.darkModeInstance && window.darkModeInstance.container) {
        window.ttsInstance.attachExtraButtons(window.darkModeInstance.container);
    }
}, 10000);