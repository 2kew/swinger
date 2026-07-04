// Video-overlay drawing: wire-mesh skeleton, hand trajectory, and fault/fix
// corrections. All coordinates are normalized [0,1] against the video frame.
// Colors here sit on top of video, not the themed surface, so they are fixed.

import { CONNECTIONS } from './swing.js';

export const FIX_COLOR = '#3ddc84';
export const FAULT_COLOR = '#ff5252';

const scaleFor = (W) => Math.max(1, W / 640);

export function drawSkeleton(ctx, lm, W, H, opts = {}) {
  const s = scaleFor(W);
  const line = opts.line || 'rgba(255,255,255,0.85)';
  const joint = opts.joint || 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  ctx.strokeStyle = line;
  ctx.lineWidth = (opts.width || 2.5) * s;
  if (opts.dash) ctx.setLineDash([6 * s, 4 * s]);
  for (const [i, j] of CONNECTIONS) {
    const p = lm[i], q = lm[j];
    if ((p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * W, p.y * H);
    ctx.lineTo(q.x * W, q.y * H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = joint;
  for (const [i, j] of CONNECTIONS) {
    for (const idx of [i, j]) {
      const p = lm[idx];
      if ((p.visibility ?? 1) < 0.4) continue;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 3.5 * s, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

// The full corrected pose, drawn as a dashed green skeleton.
export function drawGhostSkeleton(ctx, lm, W, H) {
  drawSkeleton(ctx, lm, W, H, {
    line: 'rgba(61,220,132,0.9)',
    joint: 'rgba(61,220,132,0.95)',
    dash: true,
    width: 3,
  });
}

// trajectory: [{x, y, seg}] already filtered to the current time.
export function drawTrajectory(ctx, points, segColors, W, H) {
  const s = scaleFor(W);
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    let prev = null;
    for (const p of points) {
      if (prev) {
        ctx.beginPath();
        ctx.moveTo(prev.x * W, prev.y * H);
        ctx.lineTo(p.x * W, p.y * H);
        ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.4)' : segColors[p.seg];
        ctx.lineWidth = (pass === 0 ? 5 : 2.5) * s;
        ctx.stroke();
      }
      prev = p;
    }
  }
}

// Faulty segments in red, corrected ("ghost") positions in dashed green,
// with an arrow from where you are to where you should be.
export function drawCorrections(ctx, lm, corrections, W, H, t) {
  const s = scaleFor(W);
  for (const c of corrections) {
    if (Math.abs(c.t - t) > 0.16) continue;

    for (const [i, j] of c.badSegments || []) {
      const p = lm[i], q = lm[j];
      ctx.strokeStyle = FAULT_COLOR;
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(p.x * W, p.y * H);
      ctx.lineTo(q.x * W, q.y * H);
      ctx.stroke();
    }
    for (const i of c.badPoints || []) {
      const p = lm[i];
      ctx.fillStyle = FAULT_COLOR;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 5 * s, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.strokeStyle = FIX_COLOR;
    ctx.setLineDash([7 * s, 5 * s]);
    ctx.lineWidth = 3 * s;
    for (const [p, q] of c.lines || []) {
      ctx.beginPath();
      ctx.moveTo(p.x * W, p.y * H);
      ctx.lineTo(q.x * W, q.y * H);
      ctx.stroke();
    }
    for (const m of c.marks || []) {
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.r * W, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const arrow of c.arrows || []) {
      drawArrow(ctx, arrow.from.x * W, arrow.from.y * H, arrow.to.x * W, arrow.to.y * H, s);
    }

    if (c.label && c.anchor) {
      const fontPx = 15 * s;
      ctx.font = `700 ${fontPx}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(c.label).width;
      const x = Math.min(Math.max(c.anchor.x * W, tw / 2 + 4), W - tw / 2 - 4);
      const y = Math.min(Math.max(c.anchor.y * H - 10 * s, fontPx + 4), H - 4);
      ctx.lineWidth = 4 * s;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(c.label, x, y);
      ctx.fillStyle = FIX_COLOR;
      ctx.fillText(c.label, x, y);
    }
  }
}

function drawArrow(ctx, x1, y1, x2, y2, s) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4 * s) return;
  ctx.strokeStyle = FIX_COLOR;
  ctx.fillStyle = FIX_COLOR;
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 7 * s;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.5), y2 - head * Math.sin(ang - 0.5));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.5), y2 - head * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
}
