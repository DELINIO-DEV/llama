# LLAMA — Analog Deck

A desktop music player that treats sound like hardware: a real analog-style
board (9-band EQ, high-pass and low-pass filters, drive, spring reverb, echo,
tape wow, pan, master), an LED spectrum wall that always runs full blast, a
signal-driven sine visualizer, and a file directory that reads your music
folder as the nested tree it actually is.

Everything on the board is live. The knobs drive a real Web Audio chain;
nothing is painted on.

## Quick start

    npm install
    npm start

The app opens with a demo library. Click **LLAMA Sound Test** in the playlist
to hear the board immediately, or **BROWSE** to point it at a real music
folder; audio files play on click, from the tree or the playlist.

## Build the Windows installer

    npm run dist

Output: `dist/LLAMA Setup 0.1.0.exe` (NSIS, x64). The installer is unsigned;
Windows SmartScreen will ask for "More info" → "Run anyway" on first launch.

## Regenerate the app icon

The brand source is `src/assets/llama_id.svg`. To re-rasterize the window and
executable icon from it:

    npm run icon

## Layout

    main.js        Electron main process; window + the only file system access
    preload.js     context-isolated bridge (pick directory, read file)
    src/           the front end: UI, Web Audio chain, LED wall, visualizer
    src/assets/    LLAMA logo (SVG master copy) and rasterized icon
    build/         build resources (application icon)
    rasterize.js   one-shot SVG → icon PNG utility

## Controls

- **Knobs:** drag vertically, scroll wheel, or arrow keys; double-click to
  reset; Home returns to default.
- **Transport:** stop, pause, play, LOAD a single file, seek, repeat
  (off → one → all).
- **Seams:** drag the gaps beside the FILE DIRECTORY and PLAYLIST panels to
  resize them; widths are remembered.
