const apiKeyInput = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');

// Load saved key when the page loads
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['openRouterApiKey'], (result) => {
    if (result.openRouterApiKey) {
      apiKeyInput.value = result.openRouterApiKey;
    }
  });
});

// Save the key
saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  if (apiKey) {
    chrome.storage.local.set({ openRouterApiKey: apiKey }, () => {
      statusDiv.textContent = 'API Key 已保存！';
      setTimeout(() => { statusDiv.textContent = ''; }, 3000);
    });
  } else {
    statusDiv.textContent = '请输入有效的 API Key。';
    statusDiv.style.color = 'red';
     setTimeout(() => { 
        statusDiv.textContent = '';
        statusDiv.style.color = '#28a745';
    }, 3000);
  }
});