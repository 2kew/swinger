import { analyzeSwing, segmentSwings, METRIC_KEYS } from './swing.js';
import { buildCorrections, buildGhosts } from './corrections.js';
import { drawSkeleton, drawGhostSkeleton, drawTrajectory, drawCorrections } from './overlay.js';
import { buildCoaching, METRIC_INFO, CATEGORY_INFO, scoreLevel, metricValueLabel } from './coach.js';
import { drawRadar, drawTrend, bindChartTip } from './charts.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: store.loadSettings(),
  stream: null,
  recorder: null,
  recChunks: [],
  recTimer: null,
  clips: [],            // [{id, name, url, status, progress, results: [...], …}]
  clipCounter: 0,
  activeSel: null,      // {clipId, idx} — the hit shown in Analysis/Coach
  queueRunning: false,
  trendMetric: 'overall',
  showFixes: true,
};

const RECORD_CAP = { single: 25, range: 170 }; // seconds
const MODE_HINTS = {
  single: 'One swing per clip — recording stops automatically after 25 seconds.',
  range: 'Set the phone down, hit up to ~10 balls, then tap Stop. Every swing in the recording is found and scored automatically (up to 3 minutes).',
};

const RADAR_LABELS = {
  tempo: 'Tempo', shoulderTurn: 'Shoulders', hipTurn: 'Hips', armExtension: 'Lead arm',
  headStability: 'Head', posture: 'Posture', weightShift: 'Shift', finish: 'Finish',
};

const LEVEL_COLORS = {
  good: 'var(--status-good)', warning: 'var(--status-warning)',
  serious: 'var(--status-serious)', critical: 'var(--status-critical)', muted: 'var(--muted)',
};

const getClip = (id) => state.clips.find((c) => c.id === id);

// Every analyzed hit across all clips, flattened for lists and chips.
function allResults() {
  return state.clips
    .filter((c) => c.status === 'done')
    .flatMap((c) => (c.results || []).map((r, idx) => ({ clip: c, idx, r })));
}

function activeEntry() {
  if (!state.activeSel) return null;
  const clip = getClip(state.activeSel.clipId);
  const r = clip?.status === 'done' ? clip.results?.[state.activeSel.idx] : null;
  return r ? { clip, idx: state.activeSel.idx, r } : null;
}

function entryLabel(e) {
  const doneClips = state.clips.filter((c) => c.status === 'done').length;
  if (e.clip.results.length > 1) return doneClips > 1 ? `${e.clip.name} · ${e.r.label}` : e.r.label;
  return e.clip.name;
}

// ---------------- Tabs ----------------

const tabButtons = document.querySelectorAll('.tabbar button');
function showTab(name) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'analysis') renderRadar();
  if (name === 'progress') renderProgress();
}
tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------------- Settings & mode ----------------

$('set-handedness').value = state.settings.handedness;
$('set-view').value = state.settings.view;
for (const [id, key] of [['set-handedness', 'handedness'], ['set-view', 'view']]) {
  $(id).addEventListener('change', (e) => {
    state.settings[key] = e.target.value;
    store.saveSettings(state.settings);
  });
}

function renderModeUI() {
  const mode = state.settings.mode === 'range' ? 'range' : 'single';
  document.querySelectorAll('#mode-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('mode-hint').textContent = MODE_HINTS[mode];
  if (state.recorder?.state !== 'recording') {
    $('btn-record').textContent = mode === 'range' ? '● Record session' : '● Record';
  }
}
$('mode-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn || state.recorder?.state === 'recording') return;
  state.settings.mode = btn.dataset.mode;
  store.saveSettings(state.settings);
  renderModeUI();
});
renderModeUI();

// ---------------- Capture ----------------

const camVideo = $('cam-video');
const camOverlay = $('cam-overlay');

async function startCamera() {
  if (state.stream) return state.stream;
  const facing = state.settings.facing === 'environment' ? 'environment' : 'user';
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  state.stream = stream;
  camVideo.srcObject = stream;
  $('cam-empty').style.display = 'none';
  $('btn-flip').hidden = false;
  // Mirror the preview (and its skeleton) for the selfie camera, like the
  // native camera app. The recorded video itself stays unmirrored.
  camVideo.classList.toggle('mirror', facing === 'user');
  camOverlay.classList.toggle('mirror', facing === 'user');
  startLiveSkeleton();
  return stream;
}

