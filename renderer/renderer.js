// ─────────────────────────────────────────────
// Wave — Neon Music Visualizer
// renderer.js
// Uses desktopCapturer via IPC for reliable system audio capture
// ─────────────────────────────────────────────

// BlackHole via getUserMedia — no IPC needed

const canvas = document.getElementById('wave-canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// ── Config ──────────────────────────────────
const CONFIG = {
  FFT_SIZE: 2048,
  SMOOTHING: 0.80,
  WAVE_SEGMENTS: 140,
  GLOW_BLUR_OUTER: 30,
  GLOW_BLUR_INNER: 12,
  LINE_WIDTH_OUTER: 3,
  LINE_WIDTH_INNER: 1.2,
  MAX_RISE: 0.90,           // wave can rise up to 90% of canvas height
  IDLE_AMPLITUDE: 0.06,
  IDLE_SPEED: 0.45,
  COLOR_SPEED: 0.30,
  PARTICLE_COUNT: 24,
};

// ── State ────────────────────────────────────
let analyser = null;
let freqData = null;
let audioCtx = null;
let isConnected = false;
let hueOffset = 195;
let lastTimestamp = 0;
let particles = [];

// ── Canvas sizing ────────────────────────────
function resizeCanvas() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener('resize', () => {
  resizeCanvas();
  particles.forEach(p => p.reset());
});
resizeCanvas();

// ── Particles ────────────────────────────────
class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = Math.random() * window.innerWidth;
    this.y = window.innerHeight + Math.random() * 5;
    this.vy = -(0.4 + Math.random() * 1.4);
    this.vx = (Math.random() - 0.5) * 0.6;
    this.life = 0;
    this.maxLife = 0.45 + Math.random() * 0.55;
    this.size = 0.8 + Math.random() * 1.8;
    this.hue = hueOffset + Math.random() * 80;
  }
  update(energy) {
    this.life += 0.005 + energy * 0.02;
    this.y += this.vy * (1 + energy * 4);
    this.x += this.vx;
    this.hue += 0.5;
    if (this.life > this.maxLife) this.reset();
  }
  draw(ctx, energy) {
    const t = this.life / this.maxLife;
    const alpha = Math.sin(t * Math.PI) * (0.5 + energy * 0.5);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    const h = this.hue % 360;
    ctx.fillStyle = `hsl(${h}, 100%, 72%)`;
    ctx.shadowColor = `hsl(${h}, 100%, 72%)`;
    ctx.shadowBlur = 10 + energy * 14;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * (1 + energy * 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
  const p = new Particle();
  p.life = Math.random() * p.maxLife; // stagger
  particles.push(p);
}

// ── Audio via BlackHole (virtual audio loopback) ─
async function initAudio() {
  showStatus('Looking for BlackHole…');
  try {
    // Step 1: request mic permission so device labels become readable
    const tempStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    tempStream.getTracks().forEach(t => t.stop());

    // Step 2: enumerate and find BlackHole device
    const devices = await navigator.mediaDevices.enumerateDevices();
    const blackhole = devices.find(
      d => d.kind === 'audioinput' && d.label.toLowerCase().includes('blackhole')
    );

    if (blackhole) {
      console.log('[Wave] Found BlackHole device:', blackhole.label);
      showStatus(`Found ${blackhole.label} ✓`);
    } else {
      // Fallback: use default mic input (still shows wave, just from mic)
      console.warn('[Wave] BlackHole not found — using default input');
      showStatus('BlackHole not found — using default audio input');
    }

    // Step 3: open stream from BlackHole (or default)
    const constraints = {
      audio: {
        deviceId: blackhole ? { exact: blackhole.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
      },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Step 4: connect to Web Audio analyser
    audioCtx = new AudioContext({ sampleRate: 48000 });
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = CONFIG.FFT_SIZE;
    analyser.smoothingTimeConstant = CONFIG.SMOOTHING;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    isConnected = true;
    setTimeout(hideStatus, 1500); // show "Found BlackHole ✓" briefly then hide
    console.log('[Wave] ✓ Audio connected via BlackHole');
  } catch (err) {
    console.error('[Wave] Audio error:', err);
    isConnected = false;
    showStatus('⚠️  Microphone permission denied — check System Settings → Privacy');
  }
}

// ── Frequency helpers ────────────────────────
function readFreqData() {
  if (!analyser) return null;
  analyser.getByteFrequencyData(freqData);
  return freqData;
}

function sampleBins(data, count) {
  // Focus on bass + mids (first 60% of bins = most musical energy)
  const maxBin = Math.floor(data.length * 0.60);
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.floor((i / count) * maxBin);
    return data[idx] / 255;
  });
}

function getEnergy(data) {
  // Bass-weighted energy: weight lower bins more heavily
  let sum = 0, total = 0;
  const maxBin = Math.floor(data.length * 0.5);
  for (let i = 0; i < maxBin; i++) {
    const weight = 1 - (i / maxBin) * 0.5;
    sum += data[i] * weight;
    total += 255 * weight;
  }
  return sum / total;
}

// ── Idle wave ────────────────────────────────
function idleBins(timestamp) {
  const t = timestamp * 0.001 * CONFIG.IDLE_SPEED;
  return Array.from({ length: CONFIG.WAVE_SEGMENTS }, (_, i) => {
    const x = i / CONFIG.WAVE_SEGMENTS;
    return CONFIG.IDLE_AMPLITUDE * (
      Math.sin(x * Math.PI * 4 + t) * 0.5 +
      Math.sin(x * Math.PI * 9 + t * 1.5) * 0.3 +
      Math.sin(x * Math.PI * 2 - t * 0.9) * 0.2
    ) + CONFIG.IDLE_AMPLITUDE * 0.5;
  });
}

// ── Drawing ──────────────────────────────────
function drawWave(bins, energy, hue) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const maxRise = H * CONFIG.MAX_RISE;

  // Y origin is screen BOTTOM; wave rises upward by bin value
  const points = bins.map((v, i) => ({
    x: (i / (bins.length - 1)) * W,
    y: H - v * maxRise,
  }));

  // Glow fill: bright at bottom, fades upward
  drawFill(ctx, points, H, hue, energy);

  // Outer wide diffuse glow
  drawSpline(ctx, points, {
    strokeStyle: `hsl(${hue}, 100%, 58%)`,
    lineWidth: CONFIG.LINE_WIDTH_OUTER * 4,
    shadowColor: `hsl(${hue}, 100%, 58%)`,
    shadowBlur: CONFIG.GLOW_BLUR_OUTER * 2.5,
    globalAlpha: 0.14,
  });

  // Main glow line
  drawSpline(ctx, points, {
    strokeStyle: `hsl(${hue}, 100%, 62%)`,
    lineWidth: CONFIG.LINE_WIDTH_OUTER,
    shadowColor: `hsl(${hue}, 100%, 62%)`,
    shadowBlur: CONFIG.GLOW_BLUR_OUTER,
    globalAlpha: 0.95,
  });

  // Bright white-ish core
  drawSpline(ctx, points, {
    strokeStyle: `hsl(${(hue + 40) % 360}, 100%, 92%)`,
    lineWidth: CONFIG.LINE_WIDTH_INNER,
    shadowColor: '#ffffff',
    shadowBlur: CONFIG.GLOW_BLUR_INNER,
    globalAlpha: 0.8,
  });

  // Base glow bar at very bottom edge — the "Dock light" effect
  const baseHue = (hue + 15) % 360;
  ctx.save();
  ctx.globalAlpha = 0.55 + energy * 0.4;
  ctx.strokeStyle = `hsl(${baseHue}, 100%, 65%)`;
  ctx.lineWidth = 2;
  ctx.shadowColor = `hsl(${baseHue}, 100%, 70%)`;
  ctx.shadowBlur = 24 + energy * 30;
  ctx.beginPath();
  ctx.moveTo(0, H - 1);
  ctx.lineTo(W, H - 1);
  ctx.stroke();
  ctx.restore();
}

