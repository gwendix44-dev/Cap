// Seuls appels réseau de l'appli : cours du Bitcoin (CoinGecko, sans clé) et, si tu l'actives, Gemini.
const MKT = 'cap.market.v1';

export function cachedMarket() {
  try { return JSON.parse(localStorage.getItem(MKT)) ?? null; } catch { return null; }
}

export async function fetchBtc() {
  const base = 'https://api.coingecko.com/api/v3';
  const [p, c] = await Promise.all([
    fetch(`${base}/simple/price?ids=bitcoin&vs_currencies=eur&include_24hr_change=true`).then((r) => r.json()),
    fetch(`${base}/coins/bitcoin/market_chart?vs_currency=eur&days=30&interval=daily`).then((r) => r.json()),
  ]);
  const out = {
    ts: Date.now(),
    price: p.bitcoin.eur,
    change24: p.bitcoin.eur_24h_change,
    series: (c.prices ?? []).map((x) => x[1]),
  };
  localStorage.setItem(MKT, JSON.stringify(out));
  return out;
}

export async function gemini({ key, model, system, prompt, history = [], search = false }) {
  if (!key) throw new Error('Ajoute ta clé Gemini dans Gérer › Réglages.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-flash-latest')}:generateContent`;
  const contents = [
    ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: prompt }] },
  ];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5, maxOutputTokens: 900 },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Erreur ${r.status}`);
  const cand = j.candidates?.[0];
  const text = cand?.content?.parts?.map((x) => x.text).filter(Boolean).join('\n');
  if (!text) throw new Error(j.promptFeedback?.blockReason ? 'Question refusée par le modèle.' : 'Réponse vide du modèle.');
  const seen = new Set();
  const sources = (cand.groundingMetadata?.groundingChunks ?? []).map((c) => c.web).filter((w) => w?.uri && !seen.has(w.uri) && seen.add(w.uri)).slice(0, 4).map((w) => ({ title: w.title || 'Source', uri: w.uri }));
  return { text: text.trim(), sources };
}

// Essaie avec la recherche web (actualité) ; si elle échoue, répond sans et le signale.
export async function geminiAsk(opts) {
  try {
    return { ...(await gemini({ ...opts, search: true })), live: true };
  } catch (e) {
    if (/key|API_KEY|permission|quota|429|403|401/i.test(e.message) && !/search|ground|tool/i.test(e.message)) throw e;
    return { ...(await gemini({ ...opts, search: false })), live: false };
  }
}