function stopCamera() {
  stopLiveSkeleton();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  camVideo.srcObject = null;
  $('cam-empty').style.display = '';
  $('btn-flip').hidden = true;
}

$('btn-flip').addEventListener('click', async () => {
  if (state.recorder?.state === 'recording') return;
  state.settings.facing = state.settings.facing === 'user' ? 'environment' : 'user';
  store.saveSettings(state.settings);
  stopCamera();
  try {
    await startCamera();
  } catch (err) {
    showError('Camera unavailable', cameraErrorHint(err));
  }
});

// ---- Live wire-mesh skeleton on the camera preview ----

let liveRaf = null;
let liveBusy = false;
let liveDisabled = false;
let lastLiveTs = 0;

function startLiveSkeleton() {
  stopLiveSkeleton();
  let seqStarted = false;
  const loop = async (ts) => {
    liveRaf = requestAnimationFrame(loop);
    if (!state.stream || liveDisabled || liveBusy || camVideo.readyState < 2) return;
    // The pose detector is busy while clips are being analyzed — pause the
    // preview skeleton rather than interleave two sources.
    if (state.queueRunning) {
      camOverlay.getContext('2d').clearRect(0, 0, camOverlay.width, camOverlay.height);
      seqStarted = false;
      return;
    }
    if (ts - lastLiveTs < 66) return; // ~15fps is plenty for framing feedback
    lastLiveTs = ts;
    liveBusy = true;
    try {
      const pose = await import('./pose.js');
      if (!seqStarted) { pose.newSequence(); seqStarted = true; }
      const res = await pose.detectFrame(camVideo, performance.now());
      if (!state.stream) return;
      if (camOverlay.width !== camVideo.videoWidth) {
        camOverlay.width = camVideo.videoWidth || 1280;
        camOverlay.height = camVideo.videoHeight || 720;
      }
      const ctx = camOverlay.getContext('2d');
      ctx.clearRect(0, 0, camOverlay.width, camOverlay.height);
      const lm = res.landmarks?.[0];
      if (lm) drawSkeleton(ctx, lm, camOverlay.width, camOverlay.height);
    } catch (err) {
      // Model unavailable (e.g. offline) — recording still works without it.
      liveDisabled = true;
      console.warn('Live skeleton disabled:', err);
    } finally {
      liveBusy = false;
    }
  };
  liveRaf = requestAnimationFrame(loop);
}

function stopLiveSkeleton() {
  cancelAnimationFrame(liveRaf);
  liveRaf = null;
  camOverlay.getContext('2d').clearRect(0, 0, camOverlay.width, camOverlay.height);
}

function pickMimeType() {
  for (const t of ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

$('btn-record').addEventListener('click', async () => {
  hideError();
  if (state.recorder && state.recorder.state === 'recording') {
    state.recorder.stop();
    return;
  }
  try {
    const stream = await startCamera();
    const mime = pickMimeType();
    state.recChunks = [];
    state.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    state.recorder.ondataavailable = (e) => { if (e.data.size) state.recChunks.push(e.data); };
    state.recorder.onstop = () => {
      setRecordingUI(false);
      stopCamera();
      const blob = new Blob(state.recChunks, { type: state.recorder.mimeType || 'video/webm' });
      if (blob.size > 0) {
        // Recorded clips go to review — the golfer decides to analyze or discard.
        createClip(blob, 'review');
      }
    };
    state.recorder.start();
    setRecordingUI(true);
  } catch (err) {
    showError('Camera unavailable', cameraErrorHint(err));
  }
});

function cameraErrorHint(err) {
  if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return 'Camera permission was denied. Allow camera access in your browser settings — and note the app must be served over HTTPS for the camera to work.';
  }
  return `Could not open the camera (${err?.name || 'unknown error'}). You can still upload a video instead.`;
}

function setRecordingUI(on) {
  const btn = $('btn-record');
  btn.classList.toggle('recording', on);
  btn.classList.toggle('primary', !on);
  $('rec-timer').classList.toggle('on', on);
  $('btn-flip').hidden = on || !state.stream;
  clearInterval(state.recTimer);
  if (on) {
    btn.textContent = '■ Stop';
    const cap = RECORD_CAP[state.settings.mode === 'range' ? 'range' : 'single'];
    const start = Date.now();
    state.recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= cap && state.recorder?.state === 'recording') state.recorder.stop();
    }, 250);
  } else {
    renderModeUI();
  }
}

