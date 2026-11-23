// Graphiques SVG/HTML sans dépendance. Marques fines, écarts de 2 px, ancrés sur la ligne de base.
import { fmt } from './model.js';

export function donut(items, { size = 176, stroke = 20, center = '', sub = '' } = {}) {
  const tot = items.reduce((a, x) => a + x.value, 0);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, cx = size / 2;
  let acc = 0;
  const gap = items.length > 1 ? 2.5 : 0;
  const segs = tot > 0 ? items.filter((x) => x.value > 0).map((x) => {
    const len = (x.value / tot) * c;
    const dash = Math.max(0.5, len - gap);
    const off = -acc;
    acc += len;
    return `<circle class="seg" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${x.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${off}" transform="rotate(-90 ${cx} ${cx})" data-id="${x.id}"><title>${x.label} · ${fmt(x.value)}</title></circle>`;
  }).join('') : '';
  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Répartition">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--s2)" stroke-width="${stroke}"/>${segs}</svg>
    <div class="donut-c"><b>${center}</b><span>${sub}</span></div></div>`;
}

export function ribbon(items, { h = 14, anim = true } = {}) {
  const tot = items.reduce((a, x) => a + Math.max(0, x.value), 0) || 1;
  return `<div class="ribbon ${anim ? 'anim' : ''}" style="height:${h}px">${items.filter((x) => x.value > 0).map((x, i) =>
    `<i style="flex:${x.value / tot};background:${x.color};--i:${i}" title="${x.label} · ${fmt(x.value)}"></i>`).join('')}</div>`;
}

// Barres verticales HTML : chaque colonne est un bouton (tap = lecture de la valeur)
export function bars(items, { max, unit = fmt, active = items.length - 1 } = {}) {
  const m = max ?? Math.max(1, ...items.map((x) => x.value));
  return `<div class="bars" data-bars>
    ${items.map((x, i) => `<button class="bar ${i === active ? 'on' : ''}" data-act="bar" data-v="${x.value}" data-l="${x.long ?? x.label}">
      <span class="col"><span class="fill" style="height:${Math.max(x.value > 0 ? 4 : 0, (x.value / m) * 100)}%"></span></span>
      <span class="lab">${x.label}</span></button>`).join('')}
  </div>`;
}

export function line(points, { w = 320, h = 120, color = 'var(--ivory)' } = {}) {
  if (points.length < 2) return `<div class="empty-chart">Le graphique apparaîtra après quelques jours d'utilisation.</div>`;
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const x = (i) => (i / (points.length - 1)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * h;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  const area = `${d}L${w} ${h}L0 ${h}Z`;
  const last = points[points.length - 1];
  return `<div class="linechart" data-line='${JSON.stringify(points.map((p) => [p.l, p.v]))}'>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Évolution">
      <path d="${area}" fill="${color}" opacity=".07"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <span class="dot" style="left:100%;top:${(y(last.v) / h) * 100}%"></span>
    <div class="cross" hidden><i></i></div></div>`;
}

export function spark(series, { w = 120, h = 34, up = true } = {}) {
  if (!series?.length) return '';
  const lo = Math.min(...series), hi = Math.max(...series), r = hi - lo || 1;
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${((i / (series.length - 1)) * w).toFixed(1)} ${(h - ((v - lo) / r) * h).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? 'var(--good)' : 'var(--bad)'}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
