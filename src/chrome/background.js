/**
 * SoraVault — background.js  (MV3 Service Worker)
 * Handles chrome.downloads requests relayed from the content script.
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'SV_DOWNLOAD') return false;

    const { url, filename } = msg;

    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
        if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
            sendResponse({ ok: true, downloadId });
        }
    });

    // Return true to keep message channel open for async sendResponse
    return true;
});
