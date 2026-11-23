// Import du relevé CSV Revolut (en ou fr) → lignes à catégoriser.
import { guessPocket, round2 } from './model.js';

export function parseCSV(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (d) => d.toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùü ]/gi, ' ').replace(/\s+/g, ' ').trim();
export const ruleKey = norm;

export function revolutRows(text, state) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Fichier vide ou illisible.');
  const head = rows[0].map((h) => h.toLowerCase().trim());
  const find = (...res) => head.findIndex((h) => res.some((re) => re.test(h)));
  const iDate = find(/completed date|date de fin|date d'ex|completed/, /started date|date de d[ée]but|date/);
  const iDesc = find(/^description|libell/);
  const iAmt = find(/^(amount|montant)$/);
  const iType = find(/^(type)$/);
  const iState = find(/^(state|[ée]tat|statut)$/);
  if (iDate < 0 || iDesc < 0 || iAmt < 0) throw new Error('Colonnes Date / Description / Montant introuvables : exporte le relevé au format CSV depuis Revolut.');
  const seen = new Set(state.tx.filter((t) => t.key).map((t) => t.key));
  const out = [];
  for (const r of rows.slice(1)) {
    const amt = parseFloat(String(r[iAmt]).replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(amt) || amt >= 0) continue; // on n'importe que les dépenses
    const st = iState >= 0 ? r[iState].toLowerCase() : 'completed';
    if (/revert|declin|refus|annul|fail|pending|attente/.test(st)) continue;
    const type = iType >= 0 ? r[iType].toLowerCase() : '';
    const internal = /transfer|exchange|virement interne|[ée]change/.test(type);
    const date = (r[iDate] ?? '').slice(0, 10).replace(/\//g, '-');
    const desc = (r[iDesc] ?? '').trim();
    const key = `${date}|${Math.abs(amt)}|${desc}`;
    if (seen.has(key)) continue;
    const learned = state.rules[norm(desc)];
    out.push({
      key, date, desc, amount: round2(Math.abs(amt)),
      pocket: learned ?? guessPocket(desc),
      include: !internal,
      internal,
    });
  }
  return out;
}