$('btn-upload').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  hideError();
  // Uploaded files were already deliberately picked — queue them directly.
  for (const f of files) createClip(f, 'queued');
  pumpQueue();
});

// ---------------- Clips ----------------

function createClip(blob, status) {
  const clip = {
    id: `c${++state.clipCounter}`,
    name: `Swing ${state.clipCounter}`,
    time: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    url: URL.createObjectURL(blob),
    settings: { ...state.settings },
    status,               // review | queued | analyzing | done | error
    progress: 0,
    label: status === 'queued' ? 'Waiting…' : '',
    results: null,        // [{label, analysis, coaching, prevOverall}]
    skipped: 0,
    error: null,
    cancelled: false,
  };
  state.clips.push(clip);
  renderClips();
  return clip;
}

function removeClip(id) {
  const clip = getClip(id);
  if (!clip) return;
  clip.cancelled = true; // aborts the job if it's mid-analysis
  if (clip.url) URL.revokeObjectURL(clip.url);
  state.clips = state.clips.filter((c) => c.id !== id);
  if (state.activeSel?.clipId === id) {
    state.activeSel = null;
    const latest = allResults().pop();
    if (latest) state.activeSel = { clipId: latest.clip.id, idx: latest.idx };
    renderAnalysis();
    renderCoach();
  }
  renderClips();
}

const CLIP_STATUS_TEXT = {
  review: 'Ready to review',
  queued: 'Queued',
  analyzing: 'Analyzing…',
  done: 'Analyzed',
  error: 'Failed',
};

