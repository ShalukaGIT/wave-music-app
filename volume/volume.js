const { ipcRenderer } = require('electron');

const slider = document.getElementById('vol-slider');
const label = document.getElementById('vol-label');
const muteBtn = document.getElementById('mute-btn');
const iconSound = document.getElementById('icon-sound');
const iconMute = document.getElementById('icon-mute');

// Update UI
function updateUI(vol, muted) {
  // Update slider value & label
  slider.value = vol;
  label.textContent = muted ? 'Muted' : `${vol}%`;

  // Update slider CSS variable for the custom gradient fill
  slider.style.setProperty('--val', `${vol}%`);

  // Update mute button state
  if (muted || vol === 0) {
    muteBtn.classList.add('muted');
    iconSound.style.display = 'none';
    iconMute.style.display = 'block';
  } else {
    muteBtn.classList.remove('muted');
    iconSound.style.display = 'block';
    iconMute.style.display = 'none';
  }
}

// Fetch initial state
async function initState() {
  const state = await ipcRenderer.invoke('get-volume-state');
  updateUI(state.volume, state.muted);
}

// Event listeners
slider.addEventListener('input', (e) => {
  const vol = parseInt(e.target.value);
  ipcRenderer.invoke('set-volume', vol);
  // Assume unmuted if they move the slider
  updateUI(vol, false);
});

muteBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('toggle-mute');
  // Re-fetch state to be accurate
  const state = await ipcRenderer.invoke('get-volume-state');
  updateUI(state.volume, state.muted);
});

// Update periodically in case volume changed externally (e.g. keyboard keys)
setInterval(async () => {
  const state = await ipcRenderer.invoke('get-volume-state');
  updateUI(state.volume, state.muted);
}, 1000);

// Run initial fetch
initState();
