console.log("Content script loaded");

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
            this.styleEl.textContent = `/* Dark mode injected by extension */\nhtml, body { background:#121212 !important; color:#e0e0e0 !important; }\nbody * { color: inherit; }\na { color:#8ab4f8 !important; }\npre, code { background:#1e1e1e !important; }\ninput, textarea, select { background:#1e1e1e !important; color:#e0e0e0 !important; border:1px solid #333 !important; }\nimg, video { filter: brightness(0.9) contrast(1.05); }\n`;
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