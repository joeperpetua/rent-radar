const APP_URL = chrome.runtime.getURL('app/index.html');

async function appTabs() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts.filter((c) => c.documentUrl?.startsWith(APP_URL));
}

async function focusTab({ tabId, windowId }) {
  await chrome.tabs.update(tabId, { active: true });
  if (chrome.windows && windowId != null) await chrome.windows.update(windowId, { focused: true });
}

async function openApp(fromTab) {
  const [existing] = await appTabs();
  if (existing) await focusTab(existing);
  else if (fromTab) await chrome.tabs.update(fromTab.id, { url: APP_URL });
  else await chrome.tabs.create({ url: APP_URL });
}

chrome.action.onClicked.addListener(() => openApp());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) openApp();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) return;
  if (message === 'open-app') {
    openApp(sender.tab).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (message !== 'duplicate-app') return;
  appTabs().then(async (tabs) => {
    const other = tabs.find((c) => c.tabId !== sender.tab.id);
    if (!other) return;
    await focusTab(other);
    await chrome.tabs.remove(sender.tab.id);
  });
});
