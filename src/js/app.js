/* LLAMA — Analog Deck MK II
   Rebuilt to the operator wireframe 2026-07-22. Front end only; the
   Web Audio chain is real, the library data is staged demo. Dev-agent
   seams are marked with HOOK: comments.

   Signal chain:
   source → HPF → LPF → 9-band EQ → DRIVE → WOW (tape) →
   [dry + ECHO + SPRING sends] → PAN → MASTER → analyser → out */

"use strict";

const css = getComputedStyle(document.documentElement);
const TOKEN = {
  red: css.getPropertyValue("--red").trim(),
  redBright: css.getPropertyValue("--red-bright").trim(),
  redDeep: css.getPropertyValue("--red-deep").trim(),
  ledBlue: css.getPropertyValue("--led-blue").trim(),
  ledAmber: css.getPropertyValue("--led-amber").trim(),
  ledRed: css.getPropertyValue("--led-red").trim(),
  ledBodyLit: css.getPropertyValue("--led-body-lit").trim(),
  ledCrownLit: css.getPropertyValue("--led-crown-lit").trim(),
  ledDim: css.getPropertyValue("--led-dim").trim(),
  ledRim: css.getPropertyValue("--led-rim").trim(),
  text: css.getPropertyValue("--text").trim(),
  dim: css.getPropertyValue("--dim").trim(),
  panelDeep: css.getPropertyValue("--panel-deep").trim(),
};
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ============ audio engine ============ */
/* HOOK: installer shell swaps <audio>+file input for its file API;
   the node graph below carries over untouched. */
const audioEl = new Audio();
let ctx = null;
let nodes = null;

const EQ_FREQS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function buildGraph() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaElementSource(audioEl);

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass"; hpf.frequency.value = 20; hpf.Q.value = 0.71;
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass"; lpf.frequency.value = 20000; lpf.Q.value = 0.71;

  const eq = EQ_FREQS.map((f) => {
    const b = ctx.createBiquadFilter();
    b.type = "peaking"; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
    return b;
  });

  const drive = ctx.createWaveShaper();
  drive.oversample = "2x";
  setDriveCurve(drive, 0);

  // WOW: short delay wobbled by an LFO; tape flutter in series
  const wow = ctx.createDelay(0.1);
  wow.delayTime.value = 0.02;
  const wowLFO = ctx.createOscillator();
  wowLFO.frequency.value = 2.4;
  const wowDepth = ctx.createGain();
  wowDepth.gain.value = 0;
  wowLFO.connect(wowDepth).connect(wow.delayTime);
  wowLFO.start();

  // ECHO: feedback delay, parallel send
  const echo = ctx.createDelay(1.2);
  echo.delayTime.value = 0.28;
  const echoFB = ctx.createGain(); echoFB.gain.value = 0.3;
  const echoWet = ctx.createGain(); echoWet.gain.value = 0;
  echo.connect(echoFB).connect(echo);

  // SPRING: convolver on a generated decaying-noise impulse, parallel send
  const spring = ctx.createConvolver();
  spring.buffer = makeSpringImpulse(ctx, 1.8);
  const springWet = ctx.createGain(); springWet.gain.value = 0;

  const sum = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const master = ctx.createGain();
  master.gain.value = 0.8;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.78;

  let head = source.connect(hpf);
  head = head.connect(lpf);
  eq.forEach((b) => { head = head.connect(b); });
  head = head.connect(drive).connect(wow);

  wow.connect(sum);                       // dry
  wow.connect(echo); echo.connect(echoWet).connect(sum);
  wow.connect(spring); spring.connect(springWet).connect(sum);

  sum.connect(pan).connect(master);
  master.connect(analyser);
  master.connect(ctx.destination);

  nodes = { hpf, lpf, eq, drive, wow, wowLFO, wowDepth, echo, echoFB, echoWet, spring, springWet, pan, master, analyser };
  ALL_KNOBS.forEach((k) => k.apply(k.value));
}

function setDriveCurve(shaper, amount) {
  const k = amount * 12;
  const n = 512;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = k === 0 ? x : ((1 + k / 10) * x) / (1 + (k / 10) * Math.abs(x));
  }
  shaper.curve = curve;
}

function makeSpringImpulse(c, seconds) {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // boingy early bounce + noise tail, decaying hard
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) *
             (1 + 0.35 * Math.sin(i / 90 + ch * 2));
    }
  }
  return buf;
}