function renderClips() {
  const list = $('clip-list');
  $('clips-card').hidden = state.clips.length === 0;
  list.innerHTML = state.clips.map((c) => {
    const statusText = c.status === 'done' && c.results
      ? (c.results.length > 1 ? `${c.results.length} hits` : `Score ${c.results[0].analysis.overall}`)
      : c.status === 'analyzing' ? (c.label || 'Analyzing…')
      : CLIP_STATUS_TEXT[c.status];
    const actions = {
      review: `<button class="btn primary" data-act="analyze">Analyze</button>
               <button class="btn" data-act="discard">Discard</button>`,
      queued: `<button class="btn" data-act="discard">Cancel</button>`,
      analyzing: `<button class="btn" data-act="discard">Cancel</button>`,
      done: `<button class="btn primary" data-act="view">View analysis</button>
             <button class="btn" data-act="discard">Remove</button>`,
      error: `<button class="btn primary" data-act="retry">Retry</button>
              <button class="btn" data-act="discard">Remove</button>`,
    }[c.status];
    return `
      <div class="clip-row" data-id="${c.id}">
        <div class="clip-head">
          <span class="clip-name">${c.name} <span class="badge">${c.settings.view === 'dtl' ? 'DTL' : 'face-on'}</span>
            <span class="fine clip-time">${c.time}</span></span>
          <span class="clip-status ${c.status}">${statusText}</span>
        </div>
        ${c.status === 'review' && c.url ? `<video class="clip-preview" src="${c.url}" controls muted playsinline></video>` : ''}
        ${c.status === 'queued' || c.status === 'analyzing' ? `
          <div class="progress-track"><div class="progress-fill" style="width:${Math.round(c.progress * 100)}%"></div></div>` : ''}
        ${c.status === 'done' && c.skipped ? `<div class="fine">${c.skipped} movement${c.skipped > 1 ? 's' : ''} couldn't be read as a full swing and ${c.skipped > 1 ? 'were' : 'was'} skipped.</div>` : ''}
        ${c.status === 'error' ? `<div class="clip-err">${c.error || 'Analysis failed.'}</div>` : ''}
        <div class="clip-actions">${actions}</div>
      </div>`;
  }).join('');
  renderClipChips(); // keep the Analysis-tab switcher in sync
}

// Patch progress in place so review previews don't reload on every tick.
function updateClipProgress(clip) {
  const row = $('clip-list').querySelector(`[data-id="${clip.id}"]`);
  if (!row) return;
  const fill = row.querySelector('.progress-fill');
  if (fill) fill.style.width = `${Math.round(clip.progress * 100)}%`;
  const status = row.querySelector('.clip-status');
  if (status && clip.status === 'analyzing') status.textContent = clip.label || 'Analyzing…';
}

$('clip-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.clip-row').dataset.id;
  const clip = getClip(id);
  if (!clip) return;
  switch (btn.dataset.act) {
    case 'analyze':
    case 'retry':
      clip.status = 'queued';
      clip.error = null;
      clip.cancelled = false;
      clip.progress = 0;
      clip.label = 'Waiting…';
      renderClips();
      pumpQueue();
      break;
    case 'discard':
      removeClip(id);
      break;
    case 'view':
      selectResult(id, 0);
      showTab('analysis');
      break;
  }
});

// ---------------- Analysis queue ----------------

// One clip at a time — the pose detector is a single shared resource — but
// the UI stays live: record or queue more clips while this runs.
async function pumpQueue() {
  if (state.queueRunning) return;
  state.queueRunning = true;
  try {
    for (;;) {
      const clip = state.clips.find((c) => c.status === 'queued' && !c.cancelled);
      if (!clip) break;
      clip.status = 'analyzing';
      clip.label = 'Loading video…';
      renderClips();
      try {
        await runAnalysisJob(clip);
        clip.status = 'done';
        // Auto-select the fresh result unless the golfer is studying another hit.
        if (!activeEntry()) selectResult(clip.id, 0);
      } catch (err) {
        if (clip.cancelled || !getClip(clip.id)) continue; // removed mid-flight
        clip.status = 'error';
        clip.error = err.friendly ||
          'Something went wrong while analyzing. Check your connection (the pose model downloads on first use) and try again.';
        console.warn('Clip analysis failed:', err);
      }
      renderClips();
    }
  } finally {
    state.queueRunning = false;
  }
}

async function runAnalysisJob(clip) {
  const proc = $('proc-video');
  try {
    await loadVideo(proc, clip.url);
    if ((proc.duration || 0) > 200) {
      throw Object.assign(new Error('too-long'), { friendly: 'That video is over 3 minutes. Keep range sessions under ~3 minutes and try again.' });
    }
    const { extractFrames } = await import('./pose.js');
    const frames = await extractFrames(proc, (frac, label) => {
      if (clip.cancelled) throw Object.assign(new Error('cancelled'), { friendly: 'Cancelled.' });
      clip.progress = frac;
      clip.label = label;
      updateClipProgress(clip);
    }, { maxSeconds: 190 });

    clip.label = 'Finding swings…';
    updateClipProgress(clip);
    const windows = segmentSwings(frames);
    const slices = windows.length ? windows : [frames];

    const results = [];
    let skipped = 0;
    let lastErr = null;
    for (const [i, slice] of slices.entries()) {
      clip.label = `Scoring swing ${i + 1}/${slices.length}…`;
      updateClipProgress(clip);
      const analysis = analyzeSwing(slice, clip.settings);
      if (analysis.error) { skipped++; lastErr = analysis; continue; }
      analysis.corrections = buildCorrections(analysis);
      analysis.ghosts = buildGhosts(analysis, analysis.corrections);
      const sessions = store.listSessions();
      const prevOverall = sessions.length ? sessions[sessions.length - 1].overall : null;
      store.saveSession(analysis);
      results.push({
        label: `Hit ${results.length + 1}`,
        analysis,
        coaching: buildCoaching(analysis),
        prevOverall,
      });
    }
    if (!results.length) {
      throw Object.assign(new Error('no-swings'), {
        friendly: lastErr ? friendlyAnalysisError(lastErr) : 'No full swings were detected in this video.',
      });
    }
    clip.results = results;
    clip.skipped = skipped;
  } finally {
    proc.removeAttribute('src');
  }
}

function friendlyAnalysisError(analysis) {
  return `${analysis.detail} Make sure your whole body is visible for the entire swing, the lighting is decent, and you're the only person in frame.`;
}

function loadVideo(video, url) {
  return new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(Object.assign(new Error('load'), { friendly: 'Could not read that video file — try a different format (MP4 works everywhere).' })); };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('error', onErr);
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('error', onErr);
    video.src = url;
    video.load();
  });
}

