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
    const refs = (await store.get(KEY, { type: 'json' })) ?? {};
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

    const refs = (await store.get(KEY, { type: 'json' })) ?? {};
    const updatedAt = new Date().toISOString();
    if (players.length === 0) {
      delete refs[nr];
    } else {
      refs[nr] = { players, updatedAt };
    }
    await store.setJSON(KEY, refs);

    return new Response(JSON.stringify({ ok: true, refs, updatedAt }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
    status: 404, headers: { 'content-type': 'application/json' },
  });
};
