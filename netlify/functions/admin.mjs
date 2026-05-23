// netlify/functions/admin.mjs
// POST /api/admin/refs — Trainer-Endpunkt für Schiri-Einteilung.
// Auth: Header `x-admin-password` muss mit env ADMIN_PASSWORD übereinstimmen.
//
// Body:
//   { matchNr: <number>, players: <string[]> }    // setzen / leer => entfernen
//   { matchNr: <number>, players: [] }            // entfernen
//
// Antwort: { ok: true, refs: <komplette Map>, updatedAt }

import { getStore } from '@netlify/blobs';

const STORE = 'dc2026';
const KEY   = 'refereeAssignments.json';

function unauthorized(msg = 'Unauthorized') {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

export default async (req) => {
  const url = new URL(req.url);

  // CORS-Vorflug für Same-Site nicht nötig, aber wir lassen es ruhig:
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin':  '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,x-admin-password',
      },
    });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response(JSON.stringify({ ok: false, error: 'ADMIN_PASSWORD not set on server' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  const provided = req.headers.get('x-admin-password');
  if (!provided || provided !== expected) return unauthorized();

  const path = url.pathname.replace(/^\/api\/admin\//, '').replace(/^\/.netlify\/functions\/admin\//, '');

  // POST /api/admin/login  → Passwortcheck als Login-Test
  if (req.method === 'POST' && path === 'login') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const store = getStore(STORE);

  // GET /api/admin/refs  → liefert aktuelle Schiri-Map
  if (req.method === 'GET' && path === 'refs') {
    // Strong consistency: liest aus der Quelle, nicht aus dem ggf. veralteten
    // Edge-Replica. Wichtig direkt nach einem Save, damit der Client sieht
    // was er gerade geschrieben hat.
    const refs = (await store.get(KEY, { type: 'json', consistency: 'strong' })) ?? {};
    return new Response(JSON.stringify({ ok: true, refs }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // POST /api/admin/refs  → upsert
  if (req.method === 'POST' && path === 'refs') {
    let body;
    try { body = await req.json(); } catch { body = null; }
    const nr = Number(body?.matchNr);
    const players = Array.isArray(body?.players) ? body.players.filter(Boolean) : [];
    if (!Number.isFinite(nr)) {
      return new Response(JSON.stringify({ ok: false, error: 'matchNr required' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }

    // ─── Race-condition-Schutz ──────────────────────────────────────────
    // Bisheriger Code: get → in-memory mutieren → setJSON. Da Netlify Blobs
    // standardmäßig eventually consistent liest, konnten zwei Trainer, die
    // kurz nacheinander Einträge für UNTERSCHIEDLICHE Matches gespeichert
    // haben, sich gegenseitig überschreiben:
    //
    //   A: get() → {}, mutate {1: …}, set() → {1: …}        OK
    //   B: get() → {} (stale, A's write noch nicht repliziert),
    //      mutate {2: …}, set() → {2: …}                    ❌ A's Eintrag weg
    //
    // Maßnahmen:
    //   1. Read mit consistency: 'strong' → kein stale read mehr.
    //   2. Optimistic-Retry-Loop mit Post-Write-Verification: nach setJSON
    //      lesen wir mit strong consistency zurück. Stimmt unser Eintrag
    //      überein, sind wir fertig. Falls nicht (anderer Writer kam dazwischen),
    //      mergen wir und schreiben nochmal. Max. 3 Versuche.
    //   3. Diagnostisches Logging (Match-Nr, Versuch, Resultat) — landet im
    //      Function-Log auf Netlify und macht den Bug ggf. nachvollziehbar.
    const updatedAt = new Date().toISOString();
    const reqId = Math.random().toString(36).slice(2, 8);
    let refs = null;
    let success = false;
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts && !success) {
      attempt++;
      refs = (await store.get(KEY, { type: 'json', consistency: 'strong' })) ?? {};

      if (players.length === 0) {
        delete refs[nr];
      } else {
        refs[nr] = { players, updatedAt };
      }

      await store.setJSON(KEY, refs);

      // Verify: re-read strong-consistent und prüfen ob unser Eintrag drin ist
      const verify = (await store.get(KEY, { type: 'json', consistency: 'strong' })) ?? {};
      const entry = verify[nr];

      const expected = players.length === 0 ? null : players.join('|');
      const actual   = entry?.players ? entry.players.join('|') : null;

      if (expected === actual) {
        success = true;
        refs = verify;
        console.log(`[admin/refs] ${reqId} nr=${nr} attempt=${attempt} OK players=${players.length}`);
      } else {
        // Race condition: anderer Writer hat dazwischen geschrieben. Merge unsere
        // gewünschte Änderung in den frisch gelesenen Stand und retry.
        console.warn(`[admin/refs] ${reqId} nr=${nr} attempt=${attempt} MISMATCH expected="${expected}" actual="${actual}" — retrying`);
        refs = verify;
      }
    }

    if (!success) {
      console.error(`[admin/refs] ${reqId} nr=${nr} FAILED after ${maxAttempts} attempts`);
      return new Response(JSON.stringify({
        ok: false,
        error: 'write_conflict',
        message: 'Konnte nach 3 Versuchen nicht speichern (paralleler Schreibzugriff). Bitte erneut versuchen.',
      }), { status: 409, headers: { 'content-type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, refs, updatedAt }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
    status: 404, headers: { 'content-type': 'application/json' },
  });
};