function showError(title, detail) {
  $('error-title').textContent = title;
  $('error-detail').textContent = detail;
  $('error-card').hidden = false;
  showTab('record');
}
function hideError() { $('error-card').hidden = true; }

// ---------------- Analysis rendering ----------------

function selectResult(clipId, idx) {
  state.activeSel = { clipId, idx };
  renderAnalysis();
  renderCoach();
}

function renderClipChips() {
  const entries = allResults();
  const chips = $('clip-chips');
  chips.hidden = entries.length < 2;
  chips.innerHTML = entries.map((e) => `
    <button data-clip="${e.clip.id}" data-idx="${e.idx}"
      class="${state.activeSel?.clipId === e.clip.id && state.activeSel?.idx === e.idx ? 'active' : ''}">
      ${entryLabel(e)} · ${e.r.analysis.overall}
    </button>`).join('');
}

$('clip-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-clip]');
  if (btn) selectResult(btn.dataset.clip, +btn.dataset.idx);
});

function renderAnalysis() {
  const entry = activeEntry();
  $('analysis-empty').hidden = !!entry;
  $('analysis-content').hidden = !entry;
  renderClipChips();
  if (!entry) return;
  const { clip, r } = entry;
  const a = r.analysis;

  const hasReplay = !clip.demo && !!a.frames?.length && !!clip.url;
  $('playback-card').hidden = !hasReplay;
  $('view-badge').textContent = a.view === 'dtl' ? 'down-the-line' : 'face-on';

  // Score hero
  $('overall-score').textContent = a.overall;
  const lvl = scoreLevel(a.overall);
  $('overall-level').innerHTML = `<span class="ldot"></span>${lvl.label}`;
  $('overall-level').querySelector('.ldot').style.background = LEVEL_COLORS[lvl.css];
  $('overall-delta').innerHTML = clip.demo
    ? 'Sample swing — record yours to start tracking'
    : r.prevOverall == null
      ? 'First swing on record — your baseline'
      : a.overall === r.prevOverall
        ? 'No change vs last swing'
        : `<span class="${a.overall > r.prevOverall ? 'up' : 'down'}">${a.overall > r.prevOverall ? '▲' : '▼'} ${Math.abs(a.overall - r.prevOverall)}</span> vs last swing (${r.prevOverall})`;

  // Category tiles
  $('cat-grid').innerHTML = Object.entries(CATEGORY_INFO).map(([key, name]) => `
    <div class="cat-tile">
      <div class="cat-name">${name}</div>
      <div class="cat-val">${a.categories[key] ?? '–'}</div>
    </div>`).join('');

  // Metric list (table view of the radar)
  $('metric-list').innerHTML = METRIC_KEYS.map((key) => {
    const info = METRIC_INFO[key];
    const score = a.scores[key];
    const l = scoreLevel(score);
    return `
      <div class="metric-row">
        <span class="swatch" style="background:${info.color}"></span>
        <div>
          <div class="m-name">${info.name}</div>
          <span class="level-pill"><span class="ldot" style="background:${LEVEL_COLORS[l.css]}"></span>${l.label}</span>
        </div>
        <span class="m-val">${metricValueLabel(key, a.metrics)}</span>
        <span class="m-score">${score ?? '–'}</span>
      </div>`;
  }).join('');

  renderRadar();
  if (hasReplay) setupPlayback(clip, r);
}

