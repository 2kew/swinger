import { analyzeSwing, METRIC_KEYS } from './swing.js';
import { buildCorrections } from './corrections.js';
import { drawSkeleton, drawTrajectory, drawCorrections } from './overlay.js';
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
  busy: false,
  analysis: null,     // current analysis (with frames) — in-memory only
  videoUrl: null,
  coaching: null,
  isDemo: false,
  trendMetric: 'overall',
  showFixes: true,
};

const RADAR_LABELS = {
  tempo: 'Tempo', shoulderTurn: 'Shoulders', hipTurn: 'Hips', armExtension: 'Lead arm',
  headStability: 'Head', posture: 'Posture', weightShift: 'Shift', finish: 'Finish',
};

const LEVEL_COLORS = {
  good: 'var(--status-good)', warning: 'var(--status-warning)',
  serious: 'var(--status-serious)', critical: 'var(--status-critical)', muted: 'var(--muted)',
};

// ---------------- Tabs ----------------

const tabButtons = document.querySelectorAll('.tabbar button');
function showTab(name) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'analysis') renderRadar();
  if (name === 'progress') renderProgress();
}
tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------------- Settings ----------------

$('set-handedness').value = state.settings.handedness;
$('set-view').value = state.settings.view;
for (const [id, key] of [['set-handedness', 'handedness'], ['set-view', 'view']]) {
  $(id).addEventListener('change', (e) => {
    state.settings[key] = e.target.value;
    store.saveSettings(state.settings);
  });
}

// ---------------- Capture ----------------

const camVideo = $('cam-video');
const camOverlay = $('cam-overlay');

async function startCamera() {
  if (state.stream) return state.stream;
  const facing = state.settings.facing === 'user' ? 'user' : 'environment';
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
  if (state.busy) return;
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
      if (blob.size > 0) analyzeBlob(blob);
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
  btn.textContent = on ? '■ Stop' : '● Record';
  btn.classList.toggle('recording', on);
  btn.classList.toggle('primary', !on);
  $('rec-timer').classList.toggle('on', on);
  $('btn-flip').hidden = on || !state.stream;
  clearInterval(state.recTimer);
  if (on) {
    const start = Date.now();
    state.recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 25 && state.recorder?.state === 'recording') state.recorder.stop();
    }, 250);
  }
}

$('btn-upload').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) { hideError(); analyzeBlob(file); }
});

// ---------------- Analysis pipeline ----------------

