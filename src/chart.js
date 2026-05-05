const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 10, right: 25, bottom: 50, left: 50 };

const COLORS = [
  '#4e9af1', '#f1614e', '#4ef196', '#f1c84e',
  '#c84ef1', '#f1804e', '#4ef1e8', '#f14eb0',
];

import { must } from './utils.js';

const chartPlot = must('#chart-plot');
const svgEl = must('#chart-plot svg');
const loanG = must('#loan-balance');
const savingsG = must('#savings-balance');
const axesG = must('#axes');
const legendG = must('#chart-legend-g');

let lastResults = null;
let lastDuration = 0;

new ResizeObserver(() => {
  if (lastResults) _render(lastResults, lastDuration);
}).observe(chartPlot);

/**
 * @param {string} tag SVG element tag name.
 * @param {object} [attrs] Attributes to assign.
 * @returns {SVGElement} The new element.
 */
function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * @param {Array<object>} series Per-day rows.
 * @param {number} [max=200] Maximum sample count.
 * @returns {Array<[number, object]>} `[index, row]` pairs, always including the last row.
 */
function sample(series, max = 200) {
  const step = Math.max(1, Math.ceil(series.length / max));
  const out = [];
  for (let i = 0; i < series.length; i += step) out.push([i, series[i]]);
  const last = series.length - 1;
  if (out[out.length - 1][0] !== last) out.push([last, series[last]]);
  return out;
}

/**
 * @param {Array<[number, object]>} pairs Sampled `[day, row]` pairs.
 * @param {(day:number)=>number} toX Day-to-x scale.
 * @param {(v:number)=>number} toY Value-to-y scale.
 * @param {(row:object)=>number} accessor Reads the y-value off a row.
 * @returns {string} An SVG path `d` string.
 */