/* ============ knob factory ============ */
const ALL_KNOBS = [];

function makeKnob(row, spec) {
  const unit = document.createElement("div");
  unit.className = "knob-unit";
  unit.innerHTML =
    `<div class="knob" tabindex="0" role="slider" aria-label="${spec.aria || spec.label}"
       aria-valuemin="${spec.min}" aria-valuemax="${spec.max}">
       <div class="knob-pointer"></div>
     </div>
     <span class="knob-label">${spec.label}</span>
     <span class="knob-value"></span>`;
  row.appendChild(unit);

  const el = unit.querySelector(".knob");
  const pointer = unit.querySelector(".knob-pointer");
  const valEl = unit.querySelector(".knob-value");
  spec.default = spec.value;

  function render() {
    const t = (spec.value - spec.min) / (spec.max - spec.min);
    pointer.style.transform = `rotate(${-135 + t * 270}deg)`;
    valEl.textContent = spec.fmt(spec.value);
    el.setAttribute("aria-valuenow", spec.value.toFixed(2));
    el.setAttribute("aria-valuetext", spec.fmt(spec.value));
  }
  function set(v) {
    spec.value = Math.min(spec.max, Math.max(spec.min, v));
    render();
    spec.apply(spec.value);
  }
  spec.set = set;

  let y0 = 0, v0 = 0;
  const span = spec.max - spec.min;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    y0 = e.clientY; v0 = spec.value;
  });
  el.addEventListener("pointermove", (e) => {
    if (el.hasPointerCapture(e.pointerId)) set(v0 + (y0 - e.clientY) * (span / 150));
  });
  el.addEventListener("dblclick", () => set(spec.default));
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    set(spec.value + (e.deltaY < 0 ? 1 : -1) * span / 40);
  }, { passive: false });
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { set(spec.value + span / 40); e.preventDefault(); }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { set(spec.value - span / 40); e.preventDefault(); }
    if (e.key === "Home") { set(spec.default); e.preventDefault(); }
  });
  render();
  ALL_KNOBS.push(spec);
  return spec;
}

function dbFmt(v) { return (v > 0 ? "+" : "") + v.toFixed(0); }
function hzFmt(v) { return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "K" : Math.round(v) + ""; }

/* EQ row: gain per band; these are the "volume on each equalizer" knobs */
const eqRow = document.getElementById("eq-row");
EQ_FREQS.forEach((f, i) => {
  makeKnob(eqRow, {
    label: hzFmt(f), aria: `${hzFmt(f)} hertz band gain`,
    min: -12, max: 12, value: 0, fmt: dbFmt,
    apply: (v) => { if (nodes) nodes.eq[i].gain.value = v; },
  });
});

/* FX row: filters + the fun rack. Log taper on the filter frequencies. */
const fxRow = document.getElementById("fx-row");
makeKnob(fxRow, {
  label: "HI-PASS", min: 0, max: 1, value: 0,
  fmt: (t) => hzFmt(20 * Math.pow(40, t)),              // 20 Hz .. 800 Hz
  apply: (t) => { if (nodes) nodes.hpf.frequency.value = 20 * Math.pow(40, t); },
});
makeKnob(fxRow, {
  label: "LO-PASS", min: 0, max: 1, value: 1,
  fmt: (t) => hzFmt(1000 * Math.pow(20, t)),            // 1 kHz .. 20 kHz
  apply: (t) => { if (nodes) nodes.lpf.frequency.value = 1000 * Math.pow(20, t); },
});
makeKnob(fxRow, {
  label: "DRIVE", min: 0, max: 10, value: 0, fmt: (v) => v.toFixed(1),
  apply: (v) => { if (nodes) setDriveCurve(nodes.drive, v); },
});
makeKnob(fxRow, {
  label: "SPRING", min: 0, max: 100, value: 0, fmt: (v) => Math.round(v) + "%",
  apply: (v) => { if (nodes) nodes.springWet.gain.value = (v / 100) * 0.6; },
});
makeKnob(fxRow, {
  label: "ECHO", min: 0.05, max: 0.6, value: 0.28, fmt: (v) => Math.round(v * 1000) + "ms",
  apply: (v) => { if (nodes) nodes.echo.delayTime.value = v; },
});
makeKnob(fxRow, {
  label: "FEEDB", min: 0, max: 85, value: 0, fmt: (v) => Math.round(v) + "%",
  apply: (v) => {
    if (nodes) {
      nodes.echoFB.gain.value = v / 100;
      nodes.echoWet.gain.value = v > 0 ? 0.5 : 0;
    }
  },
});
makeKnob(fxRow, {
  label: "WOW", min: 0, max: 10, value: 0, fmt: (v) => v.toFixed(1),
  apply: (v) => {
    if (nodes) {
      nodes.wowDepth.gain.value = (v / 10) * 0.006;
      nodes.wowLFO.frequency.value = 1.2 + (v / 10) * 4;
    }
  },
});
makeKnob(fxRow, {
  label: "PAN", min: -1, max: 1, value: 0,
  fmt: (v) => Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100),
  apply: (v) => { if (nodes) nodes.pan.pan.value = v; },
});
makeKnob(fxRow, {
  label: "MASTER", min: 0, max: 100, value: 80, fmt: (v) => Math.round(v) + "%",
  apply: (v) => { if (nodes) nodes.master.gain.value = v / 100; },
});

