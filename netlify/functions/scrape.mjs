// netlify/functions/scrape.mjs
// Scheduled Function. Schedule:
//   - Wir lassen den Cron alle 15 Min zwischen 04:00 und 21:00 UTC laufen
//     (= 06:00–23:00 Berlin-Zeit in CEST, Mai 2026).
//   - Außerhalb der Turniertage (Sa 23. / So 24. / Mo 25. Mai 2026) skippen wir
//     im Code alle Aufrufe, die nicht der erste Run des Tages (UTC-Stunde 4) sind.
//
// Empty invocations are essentially free; nur echte Scrapes verbrauchen Bandbreite.

import { getStore } from '@netlify/blobs';
import { buildSnapshot } from '../../scraper/index.mjs';

export const config = {
  schedule: '*/15 4-21 * * *',
};

// Hochfrequenter Scrape-Schedule: Vortag des Turniers (für Spielplan-
// Last-Minute-Änderungen) + die drei eigentlichen Turniertage.
const TOURNAMENT_DAYS_UTC = new Set([
  '2026-05-22', // Freitag (Setup / Last-Minute-Anpassungen)
  '2026-05-23', // Samstag
  '2026-05-24', // Sonntag
  '2026-05-25', // Pfingstmontag
]);

function shouldScrapeNow(now = new Date()) {
  const ymd = now.toISOString().slice(0, 10);
  const isTournament = TOURNAMENT_DAYS_UTC.has(ymd);

  if (isTournament) return { ok: true, reason: 'tournament-day' };

  // Außerhalb der Turniertage: nur 1× pro Tag (erster Run um 04:00 UTC = 06:00 Berlin).
  if (now.getUTCHours() === 4 && now.getUTCMinutes() < 15) {
    return { ok: true, reason: 'daily-first-run' };
  }
  return { ok: false, reason: 'skipped-non-tournament' };
}

export default async (req, ctx) => {
  // Diese Function läuft ausschließlich nach Cron-Schedule.
  // Für manuelles Triggern siehe /netlify/functions/force-scrape.mjs.
  const decision = shouldScrapeNow();
  if (!decision.ok) {
    console.log(`[scrape] skipping: ${decision.reason}`);
    return new Response(JSON.stringify({ skipped: true, reason: decision.reason }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  console.log(`[scrape] running: ${decision.reason}`);
  const t0 = Date.now();

  try {
    const snapshot = await buildSnapshot();
    const store = getStore('dc2026');
    await store.setJSON('snapshot.json', snapshot);
    const dur = Date.now() - t0;
    console.log(`[scrape] success in ${dur}ms · matches=${snapshot.matches.length} · teams=${snapshot.teams.length}`);
    return new Response(JSON.stringify({ ok: true, durationMs: dur, matches: snapshot.matches.length }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error(`[scrape] failed:`, e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
