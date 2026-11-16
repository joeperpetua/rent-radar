const APP_URL = chrome.runtime.getURL('app/index.html');
const SHARE = /^[A-Za-z0-9_-]{1,65536}$/;

const appUrl = (share) => (share ? `${APP_URL}#/s/${share}` : APP_URL);

async function appTabs() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    return contexts.filter((c) => c.documentUrl?.startsWith(APP_URL));
  } catch {
    return [];
  }
}

async function focusTab({ tabId, windowId }) {
  await chrome.tabs.update(tabId, { active: true });
  if (chrome.windows && windowId != null) await chrome.windows.update(windowId, { focused: true });
}

async function openApp(fromTab, share = null) {
  const [existing] = await appTabs();
  if (existing) {
    if (share) await chrome.tabs.update(existing.tabId, { url: appUrl(share) });
    await focusTab(existing);
    return;
  }
  if (fromTab) {
    try {
      await chrome.tabs.update(fromTab.id, { url: appUrl(share) });
      return;
    } catch {}
  }
  await chrome.tabs.create({ url: appUrl(share) });
}

chrome.action?.onClicked.addListener(() => openApp());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) openApp();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) return;
  if (message?.type === 'open-app') {
    const share = typeof message.share === 'string' && SHARE.test(message.share) ? message.share : null;
    openApp(sender.tab, share).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (message !== 'duplicate-app') return;
  appTabs().then(async (tabs) => {
    const stale = [...new Set(tabs.map((c) => c.tabId))].filter((id) => id !== sender.tab.id);
    if (stale.length) await chrome.tabs.remove(stale);
    await focusTab({ tabId: sender.tab.id, windowId: sender.tab.windowId });
  });
});
