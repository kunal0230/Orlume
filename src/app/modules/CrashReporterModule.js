/**
 * CrashReporterModule - Detects unhandled exceptions and promises
 * and seamlessly integrates with the FeedbackModule to allow users
 * to report crashes easily.
 */
export class CrashReporterModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.isReporting = false;

        this._handleError = this._handleError.bind(this);
        this._handleUnhandledRejection = this._handleUnhandledRejection.bind(this);
    }

    init() {
        // Intercept global runtime errors
        window.addEventListener('error', this._handleError);
        
        // Intercept unhandled promise rejections
        window.addEventListener('unhandledrejection', this._handleUnhandledRejection);
    }

    _handleError(event) {
        this._reportCrash({
            message: event.message || 'Unknown runtime error',
            stack: event.error ? event.error.stack : 'No stack trace available'
        });
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
                tool: this.editorUI.currentTool || 'Unknown',
                userAgent: navigator.userAgent
            };

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
            }, 2000);
        }
    }
}
