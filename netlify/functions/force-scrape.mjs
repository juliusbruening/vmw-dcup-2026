// netlify/functions/force-scrape.mjs
// Owner-Only manueller Trigger für einen Scrape.
//
// Hat KEINEN Cron-Schedule und ist in der App nirgendwo verlinkt. Trigger nur:
//  1) Über das Netlify-Dashboard:
//       Site → Functions → force-scrape → "Test function"
//       Header hinzufügen: x-admin-password: <ADMIN_PASSWORD>
//       Send
//  2) Per curl, falls bevorzugt:
//       curl -X POST "https://<site>.netlify.app/.netlify/functions/force-scrape" \
//            -H "x-admin-password: <ADMIN_PASSWORD>"
//
// Es gibt KEINEN /api/* Redirect auf diese Function — die URL ist nur unter
// /.netlify/functions/force-scrape erreichbar. Plus Passwort-Header → niemand
// kann das versehentlich oder unautorisiert auslösen.

import { getStore } from '@netlify/blobs';
import { buildSnapshot } from '../../scraper/index.mjs';

export default async (req) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: 'ADMIN_PASSWORD not configured on server' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
  const provided = req.headers.get('x-admin-password');
  if (!provided || provided !== expected) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unauthorized — x-admin-password header missing or wrong' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }

  console.log('[force-scrape] manual trigger by owner — starting…');
  const t0 = Date.now();
  try {
    const snapshot = await buildSnapshot();
    const store = getStore('dc2026');
    await store.setJSON('snapshot.json', snapshot);
    const dur = Date.now() - t0;
    console.log(`[force-scrape] done in ${dur}ms · ${snapshot.matches.length} matches · ${snapshot.teams.length} teams`);
    return new Response(JSON.stringify({
      ok: true,
      durationMs: dur,
      lastUpdated: snapshot.lastUpdated,
      matches: snapshot.matches.length,
      teams: snapshot.teams.length,
    }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('[force-scrape] failed:', e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
