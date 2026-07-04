// Bridge between the game page and the desktop shell. Deliberately tiny:
// the game must keep working with no bridge at all (browser/itch builds).
// Steamworks (achievements, cloud saves) lands here later — issue #46.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__desktop', {
  shell: 'electron',
  version: process.versions.electron,
});