/* ============ transport ============ */
const fileInput = document.getElementById("file-input");
const seek = document.getElementById("seek");
const tTime = document.getElementById("t-time");
const mastStatus = document.getElementById("mast-status");

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  // single LOAD registers the file in the working set, then plays it
  const entry = {
    path: file.name,
    title: file.name.replace(/\.[^.]+$/, ""),
    artist: "",
    file,
  };
  FILES = FILES.filter((f) => f.path !== entry.path).concat(entry);
  renderRootOptions();
  playEntry(entry.path);
});

document.getElementById("btn-play").addEventListener("click", () => {
  if (!audioEl.src) { fileInput.click(); return; }
  buildGraph();
  ctx.resume();
  audioEl.play();
});
document.getElementById("btn-pause").addEventListener("click", () => audioEl.pause());
document.getElementById("btn-stop").addEventListener("click", () => {
  audioEl.pause();
  audioEl.currentTime = 0;
});

/* repeat: cycles off → one → all, icon only, seated right of the timeline */
const repeatBtn = document.getElementById("btn-repeat");
const REPEAT_ORDER = ["off", "one", "all"];
const REPEAT_LABEL = { off: "Repeat off", one: "Repeat one", all: "Repeat playlist" };
let repeatMode = "off";
repeatBtn.addEventListener("click", () => {
  repeatMode = REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeatMode) + 1) % REPEAT_ORDER.length];
  repeatBtn.dataset.mode = repeatMode;
  repeatBtn.setAttribute("aria-label", REPEAT_LABEL[repeatMode]);
});
audioEl.addEventListener("ended", () => {
  if (repeatMode === "one") {
    audioEl.currentTime = 0;
    audioEl.play();
  } else if (repeatMode === "all") {
    const playable = FILES.filter((f) => f.file || f.native || f.test);
    if (!playable.length) return;
    const i = playable.findIndex((f) => f.path === activePath);
    playEntry(playable[(i + 1) % playable.length].path);
  }
});

function fmtTime(s) {
  if (!isFinite(s)) return "0:00";
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}
audioEl.addEventListener("timeupdate", () => {
  tTime.textContent = fmtTime(audioEl.currentTime) + " / " + fmtTime(audioEl.duration);
  if (audioEl.duration) {
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    seek.value = pct * 10;
    seek.style.setProperty("--seek-fill", pct + "%");
  }
});
seek.addEventListener("input", () => {
  if (audioEl.duration) audioEl.currentTime = (seek.value / 1000) * audioEl.duration;
  seek.style.setProperty("--seek-fill", (seek.value / 10) + "%");
});

/* ============ LED wall ============ */
const ledCanvas = document.getElementById("led-canvas");
const lg = ledCanvas.getContext("2d");
const COLS = 54, ROWS = 14;   // two rows sacrificed 07-22 to buy lens diameter
const RED_ROWS = 2;           // zone map, top down: crimson crown, teal body
const colLevels = new Float32Array(COLS);
const peaks = new Float32Array(COLS);
const freqData = new Uint8Array(1024);
let runningPeak = 0.08;   // rolling loudness ceiling for full-blast normalization

function sizeCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, r.width * devicePixelRatio);
  canvas.height = Math.max(1, r.height * devicePixelRatio);
}
addEventListener("resize", () => { sizeCanvas(ledCanvas); sizeCanvas(vizCanvas); });

