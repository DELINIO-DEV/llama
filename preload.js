/* LLAMA — preload bridge. The renderer gets exactly three verbs. */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("llama", {
  pickDir: () => ipcRenderer.invoke("llama:pickDir"),
  readFile: (root, relPath) => ipcRenderer.invoke("llama:readFile", root, relPath),
});
