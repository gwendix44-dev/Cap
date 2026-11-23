import * as M from './model.js';
import * as E from './engine.js';
import { reply, suggestions, GLOSSARY, llmContext, SYSTEM_PROMPT, TRANSACTIONAL } from './chat.js';
import { donut, ribbon, bars, line, spark } from './charts.js';
import { fetchBtc, cachedMarket, geminiAsk } from './net.js';
import { store, save } from './store.js';
import { revView } from './revpoints.js';
import { esc, ic, bigMoney, signed, actions, bus, toast, dayLabel, monthLabel, frDate, $, $$ } from './ui.js';

const { fmt, fmt0, pocketById } = M;
const S = () => store.state;
export const ui = { tab: 'home', budget: 'dep', month: M.ym(new Date()), filter: 'all', advisor: 'chat', intro: false };

const STATUS = {
  ahead: ['En avance', 'good'], ontrack: ['Dans les temps', 'good'], behind: ['En retard', 'warn'], done: ['Atteint', 'good'], late: ['Échéance dépassée', 'bad'],
};
const TONE_PILL = { warn: 'warn', good: 'good', info: '' };

// ─────────────────────────── composants ───────────────────────────
const dotc = (c) => `<span class="dot" style="background:${c}"></span>`;

function goalCard(g) {
  const [lab, tone] = STATUS[g.status];
  const p = pocketById(S(), g.pocket);
  return `<div class="group goal"><div class="head"><div><div class="h3">${esc(g.name)}</div>
    <div class="muted small">${esc(frDate(g.date, { day: 'numeric', month: 'long', year: 'numeric' }))} · poche ${esc(p?.name ?? '')}</div></div>
    <span class="pill ${tone}">${lab}</span></div>
    <div class="bar"><i style="width:${Math.round(g.pct * 100)}%;--c:${p?.color ?? 'var(--good)'}"></i></div>
    <div class="foot"><span class="num"><b style="color:var(--tx)">${fmt0(g.saved)}</b> sur ${fmt0(g.target)}</span>
    <span class="num">${g.remaining > 0 ? `~${fmt0(g.perMonth)}/mois` : 'Bravo'}</span></div></div>`;
}

export function renderVerdict(v, { record = true } = {}) {
  const icon = v.level === 'ok' ? '✓' : v.level === 'careful' ? '!' : '✕';
  const p = pocketById(S(), v.pocket);
  return `<div class="verdict ${v.level}"><div class="vh"><div class="badge">${icon}</div>
    <div><div class="h3">${esc(v.headline)}</div><div class="muted small num">${fmt(v.amount)} · ${esc(p.name)}</div></div></div>
    <ul>${v.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    ${v.alternatives.length ? `<div class="alt">${v.alternatives.slice(0, 2).map((a) => `<button data-act="use-alt" data-pocket="${a.pocket}" data-amount="${v.amount}" data-label="${esc(v.label)}"><b>${esc(a.name)}</b>${esc(a.text)}</button>`).join('')}</div>` : ''}
    ${record && v.level !== 'no' ? `<div style="margin-top:14px"><button class="btn primary block" data-act="confirm-expense" data-pocket="${v.pocket}" data-amount="${v.amount}" data-label="${esc(v.label)}">Enregistrer cette dépense</button></div>` : ''}</div>`;
}

function renderCard(c) {
  const s = S();
  if (c.type === 'verdict') return renderVerdict(c.v);
  if (c.type === 'expense') return `<button class="btn primary sm" data-act="confirm-expense" data-pocket="${c.pocket}" data-amount="${c.amount}" data-label="${esc(c.label)}">Enregistrer ${fmt(c.amount)}</button>`;
  if (c.type === 'alloc') {
    return `<div class="minilist">${c.plan.lines.map((l) => { const p = pocketById(s, l.id); return `<div><span class="nm">${dotc(p.color)}${esc(p.name)}</span><b class="num">${fmt0(l.amount)}</b></div>`; }).join('')}</div>
      ${c.plan.notes.length ? `<p class="xs muted" style="margin-top:10px">${esc(c.plan.notes[0])}</p>` : ''}
      <button class="btn primary sm" style="margin-top:12px" data-act="open-income" data-amount="${c.income}">Voir et appliquer</button>`;
  }
  if (c.type === 'balances') return `<div class="minilist">${s.pockets.map((p) => `<div><span class="nm">${dotc(p.color)}${esc(p.name)}</span><b class="num">${fmt(p.balance)}</b></div>`).join('')}</div>`;
  if (c.type === 'goals') return E.goalStatuses(s).map((g) => goalCard(g)).join('');
  if (c.type === 'month') return `<div class="minilist"><div><span class="nm">Reçu</span><b class="num">${fmt(c.m.income)}</b></div><div><span class="nm">Dépensé</span><b class="num">${fmt(c.m.spent)}</b></div><div><span class="nm">Mis de côté</span><b class="num">${fmt(c.m.put)}</b></div></div>`;
  if (c.type === 'invest') {
    const pf = E.portfolio(s);
    return `${ribbon(pf.shares.map((x) => ({ value: x.value, color: x.color, label: x.name })), { h: 10, anim: false })}<button class="btn ghost sm" style="margin-top:12px" data-act="tab" data-tab="invest">Ouvrir Investir</button>`;
  }
  return '';
}