function rowColor(row, lit) {
  // row 0 = top; dormant is plain dark gray regardless of zone
  if (!lit) return TOKEN.ledDim;
  return row < RED_ROWS ? TOKEN.ledCrownLit : TOKEN.ledBodyLit;
}

function drawLEDs() {
  const w = ledCanvas.width, h = ledCanvas.height;
  if (!w || !h) return;
  lg.clearRect(0, 0, w, h);

  // pull spectrum: log-spaced bins across 40 Hz .. 16 kHz, then
  // normalize to the rolling peak so the wall runs FULL BLAST at any
  // volume (operator doctrine: we're outside reality; the wall shows
  // what loud looks like, ears handle the truth)
  if (nodes && !audioEl.paused) {
    nodes.analyser.getByteFrequencyData(freqData);
    const nyq = ctx.sampleRate / 2;
    let framePeak = 0;
    const raw = new Float32Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const f0 = 40 * Math.pow(16000 / 40, c / COLS);
      const f1 = 40 * Math.pow(16000 / 40, (c + 1) / COLS);
      const b0 = Math.floor((f0 / nyq) * freqData.length);
      const b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * freqData.length));
      let m = 0;
      for (let b = b0; b < b1 && b < freqData.length; b++) m = Math.max(m, freqData[b]);
      raw[c] = m / 255;
      framePeak = Math.max(framePeak, raw[c]);
    }
    runningPeak = Math.max(framePeak, runningPeak * 0.995, 0.08);
    for (let c = 0; c < COLS; c++) {
      const target = Math.pow(Math.min(1, raw[c] / runningPeak), 0.75);
      colLevels[c] += (target - colLevels[c]) * (target > colLevels[c] ? 0.55 : 0.16);
    }
  } else {
    // stopped: everything cascades down dark
    for (let c = 0; c < COLS; c++) colLevels[c] *= 0.94;
  }

  const gapX = w * 0.003, gapY = h * 0.008;
  const cw = (w - gapX * (COLS + 1)) / COLS;
  const ch = (h - gapY * (ROWS + 1)) / ROWS;
  const dpr = devicePixelRatio;

  for (let c = 0; c < COLS; c++) {
    const litRows = Math.round(colLevels[c] * ROWS);
    peaks[c] = Math.max(peaks[c] - 0.0022 * ROWS / 16, litRows / ROWS);
    const peakRow = ROWS - 1 - Math.round(peaks[c] * (ROWS - 1));

    for (let r = 0; r < ROWS; r++) {
      const lit = (ROWS - r) <= litRows;
      const isPeak = r === peakRow && peaks[c] > 0.05;
      const on = lit || isPeak;
      const color = rowColor(r, on);

      const cx = gapX + c * (cw + gapX) + cw / 2;
      const cy = gapY + r * (ch + gapY) + ch / 2;
      const rad = Math.min(cw, ch) / 2;

      // flat lens, no glow of any kind, dark rim ring per the reference
      lg.fillStyle = color;
      lg.beginPath();
      lg.arc(cx, cy, rad, 0, Math.PI * 2);
      lg.fill();
      lg.lineWidth = Math.max(1, 1.1 * dpr);
      lg.strokeStyle = TOKEN.ledRim;
      lg.beginPath();
      lg.arc(cx, cy, rad, 0, Math.PI * 2);
      lg.stroke();

      // two tiny slivers at 50%: light upper-left, shadow lower-right
      lg.lineCap = "round";
      lg.lineWidth = rad * 0.18;
      lg.strokeStyle = "rgba(255,255,255,0.5)";
      lg.beginPath();
      lg.arc(cx, cy, rad * 0.72, Math.PI * 1.08, Math.PI * 1.42);
      lg.stroke();
      lg.strokeStyle = "rgba(0,0,0,0.5)";
      lg.beginPath();
      lg.arc(cx, cy, rad * 0.72, Math.PI * 0.08, Math.PI * 0.42);
      lg.stroke();
    }
  }
}

/* ============ visualization: one instrument ============ */
/* A sine carrier traveling left to right, torn by a layered noise
   field proportional to the (full-blast normalized) signal. Stopped:
   the disruption cascades away and the line settles to rest. */
const vizCanvas = document.getElementById("viz-canvas");
const vg = vizCanvas.getContext("2d");

