// Visual corrections — for each detected fault, compute where the body part
// SHOULD be at that moment, in normalized image coordinates, so the overlay
// can draw the faulty segment in red and the corrected ("ghost") position in
// green next to it.
//
// Each correction: {
//   t            — video time it applies to (drawn when playback is near t),
//   label        — short on-video instruction,
//   anchor       — {x,y} where the label sits,
//   lines        — [[p1,p2], …] corrected segments (drawn dashed),
//   arrows       — [{from,to}] movement hints (current → target),
//   marks        — [{x,y,r}] target position circles,
//   badSegments  — [[i,j], …] skeleton connections to tint as faulty,
//   badPoints    — [i, …] landmarks to tint as faulty,
// }

import { LM } from './swing.js';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const norm = (v) => { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; };

export function buildCorrections(analysis) {
  const out = [];
  const { frames, phases, metrics, scores, handedness } = analysis;
  if (!frames?.length || phases?.address?.idx == null) return out;

  const F = (p) => frames[phases[p].idx].lm;
  const left = handedness === 'left';
  const lead = left
    ? { sh: LM.rShoulder, el: LM.rElbow, wr: LM.rWrist, ankle: LM.rAnkle }
    : { sh: LM.lShoulder, el: LM.lElbow, wr: LM.lWrist, ankle: LM.lAnkle };
  const trailAnkle = left ? LM.lAnkle : LM.rAnkle;

  const A = F('address');
  const torsoLen = Math.max(0.02, dist(mid(A[LM.lShoulder], A[LM.rShoulder]), mid(A[LM.lHip], A[LM.rHip])));

  // 1. Bent lead arm at the top → straighten it: keep both bone lengths,
  // lay elbow and wrist on the shoulder→wrist line.
  if (scores.armExtension != null && scores.armExtension < 80) {
    const f = F('top');
    const S = f[lead.sh], E = f[lead.el], W = f[lead.wr];
    const upper = dist(S, E), fore = dist(E, W);
    const d = norm(sub(W, S));
    const elbow2 = add(S, mul(d, upper));
    const wrist2 = add(S, mul(d, upper + fore));
    out.push({
      kind: 'arm',
      t: phases.top.t,
      label: 'Straighten lead arm',
      anchor: wrist2,
      lines: [[S, elbow2], [elbow2, wrist2]],
      arrows: [{ from: E, to: elbow2 }],
      badSegments: [[lead.sh, lead.el], [lead.el, lead.wr]],
    });
  }

  // 2. Head drift → target ring at the address head position, arrow from
  // where the head actually is. Shown at whichever checkpoint drifted most.
  if (scores.headStability != null && scores.headStability < 80) {
    const target = A[LM.nose];
    const at = ['top', 'impact']
      .map((p) => ({ p, nose: F(p)[LM.nose] }))
      .sort((a, b) => dist(b.nose, target) - dist(a.nose, target))[0];
    if (dist(at.nose, target) > 0.015) {
      out.push({
        kind: 'head',
        t: phases[at.p].t,
        label: 'Keep your head here',
        anchor: { x: target.x, y: target.y - 0.35 * torsoLen },
        marks: [{ x: target.x, y: target.y, r: 0.28 * torsoLen }],
        arrows: [{ from: at.nose, to: target }],
        badPoints: [LM.nose],
      });
    }
  }

  // 3. Early extension → corrected torso line at impact: same torso length,
  // rotated back to the address inclination.
  if (metrics.spineChange != null && metrics.spineChange > 7) {
    const fi = F('impact');
    const hip = mid(fi[LM.lHip], fi[LM.rHip]);
    const sho = mid(fi[LM.lShoulder], fi[LM.rShoulder]);
    const hipA = mid(A[LM.lHip], A[LM.rHip]);
    const shoA = mid(A[LM.lShoulder], A[LM.rShoulder]);
    const angA = Math.atan2(shoA.y - hipA.y, shoA.x - hipA.x);
    const len = dist(hip, sho);
    const target = { x: hip.x + Math.cos(angA) * len, y: hip.y + Math.sin(angA) * len };
    if (dist(sho, target) > 0.02) {
      out.push({
        kind: 'spine',
        t: phases.impact.t,
        label: 'Hold your spine angle',
        anchor: target,
        lines: [[hip, target]],
        arrows: [{ from: sho, to: target }],
        badSegments: [[LM.lShoulder, LM.lHip], [LM.rShoulder, LM.rHip]],
      });
    }
  }

  // 4. Weight shift at impact → target hip position along the stance line.
  if (scores.weightShift != null && scores.weightShift < 80 && metrics.weightShift != null) {
    const fi = F('impact');
    const stance = A[lead.ankle].x - A[trailAnkle].x; // signed: + is toward target
    const hipA = mid(A[LM.lHip], A[LM.rHip]);
    const hipI = mid(fi[LM.lHip], fi[LM.rHip]);
    const target = { x: hipA.x + 0.25 * stance, y: hipI.y };
    const hangingBack = metrics.weightShift < 0.08;
    if (Math.abs(target.x - hipI.x) > 0.012) {
      out.push({
        kind: 'hips',
        t: phases.impact.t,
        label: hangingBack ? 'Shift hips toward target' : "Post up — don't slide",
        anchor: { x: target.x, y: target.y - 0.55 * torsoLen },
        marks: [{ x: target.x, y: target.y, r: 0.14 * torsoLen }],
        arrows: [{ from: hipI, to: target }],
        badSegments: [[LM.lHip, LM.rHip]],
      });
    }
  }

  return out;
}