// ─────────────────────────── ACCUEIL ───────────────────────────
function homeView() {
  const s = S(), now = new Date();
  const nw = M.netWorth(s);
  const first = s.snapshots.find((x) => x.d <= M.isoDay(new Date(now - 30 * 86400000))) ?? s.snapshots[0];
  const diff = first ? M.round2(nw - first.total) : 0;
  const delta = first && first.d !== M.isoDay(now) && diff !== 0
    ? `<div class="delta ${diff > 0 ? 'up' : 'down'}"><b class="num">${signed(diff)}</b> depuis le ${frDate(first.d, { day: 'numeric', month: 'long' })}</div>`
    : `<div class="delta">Ton évolution s'affichera dès demain.</div>`;
  const ins = E.insights(s, now);
  const main = ins.find((i) => i.tone === 'warn') ?? ins[0];
  const rest = ins.filter((i) => i !== main && !i.title.startsWith('«')).slice(0, 3);
  const goals = E.goalStatuses(s, now);
  const spendP = s.pockets.filter((p) => p.kind === 'spend');
  const growP = s.pockets.filter((p) => p.kind !== 'spend');
  const pr = (p) => {
    const tgt = p.id === 'abos' ? M.subsTotal(s) : p.target;
    let sub = '', meter = '';
    if (p.kind === 'spend' && tgt > 0) { sub = `sur ${fmt0(tgt)} prévus`; meter = `<div class="meter"><i style="width:${M.clamp(p.balance / tgt, 0, 1) * 100}%;background:${p.color}"></i></div>`; }
    else if (p.role === 'goal') { const g = goals.find((x) => x.pocket === p.id); sub = g ? `${Math.round(g.pct * 100)} % de « ${g.name} »` : 'Projets'; }
    else if (p.kind === 'invest') { const perf = p.base ? ((p.balance - p.base) / p.base) * 100 : 0; sub = Math.abs(perf) < 0.05 ? `${Math.round((p.balance / M.invested(s)) * 100)} % du portefeuille` : `${perf > 0 ? '+' : ''}${perf.toFixed(1).replace('.', ',')} % depuis tes versements`; }
    else sub = 'Disponible';
    return `<button class="row" data-act="pocket" data-id="${p.id}">${dotc(p.color)}<div class="grow"><div class="ttl">${esc(p.name)}</div><div class="sub">${esc(sub)}</div>${meter}</div><div class="amt">${fmt(p.balance)}</div></button>`;
  };
  return `
  <section class="hero"><div class="lbl">Patrimoine</div>
    <div class="big" id="nw" data-v="${nw}">${bigMoney(nw)}</div>${delta}
    ${ribbon(s.pockets.map((p) => ({ value: Math.max(0, p.balance), color: p.color, label: p.name })), { anim: !ui.intro })}
    <div class="groups"><div class="g"><div class="t">À dépenser</div><div class="v">${fmt0(M.spendable(s))}</div></div>
      <div class="g"><div class="t">Épargne</div><div class="v">${fmt0(M.savings(s))}</div></div>
      <div class="g"><div class="t">Investi</div><div class="v">${fmt0(M.invested(s))}</div></div></div>
  </section>
  <div class="actions"><button class="btn primary" data-act="open-income">Répartir un revenu</button><button class="btn ghost" data-act="open-expense">Dépense</button></div>
  ${main ? `<section class="section"><div class="sec-h"><h2 class="h2">Le conseil du moment</h2></div>
    <div class="advice ${main.tone}"><h3>${esc(main.title)}</h3><p>${esc(main.text)}</p></div>
    ${rest.length ? `<div class="group" style="margin-top:10px">${rest.map((i) => `<div class="row"><div class="grow"><div class="ttl">${esc(i.title)}</div><div class="sub">${esc(i.text)}</div></div></div>`).join('')}</div>` : ''}</section>` : ''}
  ${goals.length ? `<section class="section"><div class="sec-h"><h2 class="h2">Projets</h2><button class="link" data-act="tab" data-tab="manage">Gérer</button></div>${goals.map(goalCard).join('<div style="height:10px"></div>')}</section>` : ''}
  <section class="section"><div class="sec-h"><h2 class="h2">Enveloppes</h2></div><div class="group">${spendP.map(pr).join('')}</div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Épargne et placements</h2></div><div class="group">${growP.map(pr).join('')}</div></section>`;
}

