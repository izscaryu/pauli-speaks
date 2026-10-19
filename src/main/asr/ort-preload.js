'use strict';
// Loads the ONNX Runtime that ships with onnxruntime-node (onnxruntime.dll, and DirectML.dll for the
// GPU) by its full path, before onnxruntime-node asks Windows for it by name.
//
// Why: Windows 11 keeps an older ONNX Runtime (1.17) in System32. A process started with the
// "prefer System32 images" setting - Firefox passes it on to every program started from its
// downloads, and Windows hands it down to child processes - gets that copy instead of ours, and the
// speech engine aborts ("The requested API version [30] is not available"). A DLL that is already
// loaded is used as it is, so loading ours first by full path settles which one is used.
// Runs in the ASR worker. Pure apart from the `load` it is given, so it is unit tested with fakes.

const path = require('node:path');

/** DirectML first: onnxruntime.dll loads it when the GPU is used. */
const LIBRARIES = ['DirectML.dll', 'onnxruntime.dll'];

/**
 * @param {{indexPath: string, platform: string, arch: string}} o  indexPath: require.resolve('onnxruntime-node')
 * @returns {string[]} full paths to load, in order; none outside Windows
 */
function ortLibraryPaths({ indexPath, platform, arch }) {
  if (platform !== 'win32') return [];
  // Inside the installed app the package lives in app.asar; its native files are in app.asar.unpacked.
  const pkg = path.win32.join(path.win32.dirname(indexPath), '..').replace(/\\app\.asar\\/i, '\\app.asar.unpacked\\');
  const dir = path.win32.join(pkg, 'bin', 'napi-v6', platform, arch);
  return LIBRARIES.map((name) => path.win32.join(dir, name));
}

/**
 * @param {{paths: string[], load: (fullPath: string) => void, onError?: (err: Error, fullPath: string) => void}} o
 * @returns {string[]} the paths that loaded; one that fails is reported and the rest still load
 *   (onnxruntime-node then falls back to Windows' usual search, as before)
 */
function preloadOrtLibraries({ paths, load, onError = () => {} }) {
  const loaded = [];
  for (const p of paths) {
    try {
      load(p);
      loaded.push(p);
    } catch (err) {
      onError(err, p);
    }
  }
  return loaded;
}

module.exports = { ortLibraryPaths, preloadOrtLibraries };
