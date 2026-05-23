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
    // Strong consistency speziell auf den Schiri-Einteilungen: nach einem
    // POST /api/admin/refs darf das nicht durch eine stale Edge-Replica
    // verzögert sein (Bug "Schiri-Einsätze verschwinden"). Der Snapshot
    // ändert sich nur alle 15 Min und kann eventual consistent bleiben.
    const [snapshot, refs] = await Promise.all([
      store.get('snapshot.json', { type: 'json' }),
      store.get('refereeAssignments.json', { type: 'json', consistency: 'strong' }),
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
        // Browser: minimal cachen (5s) — Polling holt sonst stale Schiri-Daten
        'cache-control': 'public, max-age=5',
        // Netlify Edge: 5s frisch + 60s stale-while-revalidate.
        //
        // Vorher: s-maxage=30. Das war für den Snapshot OK, hat aber bewirkt,
        // dass nach einem POST /api/admin/refs der nächste /api/data-Poll bis
        // zu 30s lang die alten Schiri-Einträge zurückgegeben hat → die App
        // hat den frisch gespeicherten Eintrag im State überschrieben und er
        // sah "verschwunden" aus. 5s ist der Kompromiss zwischen Skalierung
        // (Function wird trotzdem nur ~1× pro 5s GLOBAL aufgerufen) und
        // Frische der Trainer-Eingaben.
        //
        // Zusätzlich: Frontend mergt frisch gespeicherte Einträge gegen die
        // Poll-Antwort (siehe app.js fetchData) — doppelte Sicherheit.
        'netlify-cdn-cache-control': 'public, s-maxage=5, stale-while-revalidate=60',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
