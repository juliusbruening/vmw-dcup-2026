# VMW Deutschland Cup 2026 — Live

Schlanke Web-App, die den **Deutschland Cup 2026** (Kanupolo) für **VMW Berlin** spiegelt.
Quelle: `cpt.kayakers.nl/DC2026`. Hosting: Netlify Free Tier.

- **Scraper**: Node + cheerio (kein Headless-Browser nötig — kayakers.nl ist server-rendered)
- **Storage**: Netlify Blobs (snapshot + Schiri-Einteilungen)
- **Frontend**: Statisches HTML/CSS/JS, mobile-first, in VMW-Rot
- **Scheduled Function**: alle 15 Min, 06:00–23:00 Berlin-Zeit, **nur an Turniertagen** scraped tatsächlich. An anderen Tagen 1× pro Tag (Logik im Code).

## Projektstruktur

```
vmw-dc2026-live/
├── netlify.toml
├── package.json
├── netlify/functions/
│   ├── scrape.mjs              # Scheduled Function (Cron + Date-Logik)
│   ├── force-scrape.mjs        # Manueller Owner-Trigger (nur via Netlify-Dashboard)
│   ├── data.mjs                # GET /api/data (Cache-Control max-age=60)
│   └── admin.mjs               # POST /api/admin/refs (Passwortgeschützt)
├── scraper/
│   ├── fetch.mjs               # HTTP-Wrapper mit User-Agent + Retry
│   ├── parseMatchList.mjs      # Spielplan-Parser (3 Tage)
│   ├── parseTeam.mjs           # Team-Detail-Parser (Roster + Tabelle)
│   └── index.mjs               # Orchestrator (Snapshot bauen)
├── public/
│   ├── index.html              # Single-Page-App
│   ├── style.css               # VMW-Theme
│   ├── app.js                  # Vanilla-JS, pollt /api/data alle 60s
│   └── manifest.webmanifest    # Home-Screen-Manifest
├── scripts/
│   ├── scrapeOnce.mjs          # Lokal einmal scrapen → public/data.json
│   └── serveLocal.mjs          # Mini-Static-Server für offline-Tests
└── README.md
```

## Lokal testen (ohne Netlify)

```bash
npm install
npm run scrape:once     # Holt aktuelle Daten von kayakers.nl → public/data.json
npm run preview         # Static-Server auf http://localhost:5173
```

Der lokale Server mappt `/api/data` direkt auf `public/data.json`. Damit testest du
das Frontend gegen einen echten Snapshot, ohne die Netlify-Functions zu brauchen.

> Hinweis: Der Admin-Bereich braucht die echten Netlify Functions (Login-Endpunkt).
> Für lokale Admin-Tests siehe Abschnitt "Netlify CLI" unten.

## Deployment auf Netlify

### Erstes Setup

1. **Repo anlegen**: Inhalt dieses Ordners in ein neues GitHub-Repo pushen
   (z.B. `juliusbruening/vmw-dc2026-live`).
