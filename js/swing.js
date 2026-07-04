// Swing analysis engine — pure functions over per-frame pose landmarks.
// frames: [{ t (seconds), lm (33 normalized image landmarks), wlm (33 world landmarks, meters) }]

export const LM = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
};

// Skeleton segments drawn on the overlay.
export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

const KEY_POINTS = [11, 12, 15, 16, 23, 24];

export const METRIC_KEYS = [
  'tempo', 'shoulderTurn', 'hipTurn', 'armExtension',
  'headStability', 'posture', 'weightShift', 'finish',
];

const deg = (rad) => (rad * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
}

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function smooth(arr, w = 5) {
  const half = Math.floor(w / 2);
  return arr.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j]; n++;
    }
    return sum / n;
  });
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function normAngle(a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

// Angle of the line a→b in the horizontal (x,z) world plane, degrees.
function yawAngle(wlm, ai, bi) {
  const a = wlm[ai], b = wlm[bi];
  return deg(Math.atan2(b.z - a.z, b.x - a.x));
}

// Interior angle at joint b for the chain a-b-c, in 3D world space.
function jointAngle(wlm, ai, bi, ci) {
  const a = wlm[ai], b = wlm[bi], c = wlm[ci];
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const m1 = Math.hypot(v1.x, v1.y, v1.z);
  const m2 = Math.hypot(v2.x, v2.y, v2.z);
  if (m1 === 0 || m2 === 0) return null;
  return deg(Math.acos(clamp(dot / (m1 * m2), -1, 1)));
}

// 3D angle between torso vectors (hip-mid → shoulder-mid) of two frames.
function torsoTiltChange(wlmA, wlmB) {
  const va = vecSub(mid(wlmA[LM.lShoulder], wlmA[LM.rShoulder]), mid(wlmA[LM.lHip], wlmA[LM.rHip]));
  const vb = vecSub(mid(wlmB[LM.lShoulder], wlmB[LM.rShoulder]), mid(wlmB[LM.lHip], wlmB[LM.rHip]));
  const dot = va.x * vb.x + va.y * vb.y + va.z * vb.z;
  const m = Math.hypot(va.x, va.y, va.z) * Math.hypot(vb.x, vb.y, vb.z);
  if (m === 0) return null;
  return deg(Math.acos(clamp(dot / m, -1, 1)));
}

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function frameVisible(f) {
  if (!f.lm || !f.wlm) return false;
  let sum = 0;
  for (const i of KEY_POINTS) sum += f.lm[i].visibility ?? 1;
  return sum / KEY_POINTS.length > 0.4;
}

// Score 100 inside [ideal0, ideal1], falling linearly to 60 at the accept
// bounds and on toward a floor of 5 beyond them.
export function bandScore(v, ideal0, ideal1, accept0, accept1) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= ideal0 && v <= ideal1) return 100;
  const span = v < ideal0 ? (ideal0 - accept0) : (accept1 - ideal1);
  const over = v < ideal0 ? (ideal0 - v) : (v - ideal1);
  const d = span > 0 ? over / span : 2;
  if (d <= 1) return Math.round(100 - 40 * d);
  return Math.round(clamp(60 - 30 * (d - 1), 5, 60));
}

