const { contextBridge } = require('electron');
const { getLoopbackAudioMediaStream } = require('electron-audio-loopback');

contextBridge.exposeInMainWorld('waveAPI', {
  getLoopbackStream: async () => {
    return await getLoopbackAudioMediaStream();
  },
});
