// netlify/functions/data.mjs
// GET /api/data — Liefert Snapshot + Schiri-Einteilungen.
//
// CACHING-STRATEGIE (wichtig für Skalierung mit vielen Nutzern):
//
//   cache-control:          steuert den Browser-Cache (30s)
//   netlify-cdn-cache-control: steuert Netlify's Edge-Cache
//
// Mit s-maxage=30, stale-while-revalidate=300 cached das Netlify-CDN
// die Antwort 30 Sekunden. Egal wie viele Nutzer pollen — die Function
// wird nur ~1× pro 30s GLOBAL aufgerufen, alle anderen Requests bekommen
// die gecachte Antwort direkt vom CDN. Damit skaliert das Setup auch bei
// 100+ gleichzeitigen Nutzern, ohne Function-Credits zu verbrennen.

import { getStore } from '@netlify/blobs';

export default async (req) => {
  try {
    const store = getStore('dc2026');
    const [snapshot, refs] = await Promise.all([
      store.get('snapshot.json', { type: 'json' }),
      store.get('refereeAssignments.json', { type: 'json' }),
    ]);

    const payload = {
      snapshot: snapshot ?? null,
      refereeAssignments: refs ?? {},
      server: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Browser: kurzer Cache (30s) — entlastet uns wenn ein Nutzer mehrfach pollt
        'cache-control': 'public, max-age=30',
        // Netlify Edge: 30s frisch + 5min stale-while-revalidate.
        // Effekt: Function wird nur ~1× pro 30s global aufgerufen,
        // egal wie viele Nutzer parallel die App offen haben.
        'netlify-cdn-cache-control': 'public, s-maxage=30, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
