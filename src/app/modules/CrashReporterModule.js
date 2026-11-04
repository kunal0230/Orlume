/**
 * CrashReporterModule - Detects unhandled exceptions and promises
 * and seamlessly integrates with the FeedbackModule to allow users
 * to report crashes easily.
 * 
 * Features intelligent false-positive filtering to avoid disrupting
 * users on harmless warnings, browser extension errors, ResizeObserver
 * layout notices, or resource load failures.
 */
export class CrashReporterModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.isReporting = false;
        this.initTime = Date.now();
        this.STARTUP_GRACE_PERIOD_MS = 3500; // Ignore non-critical background noise during startup

        this._handleError = this._handleError.bind(this);
        this._handleUnhandledRejection = this._handleUnhandledRejection.bind(this);
    }

    init() {
        // Intercept global runtime errors
        window.addEventListener('error', this._handleError);
        
        // Intercept unhandled promise rejections
        window.addEventListener('unhandledrejection', this._handleUnhandledRejection);
    }

    /**
     * Determines whether an error event represents a benign notification,
     * external extension error, or non-actionable browser noise.
     */
    _shouldIgnore(message, stack, event) {
        // 1. Ignore resource load errors (e.g. <img>, <link>, <script>, fonts 404ing or blocked by ad-blocker)
        if (event && event.target && event.target !== window && event.target instanceof HTMLElement) {
            return true;
        }

        // 2. Ignore errors without an actionable stack trace (typical of opaque browser/extension errors)
        if (!stack || stack === 'No stack trace available') {
            return true;
        }

        const msg = String(message || '').toLowerCase();
        const stk = String(stack || '').toLowerCase();

        // 3. Ignore cross-origin script errors (opaque security redactions from extensions or external domains)
        if (msg === 'script error.' || msg === 'unknown runtime error') {
            return true;
        }

        // 4. Ignore browser extension errors (Chrome, Firefox, Safari content scripts)
        if (
            stk.includes('chrome-extension://') ||
            stk.includes('moz-extension://') ||
            stk.includes('safari-extension://') ||
            stk.includes('extension://') ||
            msg.includes('could not establish connection') ||
            msg.includes('the message port closed before a response was received') ||
            msg.includes('extension context invalidated')
        ) {
            return true;
        }

        // 5. Ignore benign layout/rendering notifications
        if (
            msg.includes('resizeobserver loop') ||
            msg.includes('resizeobserver loop limit exceeded') ||
            msg.includes('resizeobserver loop completed with undelivered notifications')
        ) {
            return true;
        }

        // 6. Ignore transient network drops, fetch aborts, and audio/video interruptions
        if (
            msg.includes('aborterror') ||
            msg.includes('failed to fetch') ||
            msg.includes('networkerror') ||
            msg.includes('load failed') ||
            msg.includes('the user aborted a request') ||
            msg.includes('the play() request was interrupted')
        ) {
            return true;
        }

        // 7. Ignore harmless third-party analytics / telemetry blocks (e.g. adblockers blocking Vercel scripts)
        if (
            stk.includes('vercel-scripts') ||
            stk.includes('insights') ||
            msg.includes('va.vercel-scripts')
        ) {
            return true;
        }

        // 8. Ignore non-fatal initialization noise during the initial startup grace period
        const isStartup = (Date.now() - this.initTime) < this.STARTUP_GRACE_PERIOD_MS;
        if (isStartup && !stk.includes('src/app') && !stk.includes('src/gpu') && !stk.includes('src/tools')) {
            return true;
        }

        return false;
    }

    _handleError(event) {
        const message = event.message || 'Unknown runtime error';
        const stack = event.error ? event.error.stack : 'No stack trace available';

        if (this._shouldIgnore(message, stack, event)) {
            return;
        }

        this._reportCrash({ message, stack });
    }

    _handleUnhandledRejection(event) {
        let message = 'Unhandled Promise Rejection';
        let stack = 'No stack trace available';

        if (event.reason instanceof Error) {
            message = event.reason.message;
            stack = event.reason.stack;
        } else if (typeof event.reason === 'string') {
            message = event.reason;
        }

        if (this._shouldIgnore(message, stack, event)) {
            return;
        }

        this._reportCrash({ message, stack });
    }

    _reportCrash(errorData) {
        // Prevent infinite loops if the feedback module itself crashes
        if (this.isReporting) return;

        try {
            this.isReporting = true;

            const crashData = {
                message: errorData.message,
                stack: errorData.stack,
                tool: this.editorUI?.state?.currentTool || 'Unknown', // FIXED: crash-reporter-tool-path
                userAgent: navigator.userAgent
            };

            // Stash latest crash details on feedback module so manual bug reports also have access
            if (this.editorUI.feedbackModule) {
                this.editorUI.feedbackModule.lastCrashData = crashData;
            }

            console.error('[Orlume CrashReporter] Intercepted unhandled crash:', crashData);

            // Only trigger if feedback module is initialized and ready
            if (this.editorUI.feedbackModule && typeof this.editorUI.feedbackModule.openCrashReport === 'function') {
                this.editorUI.feedbackModule.openCrashReport(crashData);
            }
        } catch (e) {
            console.error("Crash reporter encountered an error while trying to report a crash.", e);
        } finally {
            // Reset after a short delay to prevent event storming
            setTimeout(() => {
                this.isReporting = false;
            }, 3000);
        }
    }
}
