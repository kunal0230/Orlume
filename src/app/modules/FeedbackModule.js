export class FeedbackModule {
    constructor(editor) {
        this.editor = editor;
        this.modal = null;
        this.closeBtn = null;
        this.form = null;
        this.toolContextInput = null;
        this.submitBtn = null;
        this.statusMsg = null;

        // Bind instance methods
        this.closeModal = this.closeModal.bind(this);
        this._handleKeyDown = this._handleKeyDown.bind(this);
        this._handleSubmit = this._handleSubmit.bind(this);
    }

    init() {
        this._injectModalHTML();
        this._injectFeedbackButtons();

        this.modal = document.getElementById('feedback-modal');
        if (!this.modal) {
            console.warn('Feedback modal not found in DOM.');
            return;
        }

        this.closeBtn = document.getElementById('feedback-close');
        this.form = document.getElementById('feedback-form');
        this.toolContextInput = document.getElementById('feedback-tool-context');
        this.submitBtn = this.form.querySelector('button[type="submit"]');
        this.statusMsg = document.getElementById('feedback-status');

        this._bindEvents();
    }

    _injectModalHTML() {
        if (document.getElementById('feedback-modal')) return;

        const modalHTML = `
            <div id="feedback-modal" class="feedback-modal-overlay">
                <div class="feedback-modal-content">
                    <div class="feedback-modal-header">
                        <h3>Report a Bug or Suggestion</h3>
                        <button id="feedback-close" class="feedback-close-btn" type="button">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="feedback-modal-body">
                        <p class="feedback-note">
                            <strong>Note:</strong> As this is a solo project, it's not always possible to test all cases and bugs can pass to production. Please report any bugs you find and give suggestions!
                        </p>
                        <form id="feedback-form" action="https://formsubmit.co/ajax/orlumevisionlabs@gmail.com" method="POST">
                            <!-- FormSubmit Configuration -->
                            <input type="hidden" name="_captcha" value="false">
                            <input type="hidden" name="_subject" value="Orlume Editor Feedback">
                            <input type="hidden" name="_template" value="table">
                            
                            <div class="feedback-form-group">
                                <label>Tool Context</label>
                                <input type="text" id="feedback-tool-context" name="tool_context" readonly style="opacity: 0.8; background: var(--bg-surface);">
                            </div>
                            <div class="feedback-form-group">
                                <label>Email (Optional, if you want a reply)</label>
                                <input type="email" name="email" placeholder="your@email.com">
                            </div>
                            <div class="feedback-form-group">
                                <label>Message *</label>
                                <textarea name="message" rows="8" required placeholder="Describe the bug or your suggestion..."></textarea>
                            </div>
                            <button type="submit" class="btn btn-primary feedback-submit-btn">Submit Feedback</button>
                            <div id="feedback-status" class="feedback-status" style="display: none;"></div>
                        </form>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    _injectFeedbackButtons() {
        const panels = document.querySelectorAll('.panel-section');
        panels.forEach(panel => {
            if (panel.querySelector('.feedback-btn-wrapper')) return;

            const panelId = panel.id ? panel.id.replace('panel-', '') : 'general';
            // Format ID into readable string
            const toolName = panelId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            const wrapper = document.createElement('div');
            wrapper.className = 'section feedback-btn-wrapper';
            wrapper.style.marginTop = '16px';
            wrapper.style.borderTop = '1px solid var(--border)';
            wrapper.style.paddingTop = '12px';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn feedback-btn';
            btn.dataset.tool = toolName;
            btn.style.width = '100%';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
                Report Bug / Suggestion
            `;

            // Bind click event directly to prevent multiple bindings if init is called twice
            btn.addEventListener('click', (e) => {
                const tName = e.currentTarget.dataset.tool || 'General';
                this.openModal(tName);
            });

            wrapper.appendChild(btn);
            panel.appendChild(wrapper);
        });
    }

    _bindEvents() {
        // Close modal handlers
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', this.closeModal);
        }

        // Close on background click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });

        // Form submission
        if (this.form) {
            this.form.addEventListener('submit', this._handleSubmit);
        }
        
        // Escape key to close
        document.addEventListener('keydown', this._handleKeyDown);
    }

    _handleKeyDown(e) {
        if (e.key === 'Escape' && this.modal && this.modal.classList.contains('active')) {
            this.closeModal();
        }
    }

    openModal(toolName) {
        if (this.toolContextInput) {
            this.toolContextInput.value = toolName;
        }
        
        // Reset form and status
        if (this.form) this.form.reset();
        if (this.statusMsg) {
            this.statusMsg.style.display = 'none';
            this.statusMsg.className = 'feedback-status';
            this.statusMsg.textContent = '';
        }

        if (this.submitBtn) {
            this.submitBtn.disabled = false;
            this.submitBtn.textContent = 'Submit Feedback';
        }

        this.modal.classList.add('active');
        
        // Auto-focus message area
        const msgArea = this.form.querySelector('textarea[name="message"]');
        if (msgArea) {
            setTimeout(() => msgArea.focus(), 100);
        }
    }
    
    openCrashReport(crashData) {
        this.openModal('Crash Report');
        
        // Pre-fill the message textarea with crash details
        const msgArea = this.form.querySelector('textarea[name="message"]');
        if (msgArea) {
            let prefilledMsg = `[CRASH DETECTED]\n`;
            prefilledMsg += `Error: ${crashData.message}\n`;
            prefilledMsg += `Active Tool: ${crashData.tool}\n`;
            prefilledMsg += `User Agent: ${crashData.userAgent}\n`;
            prefilledMsg += `Stack Trace:\n${crashData.stack || 'No stack trace available'}\n\n`;
            prefilledMsg += `[Optional] Please describe what you were doing when the editor crashed:\n`;
            
            msgArea.value = prefilledMsg;
        }
    }

    closeModal() {
        if (this.modal) {
            this.modal.classList.remove('active');
        }
    }

    async _handleSubmit(e) {
        e.preventDefault();
        
        if (this.submitBtn) {
            this.submitBtn.disabled = true;
            this.submitBtn.textContent = 'Submitting...';
        }

        const formData = new FormData(this.form);
        const plainFormData = Object.fromEntries(formData.entries());
        const formDataJsonString = JSON.stringify(plainFormData);
        
        try {
            const response = await fetch(this.form.action, {
                method: 'POST',
                body: formDataJsonString,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                this._showStatus('Feedback submitted successfully! Thank you.', 'success');
                setTimeout(() => this.closeModal(), 2000);
            } else {
                let errorMsg = 'Oops! There was a problem submitting your feedback.';
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.message) {
                        errorMsg = errorData.message;
                    }
                } catch (e) {
                    // Ignore parse error
                }
                this._showStatus(errorMsg, 'error');
                
                if (this.submitBtn) {
                    this.submitBtn.disabled = false;
                    this.submitBtn.textContent = 'Submit Feedback';
                }
            }
        } catch (error) {
            console.error('Feedback submission error:', error);
            this._showStatus('Network error. Please try again later.', 'error');
            if (this.submitBtn) {
                this.submitBtn.disabled = false;
                this.submitBtn.textContent = 'Submit Feedback';
            }
        }
    }

    _showStatus(message, type) {
        if (!this.statusMsg) return;
        this.statusMsg.textContent = message;
        this.statusMsg.className = `feedback-status ${type}`;
        this.statusMsg.style.display = 'block';
    }
}