function renderRadar() {
  const entry = activeEntry();
  const canvas = $('radar-canvas');
  if (!entry || !canvas.clientWidth || $('analysis-content').hidden) return;
  drawRadar(canvas, METRIC_KEYS.map((key) => ({
    key,
    label: RADAR_LABELS[key],
    value: entry.r.analysis.scores[key],
    name: METRIC_INFO[key].name,
  })));
}
bindChartTip($('radar-canvas'), $('radar-tip'), (e) => ({
  title: `${e.name}: ${e.value == null ? 'n/a' : e.value}`,
  sub: e.value == null ? 'Not measurable from this view' : metricValueLabel(e.key, activeEntry().r.analysis.metrics),
}));

// ---------------- Playback + overlay ----------------

const playVideo = $('play-video');
const overlay = $('overlay');
let rafId = null;
let playWindow = { start: 0, end: 0 };

function setupPlayback(clip, r) {
  const phases = r.analysis.phases;
  playWindow = {
    start: Math.max(0, phases.address.t - 0.4),
    end: phases.finish.t + 0.6,
  };

  const begin = () => seekPlayback(playWindow.start);
  if (playVideo.src !== clip.url) {
    playVideo.src = clip.url;
    playVideo.load();
    playVideo.addEventListener('loadedmetadata', () => {
      overlay.width = playVideo.videoWidth || 1280;
      overlay.height = playVideo.videoHeight || 720;
      $('play-shell').classList.toggle('landscape', overlay.width >= overlay.height);
      begin();
    }, { once: true });
  } else {
    begin();
  }

  cancelAnimationFrame(rafId);
  const loop = () => {
    const e = activeEntry();
    if (!e) { rafId = requestAnimationFrame(loop); return; }
    drawOverlay(playVideo.currentTime);
    if (!playVideo.paused) {
      if (playVideo.currentTime >= playWindow.end) playVideo.pause();
      $('scrub').value = scrubValue(playVideo.currentTime);
    }
    updatePlayButton();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// The scrub bar covers only this hit's window, not the whole recording —
// essential for range sessions where one video holds many swings.
function scrubValue(t) {
  const span = Math.max(0.01, playWindow.end - playWindow.start);
  return Math.round(((t - playWindow.start) / span) * 1000);
}

function seekPlayback(t) {
  playVideo.pause();
  playVideo.currentTime = t;
  $('scrub').value = scrubValue(t);
}

$('scrub').addEventListener('input', (e) => {
  playVideo.pause();
  const span = playWindow.end - playWindow.start;
  playVideo.currentTime = playWindow.start + ((+e.target.value) / 1000) * span;
});

$('phase-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const entry = activeEntry();
  if (!btn || !entry) return;
  if (btn.dataset.action === 'fixes') {
    state.showFixes = !state.showFixes;
    btn.classList.toggle('active', state.showFixes);
    btn.textContent = state.showFixes ? '✓ Fixes on' : 'Fixes off';
    drawOverlay(playVideo.currentTime);
    return;
  }
  if (btn.dataset.action === 'play') {
    if (playVideo.paused) {
      if (playVideo.currentTime >= playWindow.end - 0.05 || playVideo.currentTime < playWindow.start) {
        playVideo.currentTime = playWindow.start;
      }
      playVideo.play();
    } else {
      playVideo.pause();
    }
    return;
  }
  const phase = entry.r.analysis.phases[btn.dataset.phase];
  if (phase) seekPlayback(phase.t);
  document.querySelectorAll('#phase-chips button[data-phase]').forEach((b) => b.classList.toggle('active', b === btn));
});

function updatePlayButton() {
  const btn = document.querySelector('#phase-chips button[data-action="play"]');
  if (btn) btn.textContent = playVideo.paused ? '▶ Play' : '❚❚ Pause';
}

function cssColor(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v.replace('var(', '').replace(')', '')).trim();
}

