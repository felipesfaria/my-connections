const statusEl = document.getElementById('status');

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('no tab');
  return chrome.tabs.sendMessage(tab.id, message);
}

async function refreshStatus() {
  try {
    const status = await send({ type: 'status' });
    statusEl.textContent = status?.mounted
      ? `${status.words} words on the board · ${status.guesses} guess${
          status.guesses === 1 ? '' : 'es'
        } recorded.`
      : 'Waiting for the board — start the puzzle first.';
  } catch {
    statusEl.textContent = 'Open nytimes.com/games/connections to use this.';
  }
}

document.getElementById('toggle').addEventListener('click', async () => {
  try {
    await send({ type: 'toggle-panel' });
    window.close();
  } catch {
    refreshStatus();
  }
});

document.getElementById('clear').addEventListener('click', async () => {
  try {
    await send({ type: 'clear-today' });
    refreshStatus();
  } catch {
    refreshStatus();
  }
});

refreshStatus();
