// netlify/functions/data.mjs
// GET /api/data — Liefert Snapshot + Schiri-Einteilungen.
// Mit Cache-Control max-age=60: Browser cached die Antwort 60s,
// reduziert Function-Calls pro Nutzer:in auf max. 1/min.

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
        'cache-control': 'public, max-age=60, s-maxage=60',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