2. **Netlify-Account**: bei [netlify.com](https://netlify.com) anmelden (Free Tier reicht).
3. **Site importieren**: "Add new site" → "Import an existing project" → GitHub → Repo auswählen.
4. **Build-Settings** sind in `netlify.toml` vorgegeben (publish = `public`, functions = `netlify/functions`).
5. **Environment-Variable setzen**: in Netlify unter
   *Site settings → Environment variables*:
   - `ADMIN_PASSWORD` = `<dein gewähltes Trainer-Passwort>`
6. **Deploy**. Beim ersten Build erkennt Netlify die Scheduled Function automatisch
   und richtet den Cron ein.

### Erste Daten (manueller Trigger)

Nach dem ersten erfolgreichen Cron-Lauf sind die Daten im Blobs-Store. Wenn du
direkt nach dem Deploy testen willst, statt aufs Cron zu warten, gibt es eine
**dedizierte Owner-Only-Function** `force-scrape`.

Sie ist:
- **nicht im Cron-Schedule** (läuft nicht automatisch),
- **nirgendwo in der App verlinkt**,
- **nicht über `/api/*` erreichbar** (nur unter `/.netlify/functions/force-scrape`),
- **passwort-geschützt** durch `ADMIN_PASSWORD`.

**Trigger über Netlify-Dashboard** (das einfachste, kein curl nötig):

1. Bei Netlify einloggen
2. Site auswählen → *Functions* → `force-scrape`
3. Auf **"Test function"** klicken
4. In den Request-Settings ein Header-Feld hinzufügen:
   - Name: `x-admin-password`
   - Value: dein `ADMIN_PASSWORD`
5. Auf **"Send"** klicken
6. Du siehst die Response wie `{ "ok": true, "matches": 96, "teams": 5, … }`

Danach ist `snapshot.json` im Blobs-Store, die App zeigt die Daten beim nächsten
60s-Poll automatisch an.

**Alternativ per curl** (falls Terminal lieber):
```bash
curl -X POST "https://<deine-site>.netlify.app/.netlify/functions/force-scrape" \
  -H "x-admin-password: <dein ADMIN_PASSWORD>"
```

Der reguläre Cron läuft danach automatisch nach Schedule (alle 15 Min an
Turniertagen, 1× pro Tag an anderen Tagen um 06:00 Berlin).

### Custom Domain (optional)

Standardmäßig läuft die Seite unter `<random>.netlify.app`.
Für z.B. `dc2026.vmw-berlin.de`:

1. In Netlify unter *Domain management* → *Add custom domain*
2. Beim Domain-Provider einen `CNAME` auf `<site>.netlify.app` setzen
3. Netlify stellt automatisch ein Let's-Encrypt-Zertifikat aus

## Architektur

```
[cpt.kayakers.nl/DC2026]
        │ alle 15 Min, Sa–Mo 23.–25. Mai 2026, 06–23 Berlin-Zeit
        │ (außerhalb Turnier: 1× pro Tag)
        ▼
[netlify/functions/scrape.mjs]
        │ schreibt snapshot.json
        ▼
[Netlify Blobs Store "dc2026"]
        │ liest
        ▼
[netlify/functions/data.mjs]   ← GET /api/data (Cache-Control: max-age=60)
[netlify/functions/admin.mjs]  ← POST /api/admin/refs (Passwort-Header)
        │
        ▼
[public/index.html]            (statisches Frontend, pollt /api/data alle 60s)
```

### Was wir scrapen

Pro Cron-Lauf 8 HTTP-Requests:
- 3× `/MatchList/DC2026?day={1,2,3}` (Spielplan pro Tag)
- 5× `/Team?id=...&tid=...` (VMW U14, U16, U21, Damen, Herren — Roster + Gruppentabelle)

### Was im Blob landet

Zwei Keys im Store `dc2026`:

- **`snapshot.json`** — vom Scraper geschrieben. Enthält `matches[]` (alle 3 Tage) und `teams[]` (5 VMW-Teams mit Roster + Gruppentabelle).
- **`refereeAssignments.json`** — vom Admin-Endpunkt geschrieben. Map `matchNr → { players, updatedAt }`.

## Schiri-Einteilung (Admin)

Trainer:innen klicken oben rechts aufs Zahnrad und melden sich mit dem
`ADMIN_PASSWORD` an. Das Passwort wird in `localStorage` gespeichert und bei
jedem Schreib-Request als `x-admin-password`-Header mitgeschickt.

- Liste zeigt nur **künftige** VMW-Schiri-Einsätze
- Filter nach Team
- Eingabe: Vornamen, kommagetrennt
- Speichern → grüner "✓ Gespeichert"-Button für 2 Sek, "✓ Eingeteilt"-Marker dauerhaft
- Eingetragene Namen erscheinen sofort öffentlich in **VMW Live**, **Spielplan** und **Teams**

## Quellen-Fairness

- Honester `User-Agent` mit Verweis auf VMW Berlin
- Aggressives Caching (15-Min-Snapshots), kein Live-Hammering der Quelle
- Frontend cached `/api/data` für 60s → Server kriegt pro Nutzer:in max. 1 Hit/min
- Außerhalb der Turniertage nur 1× scrape pro Tag (Mo–Fr-Schonzeit)

## Was wenn kayakers.nl ihr HTML ändert?

Die Parser zielen auf stabile Tabellen-Strukturen (Spalten-Reihenfolge).
Bei strukturellen Änderungen sieht man das in der App daran, dass Felder leer bleiben
oder der Status auf "alle Spiele eingeklappt" springt. In den Netlify-Function-Logs
steht der Fehler. Reparatur = Selektoren in `scraper/parse*.mjs` nachziehen, deployen.

## Lizenz

Privat / Vereinszweck. Daten sind Eigentum des DKV / der jeweiligen Veranstalter.
