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
        this.maxItems = options.maxItems || 500; // safety cap
        this.container = null;
        this.listEl = null;
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
        // Custom headers: <summary> elements directly inside <details> within the article hierarchy
        const custom = Array.from(this.article.querySelectorAll('details > summary'));
        const all = [...standard, ...custom].slice(0, this.maxItems);
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
        Object.assign(this.container.style, {
            position: 'fixed',
            top: this.offsetTop + 'px',
            right: '00px',
            width: '200px',
            maxHeight: '40vh',
            overflowY: 'auto',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
            lineHeight: '1.4',
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(4px)',
            color: '#222',
            border: '1px solid #ccc',
            borderRadius: '8px',
            padding: '10px 10px 14px 10px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: '10000'
        });
        this.container.innerHTML = '<div style="font-weight:600;margin-bottom:6px;font-size:14px;">Table of Contents</div>';
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
    }

    destroy() {
        if (this.observer) {
            this.headings.forEach(h => this.observer.unobserve(h.el));
            this.observer.disconnect();
        }
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.headings = [];
        this.container = null;
    }
}

class RandomParagraphTTS {
    constructor() {
        this.currentFocusedParagraph = null;
        this.button = null;
        this.init();
    }

    init() {
        this.createButton();
        this.setupButtonEvents();
        this.appendButton();
    }

    createButton() {
        this.button = document.createElement('button');
        this.button.textContent = '🔊 Read Random Paragraph';
        
        // Style the button to be on the top right
        Object.assign(this.button.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: '10000',
            padding: '10px 15px',
            cursor: 'pointer',
            backgroundColor: '#4285F4',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            fontSize: '32px',
            lineHeight: '1',
        });
    }

    setupButtonEvents() {
        // Add hover effect
        this.button.onmouseover = () => {
            this.button.style.backgroundColor = '#357ae8';
        };
        this.button.onmouseout = () => {
            this.button.style.backgroundColor = '#4285F4';
        };

        // Add click event listener
        this.button.addEventListener('click', () => this.handleButtonClick());
    }

    appendButton() {
        document.body.appendChild(this.button);
    }

    handleButtonClick() {
        // 1. Find all paragraph tags
        const paragraphs = document.querySelectorAll('p');

        if (paragraphs.length > 0) {
            // 2. Remove previous focus if any
            this.removeParagraphFocus();

            // 3. Select a random paragraph
            const randomIndex = Math.floor(Math.random() * paragraphs.length);
            const randomParagraph = paragraphs[randomIndex];
            const textToSpeak = randomParagraph.innerText;

            // 4. Focus on the selected paragraph
            this.focusOnParagraph(randomParagraph);

            // 5. Speak the text (use Web Speech API to avoid remote TTS issues)
            if (textToSpeak && textToSpeak.trim().length > 0) {
                this.speakText(textToSpeak.trim());
            } else {
                console.log("Selected paragraph is empty.");
            }
        } else {
            console.log("No <p> tags found on this page.");
        }
    }

    focusOnParagraph(paragraph) {
        // Store reference to currently focused paragraph
        this.currentFocusedParagraph = paragraph;
        
        // Add visual styling to highlight the paragraph
        const originalStyle = {
            outline: paragraph.style.outline,
            boxShadow: paragraph.style.boxShadow,
            backgroundColor: paragraph.style.backgroundColor,
            padding: paragraph.style.padding,
            transition: paragraph.style.transition
        };
        
        // Store original styles for restoration later
        paragraph.dataset.originalOutline = originalStyle.outline;
        paragraph.dataset.originalBoxShadow = originalStyle.boxShadow;
        paragraph.dataset.originalBackgroundColor = originalStyle.backgroundColor;
        paragraph.dataset.originalPadding = originalStyle.padding;
        paragraph.dataset.originalTransition = originalStyle.transition;
        
        // Apply focus styling
        Object.assign(paragraph.style, {
            outline: '3px solid #4285F4',
            boxShadow: '0 0 15px rgba(66, 133, 244, 0.3)',
            backgroundColor: 'rgba(66, 133, 244, 0.05)',
            padding: paragraph.style.padding || '10px',
            transition: 'all 0.3s ease-in-out'
        });
        
        // Scroll to the paragraph smoothly
        paragraph.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }

    removeParagraphFocus() {
        if (this.currentFocusedParagraph) {
            // Restore original styles
            this.currentFocusedParagraph.style.outline = this.currentFocusedParagraph.dataset.originalOutline || '';
            this.currentFocusedParagraph.style.boxShadow = this.currentFocusedParagraph.dataset.originalBoxShadow || '';
            this.currentFocusedParagraph.style.backgroundColor = this.currentFocusedParagraph.dataset.originalBackgroundColor || '';
            this.currentFocusedParagraph.style.padding = this.currentFocusedParagraph.dataset.originalPadding || '';
            this.currentFocusedParagraph.style.transition = this.currentFocusedParagraph.dataset.originalTransition || '';
            
            // Clean up data attributes
            delete this.currentFocusedParagraph.dataset.originalOutline;
            delete this.currentFocusedParagraph.dataset.originalBoxShadow;
            delete this.currentFocusedParagraph.dataset.originalBackgroundColor;
            delete this.currentFocusedParagraph.dataset.originalPadding;
            delete this.currentFocusedParagraph.dataset.originalTransition;
            
            this.currentFocusedParagraph = null;
        }
    }

    speakText(fullText) {
        if ('speechSynthesis' in window) {
            // Cancel any ongoing speech
            window.speechSynthesis.cancel();

            // Optionally chunk very long text for better control
            const maxChunk = 800; // safe chunk size
            const chunks = this.chunkText(fullText, maxChunk);

            this.speakChunks(chunks, 0);
        } else if (chrome?.tts) {
            chrome.tts.speak(fullText, { lang: 'en-US', rate: 1 });
        } else {
            console.warn("No speech synthesis available.");
        }
    }

    chunkText(text, maxChunk) {
        const chunks = [];
        let remaining = text;
        
        while (remaining.length > 0) {
            let slice = remaining.slice(0, maxChunk);
            // Try to cut at sentence end
            const lastPunct = slice.lastIndexOf('. ');
            if (lastPunct > 120) slice = slice.slice(0, lastPunct + 1);
            chunks.push(slice);
            remaining = remaining.slice(slice.length).trimStart();
        }
        
        return chunks;
    }

    speakChunks(chunks, index) {
        if (index >= chunks.length) return;
        
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = 'en-US';
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.onend = () => this.speakChunks(chunks, index + 1);
        utterance.onerror = (e) => {
            console.warn("Speech error", e);
            this.speakChunks(chunks, index + 1);
        };
        
        window.speechSynthesis.speak(utterance);
    }

    async playViaGoogle(text) {
        const base = 'https://translate.google.com/translate_tts';
        const url = `${base}?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(text)}&tl=en`;
        
        try {
            const resp = await fetch(url);
            if (!resp.ok) { 
                console.error("TTS fetch failed", resp.status); 
                return; 
            }
            
            const blob = await resp.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            audio.onended = () => URL.revokeObjectURL(audio.src);
            audio.onerror = () => console.error("Audio element error", audio.error);
            audio.play();
        } catch (error) {
            console.error("Error playing via Google TTS:", error);
        }
    }

    // Public method to stop current speech
    stopSpeech() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }

    // Public method to destroy the TTS instance
    destroy() {
        this.stopSpeech();
        this.removeParagraphFocus();
        if (this.button && this.button.parentNode) {
            this.button.parentNode.removeChild(this.button);
        }
        this.button = null;
        this.currentFocusedParagraph = null;
    }
}

