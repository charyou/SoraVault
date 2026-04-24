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

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.type !== 'SV_EXT_COMMAND' || !msg.id || !msg.command) return;
        if (msg.command !== 'SV_SHOW_DOWNLOADS_FOLDER') return;

        chrome.runtime.sendMessage({ type: msg.command, ...(msg.payload || {}) }, (response) => {
            window.postMessage({
                type: 'SV_EXT_RESPONSE',
                id: msg.id,
                response: response || { ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message },
            }, '*');
        });
    });
})();