function drawViz(now) {
  const w = vizCanvas.width, h = vizCanvas.height;
  if (!w || !h) return;
  vg.fillStyle = "rgba(21, 26, 36, 0.30)";
  vg.fillRect(0, 0, w, h);

  const dpr = devicePixelRatio;
  const energy = colLevels.reduce((a, b) => a + b, 0) / COLS;  // rides the same
  const mid = h / 2;                                           // full-blast levels
  const carrierAmp = h * (0.06 + energy * 0.22);
  const t = now / 1000;

  vg.strokeStyle = TOKEN.ledBodyLit;
  vg.lineWidth = 2 * dpr;
  vg.beginPath();
  const step = Math.max(2, 3 * dpr);
  for (let x = 0; x <= w; x += step) {
    const u = x / w;
    const band = colLevels[Math.min(COLS - 1, Math.floor(u * COLS))];
    // the carrier rides left to right
    let y = mid + Math.sin(u * Math.PI * 6 - t * 2.6) * carrierAmp;
    // disruption: three noise octaves scaled by the local band level
    const noise =
      Math.sin(u * 31.7 + t * 4.1) * 0.5 +
      Math.sin(u * 73.3 - t * 6.7) * 0.3 +
      Math.sin(u * 149.9 + t * 11.3) * 0.2;
    y += noise * band * h * 0.30;
    y += (Math.random() * 2 - 1) * band * h * 0.03;  // fine grit on top
    x === 0 ? vg.moveTo(x, y) : vg.lineTo(x, y);
  }
  vg.stroke();
}

/* ============ file directory: tree + source controls ============ */
/* One FILES array drives the tree, the root selector, and the
   playlist. Demo set ships in; BROWSE swaps in a real folder via the
   directory picker, and real files play on click.
   HOOK: installer shell replaces the picker with its own walker and
   feeds the same {path, title, file} shape. */
const AUDIO_EXT = /\.(mp3|wav|flac|m4a|ogg|aac|opus|wma|aiff?)$/i;

/* LLAMA SOUND TEST — composed by Hans Halloway, 2026-07-22.
   Four movements, 14 s, loopable; synthesized in-app to a real WAV
   and played through the production path.
     I.   Bloom (0-3.0): stacked fifths rise from the sub; the amp
          wakes up. Original figure; no theater trademark chased.
     II.  Collapse (3.0-4.5): pitch sags, phase comb sweeps, drive
          crushes the bloom; the tape saturates.
     III. The Whip (4.5-5.25): dead air, crack, and the llama yelps.
     IV.  The Drop (5.25-12.75): 128 BPM electro house, wobble bass,
          sidechained floor, breaks bars; riser tail (12.75-14)
          folds back into the bloom for a clean loop. */