export function analyzeSwing(rawFrames, opts = {}) {
  const handedness = opts.handedness === 'left' ? 'left' : 'right';
  const view = opts.view === 'dtl' ? 'dtl' : 'face-on';

  const frames = rawFrames.filter(frameVisible);
  if (frames.length < 20) {
    return { error: 'not-enough-pose', detail: 'Too few frames with a clearly visible body.' };
  }
  if (frames.length / rawFrames.length < 0.5) {
    return { error: 'not-enough-pose', detail: 'The body was hidden or out of frame for most of the video.' };
  }

  // Hands midpoint path in image space. Light smoothing only — heavier
  // windows shift the detected top/impact and skew the tempo ratio.
  const handsX = smooth(frames.map((f) => mid(f.lm[LM.lWrist], f.lm[LM.rWrist]).x), 3);
  const handsY = smooth(frames.map((f) => mid(f.lm[LM.lWrist], f.lm[LM.rWrist]).y), 3);
  const times = frames.map((f) => f.t);

  const speed = frames.map((_, i) => {
    if (i === 0) return 0;
    const dt = Math.max(1e-3, times[i] - times[i - 1]);
    return Math.hypot(handsX[i] - handsX[i - 1], handsY[i] - handsY[i - 1]) / dt;
  });
  const speedS = smooth(speed, 3);
  const p95 = percentile(speedS, 0.95);
  if (p95 < 0.15) {
    return { error: 'no-swing', detail: 'No swing motion detected — the hands barely moved.' };
  }
  const moveThresh = Math.max(0.05, 0.18 * p95);

  // Address: last quiet moment before sustained motion begins.
  let addressIdx = -1;
  for (let i = 1; i < frames.length - 3; i++) {
    if (speedS[i] > moveThresh && speedS[i + 1] > moveThresh && speedS[i + 2] > moveThresh) {
      addressIdx = Math.max(0, i - 3);
      break;
    }
  }
  if (addressIdx < 0) return { error: 'no-swing', detail: 'Could not find the start of the swing.' };

  // Peak hand speed after address — lands at/near impact for a full swing.
  let peakIdx = addressIdx + 1;
  for (let i = addressIdx + 1; i < frames.length; i++) {
    if (speedS[i] > speedS[peakIdx]) peakIdx = i;
  }

  // Top of backswing: highest hands (min image y) between address and peak speed.
  let topIdx = addressIdx;
  for (let i = addressIdx; i <= peakIdx; i++) {
    if (handsY[i] < handsY[topIdx]) topIdx = i;
  }
  const yAddr = handsY[addressIdx];
  const yTop = handsY[topIdx];
  if (topIdx <= addressIdx + 2 || yAddr - yTop < 0.04) {
    return { error: 'no-swing', detail: 'Could not detect a backswing — make sure the full swing is in the video.' };
  }

  // Impact: hands bottom out at/just past the ball before rising into the
  // follow-through. They linger near the bottom, so take the FIRST frame
  // that comes within epsilon of the eventual low point, not the argmax —
  // otherwise the downswing measures long and the tempo ratio reads low.
  let bottomIdx = topIdx + 1;
  for (let i = topIdx + 1; i < frames.length && times[i] - times[topIdx] < 1.5; i++) {
    if (handsY[i] > handsY[bottomIdx]) bottomIdx = i;
  }
  let impactIdx = topIdx + 1;
  while (impactIdx < bottomIdx && handsY[impactIdx] < handsY[bottomIdx] - 0.015) impactIdx++;
  if (impactIdx <= topIdx + 1 || handsY[impactIdx] - yTop < 0.6 * (yAddr - yTop)) {
    return { error: 'no-swing', detail: 'Could not detect the downswing and impact.' };
  }

  // Finish: first calm stretch after impact, else the last frame.
  let finishIdx = frames.length - 1;
  for (let i = impactIdx + 3; i < frames.length - 2; i++) {
    if (times[i] - times[impactIdx] > 0.25 &&
        speedS[i] < 0.15 * p95 && speedS[i + 1] < 0.15 * p95 && speedS[i + 2] < 0.15 * p95) {
      finishIdx = i;
      break;
    }
  }

  const A = frames[addressIdx], T = frames[topIdx], I = frames[impactIdx], F = frames[finishIdx];
  const lead = handedness === 'right'
    ? { shoulder: LM.lShoulder, elbow: LM.lElbow, wrist: LM.lWrist, ankle: LM.lAnkle }
    : { shoulder: LM.rShoulder, elbow: LM.rElbow, wrist: LM.rWrist, ankle: LM.rAnkle };
  const trailAnkle = handedness === 'right' ? LM.rAnkle : LM.lAnkle;

  // --- Raw metrics ---
  const backswingTime = times[topIdx] - times[addressIdx];
  const downswingTime = Math.max(1e-3, times[impactIdx] - times[topIdx]);
  const tempo = backswingTime / downswingTime;

  const shoulderAt = (f) => normAngle(yawAngle(f.wlm, LM.lShoulder, LM.rShoulder) - yawAngle(A.wlm, LM.lShoulder, LM.rShoulder));
  const hipAt = (f) => normAngle(yawAngle(f.wlm, LM.lHip, LM.rHip) - yawAngle(A.wlm, LM.lHip, LM.rHip));

  const shoulderTurn = Math.abs(shoulderAt(T));
  const hipTurn = Math.abs(hipAt(T));
  const xFactor = shoulderTurn - hipTurn;
  const finishHipTurn = Math.abs(hipAt(F));

  // Head movement between address and impact, in torso lengths.
  const torsoLen = Math.max(1e-3, dist2d(
    mid(A.lm[LM.lShoulder], A.lm[LM.rShoulder]),
    mid(A.lm[LM.lHip], A.lm[LM.rHip])
  ));
  let headSway = 0, headLift = 0;
  const nose0 = A.lm[LM.nose];
  for (let i = addressIdx; i <= impactIdx; i++) {
    headSway = Math.max(headSway, Math.abs(frames[i].lm[LM.nose].x - nose0.x) / torsoLen);
    headLift = Math.max(headLift, Math.abs(frames[i].lm[LM.nose].y - nose0.y) / torsoLen);
  }
  const headMove = Math.max(headSway, headLift);

  const spineChange = torsoTiltChange(A.wlm, I.wlm);
  const armExtension = jointAngle(T.wlm, lead.shoulder, lead.elbow, lead.wrist);
  const kneeFlex = ((jointAngle(A.wlm, LM.lHip, LM.lKnee, LM.lAnkle) ?? 160)
    + (jointAngle(A.wlm, LM.rHip, LM.rKnee, LM.rAnkle) ?? 160)) / 2;

  // Weight shift (face-on only): hip-center travel toward the target by
  // impact, as a fraction of stance width.
  let weightShift = null;
  if (view === 'face-on') {
    const stance = A.lm[lead.ankle].x - A.lm[trailAnkle].x;
    if (Math.abs(stance) > 0.04) {
      // Dividing by the signed stance width makes positive = toward the
      // target regardless of which way the golfer faces the camera.
      const hipX = (f) => mid(f.lm[LM.lHip], f.lm[LM.rHip]).x;
      weightShift = (hipX(I) - hipX(A)) / stance;
    }
  }

  const handsAboveShouldersAtFinish =
    mid(F.lm[LM.lWrist], F.lm[LM.rWrist]).y < mid(F.lm[LM.lShoulder], F.lm[LM.rShoulder]).y + 0.02;

  const metrics = {
    tempo, backswingTime, downswingTime,
    shoulderTurn, hipTurn, xFactor, finishHipTurn,
    headSway, headLift, headMove,
    spineChange, armExtension, kneeFlex,
    weightShift, handsAboveShouldersAtFinish,
  };

  // --- Scores (0–100 per metric) ---
  const spineScore = bandScore(spineChange, 0, 6, 0, 18);
  const kneeScore = bandScore(kneeFlex, 148, 170, 132, 179);
  const finishRotScore = bandScore(finishHipTurn, 75, 130, 40, 160);

  const scores = {
    tempo: bandScore(tempo, 2.5, 3.5, 1.6, 5.0),
    shoulderTurn: bandScore(shoulderTurn, 82, 112, 55, 135),
    hipTurn: bandScore(hipTurn, 36, 58, 18, 80),
    armExtension: bandScore(armExtension, 158, 180, 125, 180),
    headStability: bandScore(headMove, 0, 0.14, 0, 0.38),
    posture: spineScore == null && kneeScore == null ? null
      : Math.round(((spineScore ?? kneeScore) + (kneeScore ?? spineScore)) / 2),
    weightShift: weightShift == null ? null : bandScore(weightShift, 0.08, 0.42, -0.12, 0.65),
    finish: finishRotScore == null ? null
      : Math.round(0.7 * finishRotScore + 0.3 * (handsAboveShouldersAtFinish ? 100 : 55)),
  };

  const valid = METRIC_KEYS.map((k) => scores[k]).filter((s) => s != null);
  const overall = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);

  const categories = {
    timing: avg([scores.tempo]),
    rotation: avg([scores.shoulderTurn, scores.hipTurn]),
    stability: avg([scores.headStability, scores.posture]),
    delivery: avg([scores.armExtension, scores.weightShift, scores.finish]),
  };

  // Hand trajectory for the overlay, segmented by phase.
  const trajectory = frames.map((f, i) => ({
    t: f.t,
    x: mid(f.lm[LM.lWrist], f.lm[LM.rWrist]).x,
    y: mid(f.lm[LM.lWrist], f.lm[LM.rWrist]).y,
    seg: i <= topIdx ? 'back' : i <= impactIdx ? 'down' : 'through',
  })).filter((_, i) => i >= addressIdx && i <= finishIdx);

  return {
    handedness, view,
    frames,
    phases: {
      address: { idx: addressIdx, t: times[addressIdx] },
      top: { idx: topIdx, t: times[topIdx] },
      impact: { idx: impactIdx, t: times[impactIdx] },
      finish: { idx: finishIdx, t: times[finishIdx] },
    },
    metrics, scores, overall, categories, trajectory,
  };
}

function avg(list) {
  const v = list.filter((s) => s != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