function drawFill(ctx, points, H, hue, energy) {
  if (points.length < 2) return;
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   `hsla(${hue}, 100%, 65%, 0)`);
  grad.addColorStop(0.4, `hsla(${hue}, 100%, 60%, ${0.03 + energy * 0.08})`);
  grad.addColorStop(1,   `hsla(${hue}, 100%, 65%, ${0.2 + energy * 0.3})`);
  ctx.fillStyle = grad;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(points[0].x, H);
  ctx.lineTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y
    );
  }
  ctx.lineTo(points[points.length - 1].x, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSpline(ctx, points, style) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = style.globalAlpha ?? 1;
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.shadowColor = style.shadowColor;
  ctx.shadowBlur = style.shadowBlur;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y
    );
  }
  ctx.stroke();
  ctx.restore();
}

// ── Auto-Sleep & FPS Config ────────────────────
const FPS = 30;
const FRAME_MIN_TIME = 1000 / FPS;
let silenceTimer = 0;
let isSleeping = false;

// ── Main loop ────────────────────────────────
function draw(timestamp) {
  requestAnimationFrame(draw);

  // 30 FPS Cap
  if (timestamp - lastTimestamp < FRAME_MIN_TIME) {
    return;
  }

  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  let bins, energy;
  if (isConnected && freqData) {
    const data = readFreqData();
    bins = sampleBins(data, CONFIG.WAVE_SEGMENTS);
    energy = getEnergy(data);
  } else {
    bins = idleBins(timestamp);
    energy = CONFIG.IDLE_AMPLITUDE * 0.5;
  }

  // Sleep Logic: If very quiet for 2 seconds, save battery but leave a static glow
  if (energy < 0.01 && isConnected) {
    silenceTimer += dt;
    if (silenceTimer > 2.0) {
      if (!isSleeping) {
        // Draw a static glowing line ONCE, then stop updating the canvas
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        drawWave(idleBins(timestamp), 0, hueOffset);
        isSleeping = true;
      }
      return; // Skip all further drawing. The canvas holds the static image. GPU usage drops to 0%.
    }
  } else {
    silenceTimer = 0;
    isSleeping = false;
  }

  hueOffset = (hueOffset + CONFIG.COLOR_SPEED * dt * 60) % 360;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  particles.forEach(p => {
    p.hue = (hueOffset + Math.random() * 80) % 360;
    p.update(energy);
    p.draw(ctx, energy);
  });

  drawWave(bins, energy, hueOffset);
}

// ── Status helpers ───────────────────────────
function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden');
  statusEl.classList.add('visible');
}
function hideStatus() {
  statusEl.classList.remove('visible');
  setTimeout(() => statusEl.classList.add('hidden'), 600);
}

// ── Boot ─────────────────────────────────────
requestAnimationFrame(draw);
initAudio();
