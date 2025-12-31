document.addEventListener('DOMContentLoaded', () => {
  const toggleOverlay = document.getElementById('toggle-overlay');
  const offsetInput = document.getElementById('offset-input');
  const statusMsg = document.getElementById('status-msg');

  // Load saved settings
  chrome.storage.sync.get(['enabled', 'offset'], (items) => {
    toggleOverlay.checked = items.enabled !== false; // default true
    offsetInput.value = items.offset || 0;
  });

  // Save changes
  toggleOverlay.addEventListener('change', () => {
    const enabled = toggleOverlay.checked;
    chrome.storage.sync.set({ enabled: enabled }, () => {
      statusMsg.textContent = 'Saved!';
      setTimeout(() => statusMsg.textContent = '', 1000);
      sendMessageToContent({ type: 'UPDATE_SETTINGS', payload: { enabled } });
    });
  });

  offsetInput.addEventListener('change', () => {
    const offset = parseInt(offsetInput.value, 10) || 0;
    chrome.storage.sync.set({ offset: offset }, () => {
      statusMsg.textContent = 'Saved!';
      setTimeout(() => statusMsg.textContent = '', 1000);
      sendMessageToContent({ type: 'UPDATE_SETTINGS', payload: { offset } });
    });
  });

  function sendMessageToContent(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message);
      }
    });
  }
});