function makeSoundTestBlob() {
  const sr = 44100, secs = 14, n = Math.floor(sr * secs);
  const data = new Float32Array(n);
  const TAU = Math.PI * 2;
  const beat = 60 / 128;
  const D0 = 5.25;                       // movement IV start
  const PARTIALS = [55, 110, 165, 220, 275, 330, 440, 550];

  function chordAt(t, pf) {              // the bloom chord, pitch-factored
    let s = 0;
    for (let i = 0; i < PARTIALS.length; i++) {
      const on = Math.min(1, Math.max(0, (t - i * 0.16) / 1.1));
      s += Math.sin(TAU * PARTIALS[i] * pf * t) * on * (1 - i * 0.09);
    }
    return s / 4.2;
  }

  // movement IV onset grids (in beats from D0): two floor bars,
  // one breaks bar, one floor bar with a roll out
  const kicksB = [0, 1, 2, 3, 4, 5, 6, 7,
                  8, 8.75, 9.5, 10.75, 11.5,
                  12, 13, 14, 15, 15.25, 15.5, 15.75];
  const kicks = kicksB.map((b) => D0 + b * beat);
  const BASSNOTES = [41.2, 41.2, 49, 55]; // E1 E1 G1 A1, one per bar

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;

    if (t < 4.5) {
      // I + II: bloom, then collapse
      const u = t < 3 ? 0 : (t - 3) / 1.5;               // collapse progress
      const pf = 1 - 0.16 * u;                            // pitch sag
      const swell = t < 3 ? Math.pow(t / 3, 1.4) : 1;
      let c = chordAt(t, pf) * swell;
      if (u > 0) {
        const d = 0.0022 + 0.0016 * Math.sin(TAU * 0.9 * t);   // phase comb
        c = (c + chordAt(t - d, pf)) * 0.6;
        c = Math.tanh(c * (1 + 9 * u)) / (1 + 1.2 * u);        // crush
      }
      s += c * 0.85;
      s += (Math.random() * 2 - 1) * 0.05 * swell * (1 - u);   // air sheen
    } else if (t < D0) {
      // III: 60 ms of designed silence, then the whip and the yelp
      const tw = t - 4.56;
      if (tw > 0) {
        const crack = (Math.random() * 2 - 1) * Math.exp(-tw * 110) *
                      (0.6 + Math.sin(TAU * (2600 * Math.exp(-tw * 30)) * tw) * 0.4);
        s += crack * 1.0;
        const ty = t - 4.72;                                    // the yelp
        if (ty > 0 && ty < 0.45) {
          const f = 680 * Math.exp(-ty * 3.2) + 160;
          const vib = 1 + 0.03 * Math.sin(TAU * 11 * ty);
          s += Math.sin(TAU * f * vib * ty) *
               Math.sin(Math.PI * ty / 0.45) * 0.5;
        }
      }
    } else if (t < 12.75) {
      // IV: the drop
      const td = t - D0;
      const bar = Math.floor(td / (beat * 4));
      let tk = 10;                                              // since last kick
      for (let k = kicks.length - 1; k >= 0; k--) {
        if (kicks[k] <= t) { tk = t - kicks[k]; break; }
      }
      const duck = 1 - 0.6 * Math.exp(-tk * 9);                 // sidechain
      s += Math.sin(TAU * (48 + 92 * Math.exp(-tk * 16)) * tk) *
           Math.exp(-tk * 7.5) * 0.95;                          // kick
      const bf = BASSNOTES[Math.min(3, bar)];
      const wob = 0.5 + 0.5 * Math.sin(TAU * 3.5 * td);         // wobble bass
      const gate = (Math.floor(td / (beat / 2)) % 4 === 3) ? 0.3 : 1;
      let bass = Math.sin(TAU * bf * t) +
                 Math.sin(TAU * bf * 2 * t) * 0.55 * wob +
                 Math.sin(TAU * bf * 3 * t) * 0.30 * wob * wob;
      s += Math.tanh(bass * 1.6) * 0.34 * duck * gate;
      const sn = (td / beat) % 2;                               // snare 2 & 4
      const ts = (sn - 1) * beat;
      if (ts > 0) s += (Math.random() * 2 - 1) * Math.exp(-ts * 28) * 0.5;
      const th = td % (beat / 4);                               // hats
      s += (Math.random() * 2 - 1) * Math.exp(-th * 95) * 0.20 * duck;
    } else {
      // riser tail folds back to the bloom
      const u = (t - 12.75) / 1.25;
      s += (Math.random() * 2 - 1) * u * u * 0.30;
      s += Math.sin(TAU * (180 + 1500 * u * u) * t) * u * 0.18;
    }

    data[i] = Math.tanh(s * 1.15) * 0.92;
  }

  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (off, str) => { for (let j = 0; j < str.length; j++) v.setUint8(off + j, str.charCodeAt(j)); };
  wstr(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}
const TEST_ENTRY = { path: "LLAMA SOUND TEST.wav", artist: "House", title: "LLAMA Sound Test", test: true };
/* All paths are RELATIVE to the set source directory; the app looks
   into one music folder and spreads out from there, never the whole
   machine. Demo models a typical Music folder. */