function drawOverlay(t) {
  const entry = activeEntry();
  if (!entry || !entry.r.analysis.frames?.length) return;
  const a = entry.r.analysis;
  const ctx = overlay.getContext('2d');
  const W = overlay.width, H = overlay.height;
  ctx.clearRect(0, 0, W, H);

  // Trajectory up to current time, segmented by phase.
  const segColors = { back: cssColor('var(--s1)'), down: cssColor('var(--s8)'), through: cssColor('var(--s2)') };
  drawTrajectory(ctx, a.trajectory.filter((p) => p.t <= t + 0.02), segColors, W, H);

  // Skeleton for the nearest analyzed frame, then the corrected green ghost
  // and per-fault markers when Fixes is on.
  const frame = nearestFrame(a.frames, t);
  if (frame?.lm) {
    drawSkeleton(ctx, frame.lm, W, H);
    if (state.showFixes) {
      const ghost = (a.ghosts || []).find((g) => Math.abs(g.t - t) < 0.16);
      if (ghost) drawGhostSkeleton(ctx, ghost.lm, W, H);
      drawCorrections(ctx, frame.lm, a.corrections || [], W, H, t);
    }
  }
}

function nearestFrame(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    frames[mid].t < t ? (lo = mid) : (hi = mid);
  }
  return Math.abs(frames[lo].t - t) < Math.abs(frames[hi].t - t) ? frames[lo] : frames[hi];
}

// ---------------- Coach rendering ----------------

function worstMetric(analysis) {
  let worst = null;
  for (const key of METRIC_KEYS) {
    const s = analysis.scores[key];
    if (s != null && (worst == null || s < worst.score)) worst = { key, score: s };
  }
  return worst;
}

function renderCoach() {
  const entries = allResults();
  const entry = activeEntry();

  // Hit list: every analyzed swing, tap to dive into its coaching.
  $('hit-list-card').hidden = entries.length < 2;
  $('hit-list').innerHTML = entries.map((e) => {
    const w = worstMetric(e.r.analysis);
    const active = state.activeSel?.clipId === e.clip.id && state.activeSel?.idx === e.idx;
    return `
      <div class="hit-row ${active ? 'active' : ''}" data-clip="${e.clip.id}" data-idx="${e.idx}">
        <div>
          <div class="h-name">${entryLabel(e)}</div>
          <div class="h-focus">${w ? `Focus: ${METRIC_INFO[w.key].name} (${w.score})` : ''}</div>
        </div>
        <span class="h-score">${e.r.analysis.overall}</span>
        <span class="h-chev">›</span>
      </div>`;
  }).join('');

  $('coach-empty').hidden = !!entry;
  $('coach-content').hidden = !entry;
  if (!entry) return;
  $('coach-title').textContent = entries.length > 1 ? `Coach's read — ${entryLabel(entry)}` : "Coach's read";
  $('btn-replay').hidden = entry.clip.demo || !entry.r.analysis.frames?.length;
  const c = entry.r.coaching;
  $('coach-summary').textContent = c.summary;

  $('coach-items').innerHTML = c.items.map((item) => `
    <div class="coach-item level-${item.level.css}">
      <div class="ci-head">
        <span class="ci-title">${item.name} <span class="badge">${item.valueLabel}</span></span>
        <span class="level-pill"><span class="ldot" style="background:${LEVEL_COLORS[item.level.css]}"></span>${item.score ?? '–'}</span>
      </div>
      <p>${item.analysis}</p>
      <p><strong>Why it matters:</strong> ${item.why}</p>
      ${item.cues?.length ? `<ul class="cues">${item.cues.map((cue) => `<li>${cue}</li>`).join('')}</ul>` : ''}
      ${item.drill ? `<div class="drill"><div class="d-name">🏌️ Drill: ${item.drill.name}</div><div class="d-how">${item.drill.how}</div></div>` : ''}
    </div>`).join('');
}

$('hit-list').addEventListener('click', (e) => {
  const row = e.target.closest('.hit-row');
  if (row) selectResult(row.dataset.clip, +row.dataset.idx);
});

$('btn-replay').addEventListener('click', () => showTab('analysis'));

// ---------------- Progress rendering ----------------

function renderProgress() {
  const sessions = store.listSessions();
  const has = sessions.length > 0;
  $('progress-empty').hidden = has;
  $('progress-content').hidden = !has;
  if (!has) return;

  const chips = [{ key: 'overall', name: 'Overall', color: 'var(--ink)' },
    ...METRIC_KEYS.map((k) => ({ key: k, name: METRIC_INFO[k].name, color: METRIC_INFO[k].color }))];
  $('trend-chips').innerHTML = chips.map((c) => `
    <button data-metric="${c.key}" class="${state.trendMetric === c.key ? 'active' : ''}">
      <span class="cdot" style="background:${c.color}"></span>${c.name}
    </button>`).join('');

  renderTrendChart(sessions);
  renderSessionList(sessions);
}

