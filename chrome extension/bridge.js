/**
 * SoraVault — bridge.js
 * Runs in ISOLATED world at document_start.
 * Injects the extension's base URL into a <meta> tag so the MAIN world
 * content script can resolve chrome-extension:// asset paths without
 * needing chrome.runtime (which is unavailable in MAIN world).
 */
(function () {
    'use strict';

    // Wait for <html> to exist (document_start fires very early)
    function inject() {
        const root = document.documentElement;
        if (!root) { setTimeout(inject, 0); return; }

        const meta = document.createElement('meta');
        meta.name    = 'soravault-ext-base';
        meta.content = chrome.runtime.getURL('');
        root.appendChild(meta);
    }

    inject();
})();