class DarkModeFunctionality {
    constructor(ttsButton) {
        this.ttsButton = ttsButton;
        this.button = null;
        this.container = null;
        this.isDark = false;
        this.styleEl = null;
        if (this.ttsButton) {
            this.init();
        }
    }

    init() {
        this.ensureContainer();
        this.createButton();
        this.placeButtons();
        this.loadPreference();
    }

    ensureContainer() {
        // Create a flex container to hold both buttons (dark mode on left, TTS on right)
        this.container = document.createElement('div');
        Object.assign(this.container.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            display: 'flex',
            flexDirection: 'row',
            gap: '10px',
            zIndex: '10000'
        });
        // Adjust the existing TTS button so it behaves inside a flex container
        Object.assign(this.ttsButton.style, {
            position: 'static',
            top: '',
            right: ''
        });
    }

    createButton() {
        this.button = document.createElement('button');
        this.button.textContent = '🌓 Dark';
        Object.assign(this.button.style, {
            padding: '10px 15px',
            cursor: 'pointer',
            backgroundColor: '#222',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            fontSize: '14px',
            lineHeight: '1'
        });
        this.button.title = 'Toggle dark mode';
        this.button.onmouseover = () => { this.button.style.backgroundColor = '#333'; };
        this.button.onmouseout = () => { this.button.style.backgroundColor = '#222'; };
        this.button.addEventListener('click', () => this.toggle());
    }

    placeButtons() {
        // Append dark mode button first (left), then existing TTS button (right)
        this.container.appendChild(this.button);
        this.container.appendChild(this.ttsButton);
        document.body.appendChild(this.container);
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
        this.button.textContent = '🌞 Light';
        this.button.style.backgroundColor = '#444';
    }

    removeDark() {
        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
        }
        this.button.textContent = '🌓 Dark';
        this.button.style.backgroundColor = '#222';
    }

    destroy() {
        if (this.button && this.button.parentNode) this.button.parentNode.removeChild(this.button);
        if (this.styleEl && this.styleEl.parentNode) this.styleEl.parentNode.removeChild(this.styleEl);
        // Move TTS button back to body with original positioning if desired
        if (this.ttsButton && this.ttsButton.parentNode === this.container) {
            document.body.appendChild(this.ttsButton);
            Object.assign(this.ttsButton.style, {
                position: 'fixed',
                top: '20px',
                right: '20px'
            });
        }
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.button = null;
        this.container = null;
        this.styleEl = null;
    }
}

// Initialize the TTS functionality
const ttsInstance = new RandomParagraphTTS();
// Initialize Dark Mode (button placed to the left of TTS button)
const darkModeInstance = new DarkModeFunctionality(ttsInstance.button);
// Initialize Table of Contents (positioned beneath buttons)
const tocInstance = new TableOfContents({ offsetTop: 80 });