/* one-shot: rasterize src/assets/llama_id.svg → 256px icon PNGs
   (build/icon.png for electron-builder, src/assets/icon.png for the
   dev window). Run: npx electron rasterize.js */

"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  // a file:// page may load file:// images; a data: page may not
  const html = `<html><body style="margin:0;background:transparent">` +
               `<img src="src/assets/llama_id.svg" style="width:256px;height:256px;display:block"></body></html>`;
  const tmpHtml = path.join(__dirname, "_rasterize_tmp.html");
  fs.writeFileSync(tmpHtml, html);
  await win.loadFile(tmpHtml);
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const png = img.toPNG();
  fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "build", "icon.png"), png);
  fs.writeFileSync(path.join(__dirname, "src", "assets", "icon.png"), png);
  fs.unlinkSync(tmpHtml);
  console.log("ICON_WRITTEN", JSON.stringify(img.getSize()), png.length, "bytes");
  app.quit();
});