$('trend-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.trendMetric = btn.dataset.metric;
  renderProgress();
});

function trendValue(session, key) {
  return key === 'overall' ? session.overall : session.scores?.[key];
}

function renderTrendChart(sessions) {
  const key = state.trendMetric;
  const color = key === 'overall'
    ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    : getComputedStyle(document.documentElement).getPropertyValue(`--s${METRIC_INFO[key].slot}`).trim();
  const points = sessions
    .map((s) => ({ label: shortDate(s.date), date: s.date, value: trendValue(s, key) }))
    .filter((p) => p.value != null);
  drawTrend($('trend-canvas'), points, color);
}

bindChartTip($('trend-canvas'), $('trend-tip'), (e) => ({
  title: `${Math.round(e.value)} / 100`,
  sub: new Date(e.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
}));

function renderSessionList(sessions) {
  const rows = [...sessions].reverse().map((s, i, arr) => {
    const prev = arr[i + 1];
    const delta = prev ? s.overall - prev.overall : null;
    return `
      <div class="session-row">
        <span class="s-date">${new Date(s.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          <span class="badge">${s.view === 'dtl' ? 'DTL' : 'face-on'}</span></span>
        <span>
          <span class="s-score">${s.overall}</span>
          <span class="s-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta == null ? '' : delta === 0 ? '=' : `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`}</span>
          <button class="del" data-id="${s.id}" aria-label="Delete session">✕</button>
        </span>
      </div>`;
  }).join('');
  $('session-list').innerHTML = rows;
}

$('session-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button.del');
  if (!btn) return;
  store.deleteSession(btn.dataset.id);
  renderProgress();
});

function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------- Demo ----------------

$('btn-demo').addEventListener('click', () => {
  // A plausible mid-handicap swing; scores match what the engine's bands
  // produce for these exact values.
  const metrics = {
    tempo: 1.9, backswingTime: 0.62, downswingTime: 0.33,
    shoulderTurn: 68, hipTurn: 47, xFactor: 21, finishHipTurn: 60,
    headSway: 0.28, headLift: 0.10, headMove: 0.28,
    spineChange: 5, armExtension: 168, kneeFlex: 162,
    weightShift: -0.05, handsAboveShouldersAtFinish: true,
  };
  const scores = {
    tempo: 73, shoulderTurn: 79, hipTurn: 100, armExtension: 100,
    headStability: 77, posture: 100, weightShift: 74, finish: 88,
  };
  const overall = Math.round(Object.values(scores).reduce((a, b) => a + b) / 8);
  const analysis = {
    view: 'face-on', handedness: state.settings.handedness,
    metrics, scores, overall,
    categories: {
      timing: scores.tempo,
      rotation: Math.round((scores.shoulderTurn + scores.hipTurn) / 2),
      stability: Math.round((scores.headStability + scores.posture) / 2),
      delivery: Math.round((scores.armExtension + scores.weightShift + scores.finish) / 3),
    },
    frames: [], trajectory: [], corrections: [], ghosts: [],
    phases: { address: { t: 0 }, top: { t: 0.72 }, impact: { t: 1.04 }, finish: { t: 1.8 } },
  };
  let demo = state.clips.find((c) => c.demo);
  if (!demo) {
    demo = {
      id: 'demo', demo: true, name: 'Sample swing', time: '',
      url: null, settings: { ...state.settings, view: 'face-on' },
      status: 'done', progress: 1, label: '', skipped: 0,
    };
    state.clips.push(demo);
  }
  demo.results = [{ label: 'Hit 1', analysis, coaching: buildCoaching(analysis), prevOverall: null }];
  renderClips();
  selectResult('demo', 0);
  showTab('analysis');
});

// ---------------- Theme / resize redraw ----------------

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderRadar(); if (!$('progress-content').hidden) renderProgress(); }, 150);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  renderRadar();
  if (!$('progress-content').hidden) renderProgress();
});

renderProgress();
