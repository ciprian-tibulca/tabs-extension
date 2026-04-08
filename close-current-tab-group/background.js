chrome.action.onClicked.addListener(async (tab) => {
  if (tab.groupId !== -1) {
    const tabs = await chrome.tabs.query({ groupId: tab.groupId });
    await chrome.tabs.remove(tabs.map((t) => t.id));
  } else {
    await chrome.tabs.remove(tab.id);
  }
});