const DEMO_SET = [
  TEST_ENTRY,
  { path: "Albums/Arc Welder/Sparks EP/01 Ignition.mp3",   artist: "Arc Welder",   title: "Ignition" },
  { path: "Albums/Arc Welder/Sparks EP/02 Blue Flame.mp3", artist: "Arc Welder",   title: "Blue Flame" },
  { path: "Albums/Night Freight/Overnight/01 Diesel Moon.mp3", artist: "Night Freight", title: "Diesel Moon" },
  { path: "Mixes/summer_mix_FINAL(2).mp3",                 artist: "Mixes",        title: "Summer Mix Final 2" },
  { path: "Mixes/road trip 7.mp3",                         artist: "Mixes",        title: "Road Trip 7" },
  { path: "Downloads dump/live_bootleg_1994.flac",         artist: "Bootlegs",     title: "Live 1994" },
  { path: "Downloads dump/wedding_first_dance.mp3",        artist: "Singles",      title: "First Dance" },
  { path: "Voice memos/song idea.m4a",                     artist: "Ideas",        title: "Song Idea" },
  { path: "Voice memos/demo_take2.wav",                    artist: "Ideas",        title: "Demo Take 2" },
  { path: "old backup/keeper.m4a",                         artist: "Singles",      title: "Keeper" },
  { path: "loose_track01.mp3",                             artist: "Unknown Artist", title: "Loose Track 01" },
  { path: "closer_edit.mp3",                               artist: "Singles",      title: "Closer Edit" },
];
let FILES = DEMO_SET;
let activePath = null;

const fileTree = document.getElementById("file-tree");
const playList = document.getElementById("play-list");
const dirRoot = document.getElementById("dir-root");
const dirSourceName = document.getElementById("dir-source-name");
const dirDemoTag = document.getElementById("dir-demo-tag");

function rootsOf(files) {
  // top-level subfolders of the source directory; loose files show under ALL
  return [...new Set(files.filter((f) => f.path.includes("/")).map((f) => f.path.split("/")[0]))].sort();
}

function renderRootOptions() {
  const roots = rootsOf(FILES);
  dirRoot.innerHTML =
    `<option value="">ALL</option>` +
    roots.map((r) => `<option value="${r}">${r}/</option>`).join("");
}

/* nested tree built from slash paths; folders within folders, as found */
function renderTree() {
  const root = {};
  const scope = dirRoot.value
    ? FILES.filter((f) => f.path.split("/")[0] === dirRoot.value)
    : FILES;
  scope.forEach((f) => {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node.dirs = node.dirs || {};
      node = node.dirs[parts[i]] = node.dirs[parts[i]] || {};
    }
    (node.files = node.files || []).push(f);
  });

  const rows = [];
  (function walk(node, depth) {
    Object.keys(node.dirs || {}).sort().forEach((name) => {
      rows.push(`<li class="t-dir" style="padding-left:${6 + depth * 13}px">${name}/</li>`);
      walk(node.dirs[name], depth + 1);
    });
    (node.files || []).sort((a, b) => a.path.localeCompare(b.path)).forEach((f) => {
      const name = f.path.split("/").pop();
      const cls = "t-file" + (f.file || f.test || f.native ? " playable" : "") + (f.path === activePath ? " active" : "");
      rows.push(`<li class="${cls}" style="padding-left:${6 + depth * 13}px" data-path="${f.path}" title="${f.path}">${name}</li>`);
    });
  })(root, 0);
  fileTree.innerHTML = rows.join("") ||
    `<li class="t-file">No audio files in this folder.</li>`;
}

function renderPlaylist() {
  playList.innerHTML = FILES.map((f) => {
    const active = f.path === activePath;
    const cls = (f.file || f.test || f.native ? "playable" : "demo") + (active ? " active" : "");
    const label = f.title + (f.artist ? ` <span class="pl-artist">&middot; ${f.artist}</span>` : "");
    return `<li class="${cls}" data-path="${f.path}" title="${f.file ? f.path : "Demo entry; BROWSE or LOAD to play real files"}">` +
           `${active ? "&#9654; " : ""}${label}</li>`;
  }).join("");
}

let nativeRoot = null;   // set by the shell's directory picker

async function playEntry(path) {
  const f = FILES.find((x) => x.path === path);
  if (!f || (!f.file && !f.test && !f.native)) return;
  if (f.test && !f.file) f.file = makeSoundTestBlob();
  if (f.native && !f.file) {
    const ab = await window.llama.readFile(nativeRoot, f.path);
    f.file = new Blob([ab]);
  }
  if (audioEl.src) URL.revokeObjectURL(audioEl.src);
  audioEl.src = URL.createObjectURL(f.file);
  activePath = f.path;
  mastStatus.textContent = f.title.toUpperCase();
  document.getElementById("viz-title").textContent = f.title.toUpperCase();
  buildGraph();
  ctx.resume();
  audioEl.play();
  renderTree();
  renderPlaylist();
}