// ─────────────────────────── BUDGET ───────────────────────────
function txRow(t) {
  const s = S();
  const p = t.pocket ? pocketById(s, t.pocket) : null;
  const time = new Date(t.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (t.type === 'income') {
    const n = Object.keys(t.alloc ?? {}).length;
    return `<button class="row" data-act="tx" data-id="${t.id}">${dotc('var(--ivory)')}<div class="grow"><div class="ttl">${esc(t.label || 'Revenu')}</div><div class="sub">Réparti sur ${n} poche${n > 1 ? 's' : ''} · ${time}</div></div><div class="amt pos">+${fmt(t.amount)}</div></button>`;
  }
  if (t.type === 'move') return `<button class="row" data-act="tx" data-id="${t.id}">${dotc(p?.color ?? '#888')}<div class="grow"><div class="ttl">${esc(t.label || 'Virement interne')}</div><div class="sub">${esc(pocketById(s, t.from)?.name ?? '')} → ${esc(p?.name ?? '')} · ${time}</div></div><div class="amt">${fmt(t.amount)}</div></button>`;
  if (t.type === 'adjust') return `<button class="row" data-act="tx" data-id="${t.id}">${dotc(p?.color ?? '#888')}<div class="grow"><div class="ttl">Solde recalé</div><div class="sub">${esc(p?.name ?? '')} · ${time}</div></div><div class="amt ${t.amount >= 0 ? 'pos' : 'neg'}">${signed(t.amount)}</div></button>`;
  return `<button class="row" data-act="tx" data-id="${t.id}">${dotc(p?.color ?? '#888')}<div class="grow"><div class="ttl">${esc(t.label || p?.name || 'Dépense')}</div><div class="sub">${esc(p?.name ?? '')} · ${time}</div></div><div class="amt">−${fmt(t.amount)}</div></button>`;
}

function budgetDep() {
  const s = S();
  const spendP = s.pockets.filter((p) => p.kind === 'spend');
  let list = s.tx.filter((t) => ['expense', 'income', 'move', 'adjust'].includes(t.type));
  if (ui.filter !== 'all') list = list.filter((t) => t.pocket === ui.filter);
  const chips = `<div class="chips"><button class="chip ${ui.filter === 'all' ? 'on' : ''}" data-act="filter" data-id="all">Tout</button>${s.pockets.map((p) => `<button class="chip ${ui.filter === p.id ? 'on' : ''}" data-act="filter" data-id="${p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join('')}</div>`;
  if (!list.length) return `${chips}<div class="empty" style="margin-top:20px">Aucune opération pour l'instant.<br>Ajoute ta première dépense avec le bouton en bas.</div>`;
  let html = chips, last = '';
  for (const t of list.slice(0, 120)) {
    const d = dayLabel(t.ts);
    if (d !== last) { html += `${last ? '</div>' : ''}<div class="day">${esc(d)}</div><div class="group">`; last = d; }
    html += txRow(t);
  }
  return html + '</div>';
}

function budgetThemes() {
  const s = S();
  const m = E.monthSummary(s, ui.month);
  const prevKey = (() => { const [y, mo] = ui.month.split('-').map(Number); return M.ym(new Date(y, mo - 2, 1)); })();
  const pm = E.monthSummary(s, prevKey);
  const items = s.pockets.filter((p) => m.byPocket[p.id]).map((p) => ({ id: p.id, label: p.name, value: m.byPocket[p.id], color: p.color })).sort((a, b) => b.value - a.value);
  const nav = `<div class="readout"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Mois précédent">${ic('back')}</button><div class="h2" style="text-transform:capitalize">${monthLabel(ui.month)}</div><button class="iconbtn" data-act="month" data-d="1" aria-label="Mois suivant" ${ui.month >= M.ym(new Date()) ? 'disabled style="opacity:.3"' : ''}>${ic('chev')}</button></div>`;
  if (!items.length) return `${nav}<div class="empty">Aucune dépense ce mois-ci.</div>`;
  return `${nav}${donut(items, { center: fmt0(m.spent), sub: 'dépensés' })}
  <div class="legend group" style="margin-top:22px">${items.map((x) => {
    const p = pocketById(s, x.id), prev = pm.byPocket[x.id] ?? 0, d = x.value - prev;
    const tgt = p.target > 0 && p.id !== 'abos' ? p.target : 0;
    return `<div class="row">${dotc(x.color)}<div class="grow"><div class="ttl">${esc(x.label)}</div><div class="sub">${Math.round((x.value / m.spent) * 100)} % du total${pm.spent ? ` · ${d >= 0 ? '+' : '−'}${fmt0(Math.abs(d))} vs mois précédent` : ''}</div>
      ${tgt ? `<div class="meter"><i style="width:${M.clamp(x.value / tgt, 0, 1) * 100}%;background:${x.color}"></i></div>` : ''}</div><div class="amt">${fmt(x.value)}${tgt ? `<small>budget ${fmt0(tgt)}</small>` : ''}</div></div>`;
  }).join('')}</div>`;
}

function commentMonth(m) {
  if (!m.income) return 'Aucun revenu saisi ce mois-ci. Dès que tu en ajoutes un, je calcule ton taux d\'effort.';
  const r = Math.round(m.rate * 100);
  if (r >= 30) return `Tu as mis ${r} % de tes revenus de côté ou en placement : excellent, c'est au-dessus des 20 % souvent visés.`;
  if (r >= 15) return `${r} % de tes revenus mis de côté ou investis. C'est correct ; viser 20 % est un bon repère.`;
  return `Seulement ${r} % de tes revenus ont été mis de côté. Regarde le détail par thème pour trouver où alléger.`;
}

function budgetMois() {
  const s = S();
  const m = E.monthSummary(s, ui.month);
  const six = E.lastMonths(s, 6);
  const act = Math.max(0, six.findIndex((x) => x.key === ui.month));
  const cur = six[act] ?? six[five()];
  const pts = s.snapshots.slice(-90).map((x) => ({ l: frDate(x.d, { day: 'numeric', month: 'short' }), v: x.total }));
  const nav = `<div class="readout"><button class="iconbtn" data-act="month" data-d="-1">${ic('back')}</button><div class="h2" style="text-transform:capitalize">${monthLabel(ui.month)}</div><button class="iconbtn" data-act="month" data-d="1" ${ui.month >= M.ym(new Date()) ? 'disabled style="opacity:.3"' : ''}>${ic('chev')}</button></div>`;
  return `${nav}
  <div class="stat3"><div><div class="t">Reçu</div><div class="v">${fmt0(m.income)}</div></div><div><div class="t">Dépensé</div><div class="v">${fmt0(m.spent)}</div></div><div><div class="t">Mis de côté</div><div class="v">${fmt0(m.put)}</div></div></div>
  <div class="advice info"><h3>Le résumé</h3><p>${esc(commentMonth(m))}</p></div>
  <section class="section"><div class="sec-h"><h2 class="h2">Dépenses sur 6 mois</h2></div>
    <div class="readout"><div class="big" id="readout">${bigMoney(cur?.spent ?? 0)}</div><span class="muted small" id="readout-l" style="text-transform:capitalize">${esc(monthLabel(cur?.key ?? ui.month))}</span></div>
    ${bars(six.map((x) => ({ label: x.label, long: monthLabel(x.key), value: x.spent })), { active: act })}</section>
  <section class="section"><div class="sec-h"><h2 class="h2">Patrimoine</h2></div>
    <div class="readout"><div class="big" id="lr" style="font-size:34px">${bigMoney(M.netWorth(s))}</div><span class="muted small" id="lr-l">Aujourd'hui</span></div>
    ${line(pts)}</section>`;
  function five() { return six.length - 1; }
}

function budgetView() {
  const seg = `<div class="seg">${[['dep', 'Dépenses'], ['themes', 'Thèmes'], ['mois', 'Mois']].map(([k, l]) => `<button class="${ui.budget === k ? 'on' : ''}" data-act="seg" data-k="${k}">${l}</button>`).join('')}</div>`;
  return `<h1 class="h1" style="margin-bottom:18px">Budget</h1>${seg}${ui.budget === 'dep' ? budgetDep() : ui.budget === 'themes' ? budgetThemes() : budgetMois()}`;
}

// ─────────────────────────── CONSEILLER ───────────────────────────
const md = (t) => esc(t)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/^\s*[*-] +/gm, '• ')
  .replace(/^#{1,3} +(.+)$/gm, '<b>$1</b>');
const srcHtml = (src = []) => src.length ? `<div class="srcs">${src.map((x) => `<a href="${esc(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`).join('')}</div>` : '';

function msgHtml(m) {
  if (m.role === 'user') return `<div class="msg me">${esc(m.text)}</div>`;
  return `<div class="msg ai">${md(m.text)}${m.live ? '<div class="live">Actualité vérifiée sur le web</div>' : ''}${srcHtml(m.sources)}${m.card ? `<div class="card">${renderCard(m.card)}</div>` : ''}</div>`;
}

function chatIntro(s) {
  const on = s.settings.llm.enabled && s.settings.llm.key;
  const hello = `<div class="msg ai">Salut ${esc(s.settings.name)}. Je suis ton conseiller financier : budget, banque, investissement et actualité qui touche ton argent. Je t'explique tout comme un prof, avec des comparaisons simples.</div>`;
  if (on) return hello;
  return `${hello}<div class="msg ai">Pour l'instant je réponds avec tes chiffres et mes cours intégrés. Pour que je suive l'actualité (bourse, taux, Bitcoin, monde) et que je réponde à toutes tes questions, active l'IA gratuite.<div class="card"><button class="btn primary sm" data-act="llm">Activer l'actualité</button></div></div>`;
}

function advisorView() {
  const s = S();
  const seg = `<div class="seg">${[['chat', 'Discussion'], ['can', 'Puis-je ?']].map(([k, l]) => `<button class="${ui.advisor === k ? 'on' : ''}" data-act="aseg" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (ui.advisor === 'chat') {
    const msgs = s.chat.slice(-40);
    return `<h1 class="h1" style="margin-bottom:18px">Conseiller</h1>${seg}
    <div class="chatwrap"><div class="msgs" id="msgs">${chatIntro(s)}${msgs.map(msgHtml).join('')}</div>
      <div class="chips" style="margin-bottom:6px">${suggestions().map((t) => `<button class="chip" data-act="suggest" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <form class="composer" id="composer" autocomplete="off"><input class="input" id="msg" placeholder="Écris ton message…" enterkeyhint="send" aria-label="Message"><button class="send" aria-label="Envoyer">${ic('send')}</button></form></div>`;
  }
  const spendP = s.pockets.filter((p) => p.kind === 'spend');
  return `<h1 class="h1" style="margin-bottom:18px">Conseiller</h1>${seg}
  <p class="dim" style="margin-bottom:6px">Une dépense en tête ? Je te dis si elle passe, avec tes vrais soldes.</p>
  <input class="input amount" id="c-amt" inputmode="decimal" placeholder="0 €" aria-label="Montant">
  <label class="field"><span>C'est pour quoi ?</span><input class="input" id="c-label" placeholder="Restaurant, billet de train…"></label>
  <div class="chips" id="c-pockets" style="margin-bottom:22px">${spendP.map((p) => `<button class="chip" data-act="c-pocket" data-id="${p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join('')}</div>
  <div id="c-out"><div class="empty" style="padding:24px 0">Entre un montant pour voir le verdict.</div></div>`;
}

export function updateChat() {
  const el = $('#msgs');
  if (!el) return;
  const s = S();
  el.innerHTML = chatIntro(s) + s.chat.slice(-40).map(msgHtml).join('') + (ui.typing ? '<div class="msg ai typing">Je réfléchis…</div>' : '');
  el.scrollTop = el.scrollHeight;
}

async function sendChat(text) {
  const s = S();
  text = text.trim();
  if (!text) return;
  s.chat.push({ role: 'user', text, ts: Date.now() });
  const r = reply(s, text);
  const llm = s.settings.llm;
  const local = r.card && TRANSACTIONAL.has(r.card.type); // calculs exacts : toujours le moteur local
  if (!local && llm.enabled && llm.key) {
    ui.typing = true; updateChat();
    try {
      const prior = s.chat.slice(-9, -1).map((m) => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.text }));
      const ans = await geminiAsk({
        key: llm.key, model: llm.model, system: SYSTEM_PROMPT.replace('{name}', s.settings.name), history: prior,
        prompt: `Données actuelles de {name} (JSON) : ${JSON.stringify(llmContext(s))}\n\nQuestion : ${text}`.replace('{name}', s.settings.name),
      });
      s.chat.push({ role: 'ai', text: ans.text, sources: ans.sources, live: ans.live && ans.sources.length > 0, ts: Date.now() });
    } catch (e) {
      s.chat.push({ role: 'ai', text: `Je n'ai pas pu joindre l'IA (${e.message}). Voici ce que je sais de mon côté :\n\n${r.text}`, card: r.card, ts: Date.now() });
    }
    ui.typing = false;
  } else s.chat.push({ role: 'ai', text: r.text, card: r.card, ts: Date.now() });
  s.chat = s.chat.slice(-80);
  save(); updateChat();
}

// ─────────────────────────── INVESTIR ───────────────────────────
function btcBox(d) {
  if (!d) return `<div class="group" style="padding:18px"><div class="muted">Cours indisponible pour l'instant (connexion ?).</div><button class="btn ghost sm" style="margin-top:12px" data-act="btc">Réessayer</button></div>`;
  const up = d.change24 >= 0;
  const age = Math.round((Date.now() - d.ts) / 60000);
  return `<div class="group" style="padding:18px"><div class="price"><div><div class="muted small">Bitcoin</div><div class="big">${bigMoney(d.price).replace(/<span class="cents">.*<\/span>/, '')}<span class="cents"> €</span></div></div><div style="text-align:right">${spark(d.series, { up: d.series.at(-1) >= d.series[0] })}<div class="small ${up ? 'pos' : 'neg'}" style="margin-top:4px">${up ? '▲' : '▼'} ${Math.abs(d.change24).toFixed(1).replace('.', ',')} % sur 24 h</div></div></div>
    <div class="foot" style="display:flex;justify-content:space-between;margin-top:14px;color:var(--tx3);font-size:13px"><span>Courbe : 30 jours</span><span>${age < 1 ? 'À l\'instant' : `Il y a ${age} min`} · <button data-act="btc" style="text-decoration:underline">Actualiser</button></span></div></div>`;
}

function investView() {
  const s = S();
  const ip = E.investPlan(s);
  const pf = ip.pf;
  const hasEtf = s.pockets.some((p) => p.id === 'etf');
  const lines = pf.shares.map((x) => {
    const p = pocketById(s, x.id);
    const perf = p.base ? ((p.balance - p.base) / p.base) * 100 : 0;
    return `<button class="row" data-act="value" data-id="${x.id}">${dotc(x.color)}<div class="grow"><div class="ttl">${esc(x.name)}</div><div class="sub">${Math.round(x.share * 100)} % du portefeuille${Math.abs(perf) >= 0.05 ? ` · <span class="${perf > 0 ? 'pos' : 'neg'}">${perf > 0 ? '+' : ''}${perf.toFixed(1).replace('.', ',')} %</span>` : ''}</div></div><div class="amt">${fmt(x.value)}<small>mettre à jour</small></div></button>`;
  }).join('');
  const brief = (() => { try { return JSON.parse(localStorage.getItem('cap.brief')); } catch { return null; } })();
  const nextRows = hasEtf
    ? [['ETF S&P 500', 60, M.COLORS.etf], ['Robo-advisor', 30, M.COLORS.robo], ...(ip.btcPct <= ip.cap ? [['Bitcoin', 10, M.COLORS.btc]] : [])]
    : [['Robo-advisor', 100, M.COLORS.robo]];
  return `<h1 class="h1" style="margin-bottom:6px">Investir</h1><p class="dim" style="margin-bottom:22px">Horizon ${s.settings.horizon} ans · profil équilibré à dynamique</p>
  <div class="readout"><div><div class="muted small">Portefeuille</div><div class="big" style="font-size:44px">${bigMoney(pf.total)}</div></div></div>
  ${ribbon(pf.shares.map((x) => ({ value: x.value, color: x.color, label: x.name })), { anim: false })}
  <div class="group" style="margin-top:18px">${lines}</div>
  <section class="section"><div class="sec-h"><h2 class="h2">Marché</h2></div><div id="btcbox">${btcBox(cachedMarket())}</div>
    <div class="group" style="padding:18px;margin-top:10px"><div class="h3">Point marché du jour</div>
      <p class="dim small" style="margin:6px 0 12px">Bourse, indices, Bitcoin : un résumé en mots simples, avec la date des informations.</p>
      <div id="brief" style="white-space:pre-wrap;color:var(--tx2);font-size:15px">${brief ? `${md(brief.text)}${srcHtml(brief.sources)}\n<span class="muted xs">Généré le ${new Date(brief.ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
      <button class="btn ghost sm" data-act="brief" style="margin-top:12px">${brief ? 'Actualiser' : 'Générer le point marché'}</button></div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Mon plan</h2></div>${ip.advice.map((a) => `<div class="advice ${a.tone}"><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></div>`).join('')}</section>
  <section class="section"><div class="sec-h"><h2 class="h2">Où va le prochain euro</h2></div>
    <div class="group">${nextRows.map(([n, pct, c]) => `<div class="row">${dotc(c)}<div class="grow"><div class="ttl">${n}</div><div class="meter"><i style="width:${pct}%;background:${c}"></i></div></div><div class="amt">${pct} %</div></div>`).join('')}</div>
    <p class="muted small" style="margin-top:10px">${hasEtf ? '' : 'Crée une poche « ETF S&P 500 » dans Gérer pour répartir autrement. '}${ip.btcPct > ip.cap ? 'Bitcoin est en pause tant que son poids dépasse le plafond.' : ''}</p></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Glossaire</h2></div><div class="group">${GLOSSARY.map((g) => `<details class="gl"><summary>${esc(g.t)}</summary><p>${esc(g.d)}</p></details>`).join('')}</div></section>
  <p class="muted xs" style="margin-top:26px">Informations pédagogiques calculées sur tes chiffres, pas un conseil en investissement personnalisé et réglementé. Les placements peuvent perdre de la valeur.</p>`;
}

// ─────────────────────────── GÉRER ───────────────────────────
function manageView() {
  const s = S();
  const incomes = s.tx.filter((t) => t.type === 'income').slice(0, 4);
  const goals = E.goalStatuses(s);
  const r = (t, sub, act, extra = '') => `<button class="row" data-act="${act}" ${extra}><div class="grow"><div class="ttl">${t}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div><span class="muted">${ic('chev')}</span></button>`;
  return `<h1 class="h1" style="margin-bottom:22px">Gérer</h1>
  <section><div class="sec-h"><h2 class="h2">Revenus</h2></div><div class="group">
    ${r('Nouveau revenu', 'Je te propose la répartition', 'open-income')}
    ${incomes.map((t) => `<button class="row" data-act="tx" data-id="${t.id}"><div class="grow"><div class="ttl">${esc(t.label || 'Revenu')}</div><div class="sub">${esc(frDate(t.ts))}</div></div><div class="amt pos">+${fmt(t.amount)}</div></button>`).join('')}</div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Projets</h2></div><div class="group">
    ${goals.map((g) => `<button class="row" data-act="goal" data-id="${g.id}"><div class="grow"><div class="ttl">${esc(g.name)}</div><div class="sub">${fmt0(g.saved)} sur ${fmt0(g.target)} · ${esc(frDate(g.date, { day: 'numeric', month: 'long', year: 'numeric' }))}</div></div><span class="muted">${ic('chev')}</span></button>`).join('')}
    ${r('Ajouter un projet', 'Voyage, achat, objectif daté', 'goal', 'data-id=""')}</div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Poches</h2></div><div class="group">
    ${s.pockets.map((p) => `<button class="row" data-act="pocket" data-id="${p.id}">${dotc(p.color)}<div class="grow"><div class="ttl">${esc(p.name)}</div><div class="sub">${M.KIND_LABEL[p.kind]}${p.pct ? ` · ta part ${p.pct} %` : p.role === 'need' ? ' · besoin fixe' : ''}</div></div><div class="amt">${fmt(p.balance)}</div></button>`).join('')}
    ${r('Ajouter une poche', 'Par exemple « ETF S&P 500 » ou « PEA »', 'pocket', 'data-id=""')}</div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Outils</h2></div><div class="group">
    ${r('Abonnements', `${fmt(M.subsTotal(s))} par mois${s.subs.length ? ` · ${s.subs.length} lignes` : ''}`, 'subs')}
    ${r('Simulateur de loyer', 'Que devient ton budget avec un loyer ?', 'rent')}
    ${r('Importer un relevé Revolut', 'Fichier CSV exporté depuis Revolut', 'import')}</div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Réglages</h2></div><div class="group">
    ${r('Le conseiller', `Influence ${s.settings.influence} % · matelas ${fmt0(s.settings.emergencyTarget)} · plafond Bitcoin ${s.settings.btcCap} %`, 'settings')}
    ${r('IA Gemini (optionnel)', s.settings.llm.enabled ? 'Activée' : 'Désactivée', 'llm')}
    ${r('Code PIN et verrouillage', 'Changer le PIN, verrouiller maintenant', 'pin')}
    ${r('Notifications', s.settings.notif ? 'Activées' : 'Désactivées', 'notif')}
    ${r('Sauvegarde', 'Exporter ou restaurer tes données', 'backup')}</div></section>
  <p class="muted xs" style="margin:26px 0 0;text-align:center">Cap · tes données restent sur ce téléphone.</p>`;
}

// ─────────────────────────── routeur ───────────────────────────
export const TABS = [
  ['home', 'Accueil', 'home'], ['budget', 'Budget', 'wallet'], ['advisor', 'Conseiller', 'chat'], ['invest', 'Investir', 'trend'], ['rev', 'Points', 'star'], ['manage', 'Gérer', 'sliders'],
];
const VIEWS = { home: homeView, budget: budgetView, advisor: advisorView, invest: investView, rev: revView, manage: manageView };

export function render() {
  const view = $('#view');
  view.innerHTML = VIEWS[ui.tab]();
  $('#nav .in').innerHTML = TABS.map(([k, l, i]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}" aria-label="${l}">${ic(i)}<span>${l}</span></button>`).join('');
  const hour = new Date().getHours();
  const hello = hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  $('#top').innerHTML = `<div class="top"><div><div class="brand"><span class="mark"><i style="background:#3987e5;width:12px"></i><i style="background:#199e70;width:17px"></i><i style="background:#f2ede0;width:22px"></i></span>Cap</div></div>
    <div style="display:flex;align-items:center;gap:12px"><span style="color:var(--tx3);font-size:13px">${hello} ${esc(S().settings.name)}</span><button class="iconbtn" data-act="lock" aria-label="Verrouiller">${ic('lock')}</button></div></div>`;
  $('#fab').hidden = !(ui.tab === 'budget' && ui.budget === 'dep');
  mount();
  ui.intro = true;
}

function countUp() {
  const el = $('#nw');
  if (!el || ui.intro || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = +el.dataset.v, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = bigMoney(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bindLine(root) {
  const el = $('.linechart', root);
  if (!el) return;
  const pts = JSON.parse(el.dataset.line);
  const cross = $('.cross', el), dot = $('.dot', el);
  const move = (ev) => {
    const r = el.getBoundingClientRect();
    const k = M.clamp((ev.clientX - r.left) / r.width, 0, 1);
    const i = Math.round(k * (pts.length - 1));
    cross.hidden = false; cross.style.left = (i / (pts.length - 1)) * 100 + '%';
    $('#lr').innerHTML = bigMoney(pts[i][1]); $('#lr-l').textContent = pts[i][0];
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerdown', move);
  el.addEventListener('pointerleave', () => { cross.hidden = true; $('#lr').innerHTML = bigMoney(pts.at(-1)[1]); $('#lr-l').textContent = "Aujourd'hui"; });
  void dot;
}

function mount() {
  const view = $('#view');
  if (ui.tab === 'home') countUp();
  if (ui.tab === 'budget' && ui.budget === 'mois') bindLine(view);
  if (ui.tab === 'advisor' && ui.advisor === 'chat') {
    const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight;
    $('#composer')?.addEventListener('submit', (e) => { e.preventDefault(); const i = $('#msg'); const t = i.value; i.value = ''; sendChat(t); });
  }
  if (ui.tab === 'advisor' && ui.advisor === 'can') bindCan();
  if (ui.tab === 'invest') {
    const c = cachedMarket();
    if (!c || Date.now() - c.ts > 10 * 60000) actions.btc();
  }
}

// « Puis-je ? » (écran)
const can = { pocket: null };
function bindCan() {
  can.pocket = null;
  const run = () => {
    const amt = parseFloat(($('#c-amt').value || '').replace(',', '.'));
    const label = $('#c-label').value;
    if (!label.trim() || can.pocket) { /* choix manuel prioritaire */ } else if (label) can.guess = M.guessPocket(label);
    const id = can.pocket ?? (label.trim() ? M.guessPocket(label) : 'plaisirs');
    $$('#c-pockets .chip').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
    const out = $('#c-out');
    if (!(amt > 0)) { out.innerHTML = '<div class="empty" style="padding:24px 0">Entre un montant pour voir le verdict.</div>'; return; }
    out.innerHTML = renderVerdict(E.verdict(S(), { amount: amt, pocket: id, label }));
  };
  $('#c-amt').addEventListener('input', run);
  $('#c-label').addEventListener('input', () => { can.pocket = null; run(); });
  actions['c-pocket'] = (el) => { can.pocket = el.dataset.id; run(); };
  run();
}

// ─────────────────────────── actions de navigation ───────────────────────────
Object.assign(actions, {
  tab: (el) => { ui.tab = el.dataset.tab; render(); scrollTo(0, 0); },
  seg: (el) => { ui.budget = el.dataset.k; render(); },
  aseg: (el) => { ui.advisor = el.dataset.k; render(); },
  filter: (el) => { ui.filter = el.dataset.id; render(); },
  month: (el) => {
    const [y, m] = ui.month.split('-').map(Number);
    const n = M.ym(new Date(y, m - 1 + Number(el.dataset.d), 1));
    if (n > M.ym(new Date())) return;
    ui.month = n; render();
  },
  bar: (el) => {
    $$('.bar').forEach((b) => b.classList.toggle('on', b === el));
    $('#readout').innerHTML = bigMoney(+el.dataset.v);
    $('#readout-l').textContent = el.dataset.l;
  },
  suggest: (el) => sendChat(el.dataset.t),
  btc: async (el) => {
    const box = $('#btcbox');
    try { const d = await fetchBtc(); if (box) box.innerHTML = btcBox(d); }
    catch { if (box) box.innerHTML = btcBox(cachedMarket()); if (el) toast('Cours indisponible, réessaie dans une minute'); }
  },
  brief: async () => {
    const llm = S().settings.llm;
    const el = $('#brief');
    if (!llm.key) { el.textContent = 'Pour générer le point marché, ajoute une clé Gemini gratuite dans Gérer › IA Gemini.'; return; }
    el.textContent = 'Je consulte les infos du jour…';
    try {
      const res = await geminiAsk({
        key: llm.key, model: llm.model,
        system: 'Tu es un analyste financier pédagogue. Français, tutoiement, mots simples, aucun jargon sans explication. Pas de conseil d\'achat ferme. Cite la date des informations.',
        prompt: 'Fais le point sur les marchés aujourd\'hui pour un jeune investisseur français qui détient un robo-advisor, du Bitcoin et pense à un ETF S&P 500 : S&P 500, CAC 40, Bitcoin, taux/inflation si pertinent. 6 lignes maximum, puis une phrase « Ce que ça change pour toi ».',
      });
      localStorage.setItem('cap.brief', JSON.stringify({ text: res.text, sources: res.sources, ts: Date.now() }));
      render();
    } catch (e) { el.textContent = `Impossible de générer le point marché : ${e.message}`; }
  },
});
bus.refresh = render;
bus.go = (t) => { ui.tab = t; render(); };
export { sendChat, renderCard };
