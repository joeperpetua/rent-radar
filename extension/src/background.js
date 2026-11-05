const APP_URL = chrome.runtime.getURL('app/index.html');

async function appTabs() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts.filter((c) => c.documentUrl?.startsWith(APP_URL));
}

async function focusTab({ tabId, windowId }) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}

chrome.action.onClicked.addListener(async () => {
  const [existing] = await appTabs();
  if (existing) await focusTab(existing);
  else await chrome.tabs.create({ url: APP_URL });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message !== 'duplicate-app' || sender.id !== chrome.runtime.id || !sender.tab) return;
  appTabs().then(async (tabs) => {
    const other = tabs.find((c) => c.tabId !== sender.tab.id);
    if (!other) return;
    await focusTab(other);
    await chrome.tabs.remove(sender.tab.id);
  });
});