// Build a full corrected "ghost" pose for each moment that has corrections:
// the actual frame's landmarks with the fixes applied (hips shifted, spine
// re-tilted, lead arm straightened), so the overlay can draw a complete
// green skeleton showing the improved position.
export function buildGhosts(analysis, corrections) {
  const { frames, phases, handedness } = analysis;
  if (!frames?.length || !corrections?.length) return [];

  const left = handedness === 'left';
  const lead = left ? { el: LM.rElbow, wr: LM.rWrist } : { el: LM.lElbow, wr: LM.lWrist };
  const ARMS = [LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist];

  const byTime = new Map();
  for (const c of corrections) {
    if (!byTime.has(c.t)) byTime.set(c.t, []);
    byTime.get(c.t).push(c);
  }

  const ghosts = [];
  for (const [t, list] of byTime) {
    // The ghost pose only differs for body-position fixes.
    if (!list.some((c) => c.kind === 'arm' || c.kind === 'spine' || c.kind === 'hips')) continue;
    const phase = Object.values(phases).find((p) => p.t === t);
    if (phase?.idx == null) continue;
    const lm = frames[phase.idx].lm.map((p) => ({ ...p }));

    for (const c of list) {
      if (c.kind === 'hips') {
        // Post onto the lead side: hips fully to the target, torso follows.
        const dx = c.arrows[0].to.x - c.arrows[0].from.x;
        for (const i of [LM.lHip, LM.rHip]) lm[i].x += dx;
        for (const i of [LM.lShoulder, LM.rShoulder, ...ARMS]) lm[i].x += dx * 0.5;
      }
      if (c.kind === 'spine') {
        // Rotate the shoulders about the hip center back to the address tilt.
        const hip = mid(lm[LM.lHip], lm[LM.rHip]);
        const sho = mid(lm[LM.lShoulder], lm[LM.rShoulder]);
        const target = c.arrows[0].to;
        const delta = Math.atan2(target.y - hip.y, target.x - hip.x)
          - Math.atan2(sho.y - hip.y, sho.x - hip.x);
        const cos = Math.cos(delta), sin = Math.sin(delta);
        for (const i of [LM.lShoulder, LM.rShoulder]) {
          const before = { ...lm[i] };
          const vx = lm[i].x - hip.x, vy = lm[i].y - hip.y;
          lm[i].x = hip.x + vx * cos - vy * sin;
          lm[i].y = hip.y + vx * sin + vy * cos;
          // Arms hang from the shoulders — carry them along.
          const armIdx = i === LM.lShoulder ? [LM.lElbow, LM.lWrist] : [LM.rElbow, LM.rWrist];
          for (const j of armIdx) {
            lm[j].x += lm[i].x - before.x;
            lm[j].y += lm[i].y - before.y;
          }
        }
      }
      if (c.kind === 'arm') {
        // lines = [[shoulder, elbow2], [elbow2, wrist2]] in corrected space.
        lm[lead.el] = { ...lm[lead.el], ...c.lines[0][1] };
        lm[lead.wr] = { ...lm[lead.wr], ...c.lines[1][1] };
      }
    }
    ghosts.push({ t, lm });
  }
  return ghosts;
}
