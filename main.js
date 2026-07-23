/* LLAMA — Electron main process.
   Owns the window and the file system; the renderer sees only what
   the preload bridge hands it: pick a directory, scan it for audio,
   read one file's bytes. Nothing else crosses. */

"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|ogg|aac|opus|wma|aiff?)$/i;

function createWindow() {
  const win = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#141821",
    icon: path.join(__dirname, "src", "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, "src", "index.html"));
}

/* recursive audio scan, capped for sanity; returns paths relative
   to the chosen root so the renderer's tree logic works unchanged */
async function scanDir(root, rel = "", out = [], depth = 0) {
  if (depth > 12 || out.length >= 5000) return out;
  let entries;
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out; // unreadable folder; skip quietly
  }
  for (const e of entries) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) await scanDir(root, r, out, depth + 1);
    else if (AUDIO_EXT.test(e.name)) out.push(r);
    if (out.length >= 5000) break;
  }
  return out;
}

ipcMain.handle("llama:pickDir", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (res.canceled || !res.filePaths.length) return null;
  const root = res.filePaths[0];
  const files = await scanDir(root);
  return { root, name: path.basename(root), files };
});

ipcMain.handle("llama:readFile", async (_ev, root, relPath) => {
  // resolve inside the chosen root only; no path escapes
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(path.resolve(root))) throw new Error("path escape refused");
  const buf = await fs.readFile(abs);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