fileTree.addEventListener("click", (e) => {
  const li = e.target.closest("li.playable");
  if (li) playEntry(li.dataset.path);
});
playList.addEventListener("click", (e) => {
  const li = e.target.closest("li.playable");
  if (li) playEntry(li.dataset.path);
});
dirRoot.addEventListener("change", renderTree);

/* in the shell, BROWSE goes through the native picker; the hidden
   webkitdirectory input below stays as the web-build fallback */
document.querySelector('label[for="dir-input"]').addEventListener("click", async (e) => {
  if (!window.llama) return;
  e.preventDefault();
  const res = await window.llama.pickDir();
  if (!res || !res.files.length) return;
  nativeRoot = res.root;
  FILES = [TEST_ENTRY].concat(res.files.map((rel) => ({
    path: rel,
    title: rel.split("/").pop().replace(/\.[^.]+$/, ""),
    artist: "",
    native: true,
  })));
  activePath = null;
  dirSourceName.textContent = res.name.toUpperCase();
  dirDemoTag.hidden = true;
  dirRoot.value = "";
  renderRootOptions();
  renderTree();
  renderPlaylist();
});

document.getElementById("dir-input").addEventListener("change", (e) => {
  const picked = [...e.target.files].filter((f) => AUDIO_EXT.test(f.name));
  if (!picked.length) return;
  // paths become relative to the picked folder; the app sees only inside
  // it; the house test signal always rides along
  FILES = [TEST_ENTRY].concat(picked.map((f) => ({
    path: f.webkitRelativePath
      ? f.webkitRelativePath.split("/").slice(1).join("/") || f.name
      : f.name,
    title: f.name.replace(/\.[^.]+$/, ""),
    artist: "",
    file: f,
  })));
  activePath = null;
  const rootName = (picked[0].webkitRelativePath || "").split("/")[0] || "LOCAL FOLDER";
  dirSourceName.textContent = rootName.toUpperCase();
  dirDemoTag.hidden = true;
  dirRoot.value = "";
  renderRootOptions();
  renderTree();
  renderPlaylist();
});

/* ============ resizable seams ============ */
/* drag (or arrow-key) the splitters to size the side panels; widths
   persist locally and are clamped so the board never collapses */
const frameEl = document.querySelector(".frame");
const SEAM_MIN = 150, SEAM_MAX = 460;

function setSeam(varName, px, save) {
  const w = Math.min(SEAM_MAX, Math.max(SEAM_MIN, px));
  frameEl.style.setProperty(varName, w + "px");
  if (save) try { localStorage.setItem("llama" + varName, w); } catch {}
  sizeCanvas(ledCanvas);
  sizeCanvas(vizCanvas);
  return w;
}
function seamWidth(varName, fallback) {
  const saved = parseFloat(localStorage.getItem("llama" + varName));
  return isNaN(saved) ? fallback : saved;
}
setSeam("--left-w", seamWidth("--left-w", 220), false);
setSeam("--right-w", seamWidth("--right-w", 240), false);

function wireSplitter(id, varName, dir) {
  const el = document.getElementById(id);
  let x0 = 0, w0 = 0;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    x0 = e.clientX;
    w0 = parseFloat(getComputedStyle(frameEl).getPropertyValue(varName)) ||
         (varName === "--left-w" ? 220 : 240);
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    setSeam(varName, w0 + (e.clientX - x0) * dir, false);
  });
  el.addEventListener("pointerup", (e) => {
    el.classList.remove("dragging");
    const w = parseFloat(getComputedStyle(frameEl).getPropertyValue(varName));
    setSeam(varName, w, true);
  });
  el.addEventListener("keydown", (e) => {
    const w = parseFloat(getComputedStyle(frameEl).getPropertyValue(varName)) || 220;
    if (e.key === "ArrowLeft") { setSeam(varName, w - 16 * dir, true); e.preventDefault(); }
    if (e.key === "ArrowRight") { setSeam(varName, w + 16 * dir, true); e.preventDefault(); }
  });
}
wireSplitter("split-left", "--left-w", 1);    // seam moves with the mouse
wireSplitter("split-right", "--right-w", -1); // mirrored on the right

/* ============ main loop ============ */
function frame(now) {
  drawLEDs();
  drawViz(now);
  requestAnimationFrame(frame);
}
sizeCanvas(ledCanvas);
sizeCanvas(vizCanvas);
renderRootOptions();
renderTree();
renderPlaylist();
requestAnimationFrame(frame);