async function analyzeBlob(blob) {
  if (state.busy) return;
  stopCamera(); // the analysis loop and live preview can't share the detector
  state.busy = true;
  setProgress(0, 'Loading video…');
  $('progress-wrap').classList.add('on');

  const url = URL.createObjectURL(blob);
  const proc = $('proc-video');

  try {
    await loadVideo(proc, url);
    if ((proc.duration || 0) > 60) {
      throw Object.assign(new Error('too-long'), { friendly: 'That video is over a minute long. Trim it to one swing (a few seconds) and try again.' });
    }
    const { extractFrames } = await import('./pose.js');
    const frames = await extractFrames(proc, setProgress);
    setProgress(1, 'Scoring your swing…');
    const analysis = analyzeSwing(frames, state.settings);
    if (analysis.error) {
      throw Object.assign(new Error(analysis.error), { friendly: friendlyAnalysisError(analysis) });
    }

    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = url;
    state.analysis = analysis;
    analysis.corrections = buildCorrections(analysis);
    state.coaching = buildCoaching(analysis);
    state.isDemo = false;
    store.saveSession(analysis);
    renderAnalysis();
    renderCoach();
    showTab('analysis');
  } catch (err) {
    URL.revokeObjectURL(url);
    showError('Analysis failed', err.friendly ||
      'Something went wrong while analyzing. Check your connection (the pose model downloads on first use) and try again.');
    console.error(err);
  } finally {
    proc.removeAttribute('src');
    state.busy = false;
    $('progress-wrap').classList.remove('on');
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

function setProgress(frac, label) {
  $('progress-fill').style.width = `${Math.round(frac * 100)}%`;
  $('progress-label').textContent = label;
}

function showError(title, detail) {
  $('error-title').textContent = title;
  $('error-detail').textContent = detail;
  $('error-card').hidden = false;
  showTab('record');
}
function hideError() { $('error-card').hidden = true; }

// ---------------- Analysis rendering ----------------

function renderAnalysis() {
  const a = state.analysis;
  $('analysis-empty').hidden = true;
  $('analysis-content').hidden = false;
  $('playback-card').hidden = state.isDemo;
  $('view-badge').textContent = a.view === 'dtl' ? 'down-the-line' : 'face-on';

  // Score hero
  $('overall-score').textContent = a.overall;
  const lvl = scoreLevel(a.overall);
  $('overall-level').innerHTML = `<span class="ldot"></span>${lvl.label}`;
  $('overall-level').querySelector('.ldot').style.background = LEVEL_COLORS[lvl.css];
  const sessions = store.listSessions();
  const prev = state.isDemo ? null : sessions[sessions.length - 2];
  $('overall-delta').innerHTML = prev
    ? (a.overall - prev.overall === 0
        ? 'No change vs last swing'
        : `<span class="${a.overall > prev.overall ? 'up' : 'down'}">${a.overall > prev.overall ? '▲' : '▼'} ${Math.abs(a.overall - prev.overall)}</span> vs last swing (${prev.overall})`)
    : (state.isDemo ? 'Sample swing — record yours to start tracking' : 'First swing on record — your baseline');

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
  if (!state.isDemo) setupPlayback();
}

function renderRadar() {
  const a = state.analysis;
  const canvas = $('radar-canvas');
  if (!a || !canvas.clientWidth || $('analysis-content').hidden) return;
  drawRadar(canvas, METRIC_KEYS.map((key) => ({
    key,
    label: RADAR_LABELS[key],
    value: a.scores[key],
    name: METRIC_INFO[key].name,
  })));
}
bindChartTip($('radar-canvas'), $('radar-tip'), (e) => ({
  title: `${e.name}: ${e.value == null ? 'n/a' : e.value}`,
  sub: e.value == null ? 'Not measurable from this view' : metricValueLabel(e.key, state.analysis.metrics),
}));

// ---------------- Playback + overlay ----------------

const playVideo = $('play-video');
const overlay = $('overlay');
let rafId = null;

function setupPlayback() {
  playVideo.src = state.videoUrl;
  playVideo.load();
  playVideo.addEventListener('loadedmetadata', () => {
    overlay.width = playVideo.videoWidth || 1280;
    overlay.height = playVideo.videoHeight || 720;
    $('play-shell').classList.toggle('landscape', overlay.width >= overlay.height);
    seekPlayback(state.analysis.phases.address.t);
  }, { once: true });

  cancelAnimationFrame(rafId);
  const loop = () => {
    drawOverlay(playVideo.currentTime);
    if (!playVideo.paused) {
      const dur = state.analysis.phases.finish.t + 0.5;
      if (playVideo.currentTime >= dur) playVideo.pause();
      $('scrub').value = Math.round((playVideo.currentTime / (playVideo.duration || 1)) * 1000);
    }
    updatePlayButton();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function seekPlayback(t) {
  playVideo.pause();
  playVideo.currentTime = t;
  $('scrub').value = Math.round((t / (playVideo.duration || 1)) * 1000);
}

$('scrub').addEventListener('input', (e) => {
  playVideo.pause();
  playVideo.currentTime = ((+e.target.value) / 1000) * (playVideo.duration || 0);
});

$('phase-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.action === 'fixes') {
    state.showFixes = !state.showFixes;
    btn.classList.toggle('active', state.showFixes);
    btn.textContent = state.showFixes ? '✓ Fixes on' : 'Fixes off';
    drawOverlay(playVideo.currentTime);
    return;
  }
  if (btn.dataset.action === 'play') {
    if (playVideo.paused) {
      if (playVideo.currentTime >= state.analysis.phases.finish.t + 0.4) {
        playVideo.currentTime = Math.max(0, state.analysis.phases.address.t - 0.3);
      }
      playVideo.play();
    } else {
      playVideo.pause();
    }
    return;
  }
  const phase = state.analysis?.phases[btn.dataset.phase];
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
  const a = state.analysis;
  if (!a) return;
  const ctx = overlay.getContext('2d');
  const W = overlay.width, H = overlay.height;
  ctx.clearRect(0, 0, W, H);

  // Trajectory up to current time, segmented by phase.
  const segColors = { back: cssColor('var(--s1)'), down: cssColor('var(--s8)'), through: cssColor('var(--s2)') };
  drawTrajectory(ctx, a.trajectory.filter((p) => p.t <= t + 0.02), segColors, W, H);

  // Skeleton for the nearest analyzed frame, then any active corrections.
  const frame = nearestFrame(a.frames, t);
  if (frame?.lm) {
    drawSkeleton(ctx, frame.lm, W, H);
    if (state.showFixes) drawCorrections(ctx, frame.lm, a.corrections || [], W, H, t);
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

function renderCoach() {
  const c = state.coaching;
  $('coach-empty').hidden = true;
  $('coach-content').hidden = false;
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
  state.analysis = {
    view: 'face-on', handedness: state.settings.handedness,
    metrics, scores, overall,
    categories: {
      timing: scores.tempo,
      rotation: Math.round((scores.shoulderTurn + scores.hipTurn) / 2),
      stability: Math.round((scores.headStability + scores.posture) / 2),
      delivery: Math.round((scores.armExtension + scores.weightShift + scores.finish) / 3),
    },
    frames: [], trajectory: [], corrections: [],
    phases: { address: { t: 0 }, top: { t: 0.72 }, impact: { t: 1.04 }, finish: { t: 1.8 } },
  };
  state.coaching = buildCoaching(state.analysis);
  state.isDemo = true;
  renderAnalysis();
  renderCoach();
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
  if (state.analysis && !state.isDemo) renderAnalysis();
});

renderProgress();