function buildSmoothPath(pairs, toX, toY, accessor) {
  const pts = pairs.map(([day, row]) => [toX(day), toY(accessor(row))]);
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * @param {number} range Numeric range to subdivide.
 * @param {number} [target=5] Approximate desired tick count.
 * @returns {number} A "nice" 1/2/5 × 10ⁿ step.
 */
function niceStep(range, target = 5) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/** @param {number} v Money amount. @returns {string} Short money label (`$1k` / `$1.2M`). */
function fmtAxisMoney(v) {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

/**
 * @param {Node} node Node to empty.
 */
function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

const TEXT = { 'font-family': 'inherit', 'font-size': '11', 'dominant-baseline': 'middle' };
const FG = 'var(--foreground, #DDD)';

/** @param {{liabilities:Array<{balance:number}>}} row Snapshot. @returns {number} Sum of liability balances. */
const sumLiabilities = (row) => row.liabilities.reduce((s, L) => s + L.balance, 0);
/** @param {{assets:Array<{balance:number}>}} row Snapshot. @returns {number} Sum of asset balances. */
const sumAssets = (row) => row.assets.reduce((s, A) => s + A.balance, 0);

/**
 * @param {Array<{name:string, series:Array<object>}>} results Named simulation results.
 * @param {number} simDuration Longest series length in days.
 */
function _render(results, simDuration) {
  const { width: W, height: H } = svgEl.getBoundingClientRect();
  if (!W || !H) return;

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const PW = W - PAD.left - PAD.right;
  const PH = H - PAD.top - PAD.bottom;

  const toX = (day) => PAD.left + (day / simDuration) * PW;
  const toY = (v, minVal, range) => PAD.top + PH * (1 - (v - minVal) / range);

  clear(loanG); clear(savingsG); clear(axesG); clear(legendG);

  const active = results.filter(r => r.series.length > 0);
  if (!active.length || !simDuration) return;

  // Y scale
  let minVal = 0, maxVal = 0;
  for (const { series } of active) {
    for (const row of series) {
      const liab = sumLiabilities(row);
      const ass = sumAssets(row);
      if (liab > maxVal) maxVal = liab;
      if (ass > maxVal) maxVal = ass;
      if (ass < minVal) minVal = ass;
    }
  }
  const range = maxVal - minVal || 1;
  const ty = (v) => toY(v, minVal, range);

  // Axis lines
  const stroke03 = { stroke: FG, 'stroke-opacity': '0.3', 'stroke-width': '0.5' };
  axesG.appendChild(el('line', { x1: PAD.left, y1: PAD.top + PH, x2: PAD.left + PW, y2: PAD.top + PH, ...stroke03 }));
  axesG.appendChild(el('line', { x1: PAD.left, y1: PAD.top, x2: PAD.left, y2: PAD.top + PH, ...stroke03 }));

  // Y grid lines + labels
  const yStep = niceStep(range);
  for (let v = Math.ceil(minVal / yStep) * yStep; v <= maxVal + yStep * 0.01; v += yStep) {
    const y = ty(v).toFixed(1);
    const isZero = Math.abs(v) < yStep * 0.01;
    axesG.appendChild(el('line', {
      x1: PAD.left, y1: y, x2: PAD.left + PW, y2: y,
      stroke: FG,
      'stroke-opacity': isZero ? '0.4' : '0.12',
      'stroke-width': isZero ? '0.8' : '0.5',
      'stroke-dasharray': isZero ? '' : '4 4',
    }));
    const t = el('text', { x: PAD.left - 6, y, 'text-anchor': 'end', fill: FG, opacity: '0.55', ...TEXT });
    t.textContent = fmtAxisMoney(v);
    axesG.appendChild(t);
  }

  // X grid lines + labels
  const totalYears = Math.ceil(simDuration / 365.25);
  const yearStep = totalYears <= 10 ? 1 : totalYears <= 30 ? 5 : 10;
  for (let yr = 0; yr <= totalYears; yr += yearStep) {
    const day = Math.min(yr * 365.25, simDuration);
    if (yr > 0 && day > simDuration * 1.001) break;
    const x = toX(day).toFixed(1);
    axesG.appendChild(el('line', { x1: x, y1: PAD.top, x2: x, y2: PAD.top + PH, stroke: FG, 'stroke-opacity': '0.12', 'stroke-width': '0.5' }));
    const t = el('text', { x, y: PAD.top + PH + 6, 'text-anchor': 'middle', 'dominant-baseline': 'hanging', fill: FG, opacity: '0.55', 'font-family': 'inherit', 'font-size': '11' });
    t.textContent = `yr${yr}`;
    axesG.appendChild(t);
  }

  // Data lines
  results.forEach(({ series }, i) => {
    if (!series.length) return;
    const color = COLORS[i % COLORS.length];
    const pairs = sample(series);
    const base = { fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    loanG.appendChild(el('path', { d: buildSmoothPath(pairs, toX, ty, sumLiabilities), ...base }));
    savingsG.appendChild(el('path', { d: buildSmoothPath(pairs, toX, ty, sumAssets), ...base, 'stroke-dasharray': '8 5' }));
  });

  // Legend
  const lineW = 18;
  const gap = 5;
  const sep = 14;
  const g = el('g');
  let x = 0;

  active.forEach((r, idx) => {
    const i = results.indexOf(r);
    const color = COLORS[i % COLORS.length];
    if (idx > 0) x += sep;
    g.appendChild(el('line', { x1: x, y1: 0, x2: x + lineW, y2: 0, stroke: color, 'stroke-width': '2' }));
    x += lineW + gap;
    const t = el('text', { x, y: 0, fill: FG, opacity: '0.8', 'text-anchor': 'start', ...TEXT });
    t.textContent = r.name;
    g.appendChild(t);
    x += r.name.length * 6.5;
  });

  // Type key
  x += sep;
  g.appendChild(el('line', { x1: x, y1: 0, x2: x + lineW, y2: 0, stroke: FG, 'stroke-width': '1.5', opacity: '0.5' }));
  x += lineW + gap;
  const loanT = el('text', { x, y: 0, fill: FG, opacity: '0.5', 'text-anchor': 'start', ...TEXT });
  loanT.textContent = 'liabilities';
  g.appendChild(loanT);
  x += 11 * 6.5 + sep;
  g.appendChild(el('line', { x1: x, y1: 0, x2: x + lineW, y2: 0, stroke: FG, 'stroke-width': '1.5', 'stroke-dasharray': '5 3', opacity: '0.5' }));
  x += lineW + gap;
  const savT = el('text', { x, y: 0, fill: FG, opacity: '0.5', 'text-anchor': 'start', ...TEXT });
  savT.textContent = 'assets';
  g.appendChild(savT);

  legendG.appendChild(g);

  // Centre under the plot area using the actual rendered bbox.
  const bbox = g.getBBox();
  const centerX = PAD.left + PW / 2;
  const bottomY = PAD.top + PH + 40;
  g.setAttribute('transform', `translate(${(centerX - bbox.width / 2).toFixed(1)},${bottomY})`);

  // Background behind legend
  g.insertBefore(el('rect', {
    x: (bbox.x - 6).toFixed(1),
    y: (bbox.y - 4).toFixed(1),
    width: (bbox.width + 12).toFixed(1),
    height: (bbox.height + 8).toFixed(1),
    fill: 'none',
  }), g.firstChild);
}

/**
 * @param {Array<{name:string, series:Array<object>}>} results Named simulation results.
 * @param {number} simDuration Longest series length in days.
 */
export function renderChart(results, simDuration) {
  lastResults = results;
  lastDuration = simDuration;
  _render(results, simDuration);
}
