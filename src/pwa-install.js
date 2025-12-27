/**
 * PWA Install Prompt Handler
 * Handles the "Add to Home Screen" / "Install App" functionality
 */

let deferredPrompt = null;
const installButton = document.getElementById('pwa-install-btn');

// Listen for the beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show the install button
    if (installButton) {
        installButton.style.display = 'flex';
        console.log('📱 PWA install prompt available');
    }
});

// Handle install button click
if (installButton) {
    installButton.addEventListener('click', async () => {
        if (!deferredPrompt) {
            console.log('No install prompt available');
            return;
        }

        // Show the install prompt
        deferredPrompt.prompt();

        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`📱 User response to install prompt: ${outcome}`);

        // Clear the deferred prompt
        deferredPrompt = null;

        // Hide the install button
        installButton.style.display = 'none';
    });
}

// Listen for successful installation
window.addEventListener('appinstalled', () => {
    console.log('✅ Orlume was installed successfully!');
    // Hide the install button
    if (installButton) {
        installButton.style.display = 'none';
    }
    // Clear the deferred prompt
    deferredPrompt = null;
});

// Check if app is already installed (running in standalone mode)
if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('📱 Running as installed PWA');
}
