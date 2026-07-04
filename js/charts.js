// Canvas charts: score radar + progress trend line.
// Colors are read from CSS custom properties at draw time so light/dark
// swap automatically; every colored mark is paired with a visible text
// label elsewhere in the UI (the metric list / session list is the table view).

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function setupCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssHeight };
}

// ---------- Radar ----------

export function drawRadar(canvas, entries) {
  // entries: [{ label, value (0-100 | null), color }]
  const { ctx, w, h } = setupCanvas(canvas, Math.min(340, Math.max(280, canvas.clientWidth)));
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2 + 4;
  const R = Math.min(w, h) / 2 - 42;
  const n = entries.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

  // Rings + spokes: solid hairlines.
  ctx.strokeStyle = cssVar('--grid');
  ctx.lineWidth = 1;
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pt(i % n, R * frac);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(...pt(i, R));
    ctx.stroke();
  }

  // Data polygon: single series, slot-1 stroke + light fill.
  const line = cssVar('--s1');
  ctx.beginPath();
  entries.forEach((e, i) => {
    const r = R * ((e.value ?? 0) / 100);
    const [x, y] = pt(i, r);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = withAlpha(line, 0.14);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Vertex markers (8px) with a 2px surface ring; hollow for n/a.
  const surface = cssVar('--surface');
  const hits = [];
  entries.forEach((e, i) => {
    const r = R * ((e.value ?? 0) / 100);
    const [x, y] = pt(i, r);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    if (e.value == null) {
      ctx.strokeStyle = cssVar('--muted');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = line;
      ctx.fill();
    }
    hits.push({ x, y, entry: e });
  });

  // Axis labels in muted ink.
  ctx.fillStyle = cssVar('--muted');
  ctx.font = '600 10.5px system-ui, -apple-system, sans-serif';
  entries.forEach((e, i) => {
    let [x, y] = pt(i, R + 16);
    const cos = Math.cos(angle(i));
    ctx.textAlign = Math.abs(cos) < 0.3 ? 'center' : cos > 0 ? 'left' : 'right';
    ctx.textBaseline = Math.abs(Math.sin(angle(i))) < 0.3 ? 'middle' : Math.sin(angle(i)) > 0 ? 'top' : 'bottom';
    // Keep labels inside the canvas.
    const tw = ctx.measureText(e.label).width;
    if (ctx.textAlign === 'right') x = Math.max(x, tw + 2);
    else if (ctx.textAlign === 'left') x = Math.min(x, w - tw - 2);
    else x = Math.min(Math.max(x, tw / 2 + 2), w - tw / 2 - 2);
    ctx.fillText(e.label, x, y);
  });

  canvas._hits = hits;
}

// ---------- Trend line ----------

export function drawTrend(canvas, points, color, opts = {}) {
  // points: [{ label, value (0-100) }]
  const { ctx, w } = setupCanvas(canvas, opts.height || 190);
  const h = opts.height || 190;
  ctx.clearRect(0, 0, w, h);

  const padL = 30, padR = 14, padT = 12, padB = 26;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const yFor = (v) => padT + plotH * (1 - v / 100);
  const xFor = (i) => points.length === 1
    ? padL + plotW / 2
    : padL + (plotW * i) / (points.length - 1);

  // Grid: solid hairlines at 0/25/50/75/100.
  ctx.strokeStyle = cssVar('--grid');
  ctx.fillStyle = cssVar('--muted');
  ctx.font = '500 10px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const v of [0, 25, 50, 75, 100]) {
    const y = yFor(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(String(v), padL - 6, y);
  }

  // X labels: first and last only (dates), centered under their points.
  ctx.textBaseline = 'top';
  if (points.length) {
    ctx.textAlign = points.length === 1 ? 'center' : 'left';
    ctx.fillText(points[0].label, points.length === 1 ? xFor(0) : padL, h - padB + 8);
    if (points.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillText(points[points.length - 1].label, w - padR, h - padB + 8);
    }
  }

  // Line (2px) + markers (8px) with surface ring.
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.value);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  if (points.length > 1) ctx.stroke();

  const surface = cssVar('--surface');
  const hits = [];
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.value);
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    hits.push({ x, y, entry: p });
  });

  // Direct label on the latest point only.
  if (points.length) {
    const last = points[points.length - 1];
    ctx.fillStyle = cssVar('--ink');
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(Math.round(last.value)), xFor(points.length - 1), yFor(last.value) - 8);
  }

  canvas._hits = hits;
}

// ---------- Shared tap/hover tooltip ----------

export function bindChartTip(canvas, tipEl, formatEntry) {
  const show = (clientX, clientY) => {
    const hits = canvas._hits || [];
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    let bestHit = null, bestD = 24; // ≥24px hit target
    for (const hit of hits) {
      const d = Math.hypot(hit.x - px, hit.y - py);
      if (d < bestD) { bestD = d; bestHit = hit; }
    }
    if (!bestHit) { tipEl.style.display = 'none'; return; }
    const { title, sub } = formatEntry(bestHit.entry);
    tipEl.innerHTML = `<div class="tip-title"></div><div class="tip-sub"></div>`;
    tipEl.firstChild.textContent = title;
    tipEl.lastChild.textContent = sub;
    tipEl.style.display = 'block';
    const box = canvas.parentElement.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = bestHit.x + rect.left - box.left - tw / 2;
    x = Math.max(4, Math.min(box.width - tw - 4, x));
    let y = bestHit.y + rect.top - box.top - th - 12;
    if (y < 0) y = bestHit.y + rect.top - box.top + 12;
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  };

  canvas.addEventListener('pointerdown', (e) => show(e.clientX, e.clientY));
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') show(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => { tipEl.style.display = 'none'; });
}
