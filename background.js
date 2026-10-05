chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "CAPTURE_VISIBLE_TAB") {
    const options = { format: "png" };
    const callback = (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "捕获视口失败" });
      } else {
        sendResponse({ dataUrl: dataUrl });
      }
    };

    // 严谨校验 windowId，避免在 V8 中传递 null 触发类型错误
    if (sender.tab && typeof sender.tab.windowId === "number") {
      chrome.tabs.captureVisibleTab(sender.tab.windowId, options, callback);
    } else {
      chrome.tabs.captureVisibleTab(options, callback);
    }
    return true;
  }

  if (message.action === "DOWNLOAD_FILE") {
    try {
      chrome.downloads.download({
        url: message.url,
        filename: message.filename,
        saveAs: true
      }, (downloadId) => {
        sendResponse({ success: !chrome.runtime.lastError, downloadId });
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});