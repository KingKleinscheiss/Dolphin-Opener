# Dolphin Opener

Lokale Web-App, die Dolphin{anty}-Profile tag-/ordnerbasiert öffnet, dabei
einen Pool von 10 gleichwertigen Proxies (8 "primär" + 2 Ersatz) verwaltet
und eine feste Anzahl an Browser-Fenstern als "Slots" im Hintergrund
vorbereitet, während ein sichtbarer Vordergrund-Satz abgearbeitet wird.

Läuft komplett lokal pro Rechner (zuhause/Büro jeweils eine eigene Instanz) –
siehe `/root/.claude/plans/ich-m-chte-ein-tool-rustling-lightning.md` für den
ursprünglichen Architektur-Plan.

## ⚠️ Wichtig: unverifizierte Dolphin-Anty-API-Annahmen

Dieses Projekt wurde **ohne Zugriff auf eine echte laufende Dolphin-Anty-App**
gebaut. Alle Endpunkt-Pfade/Feldnamen in `src/dolphin/types.ts` und
`src/dolphin/client.ts` sind mit `VERIFY`-Kommentaren markiert und müssen
**einmalig** gegen die echte, lokal laufende Dolphin-Anty-App geprüft werden,
bevor ein echter Lauf gestartet wird. Siehe Abschnitt "API-Erkundung" unten.

## Setup

Voraussetzung: Node.js 20+ (getestet mit Node 22), Dolphin Anty lokal
installiert und die Local API aktiviert.

```bash
npm install
cp data/config.example.json data/config.json
```

In `data/config.json` (oder später bequem über die UI unter "Dolphin-Anty-Verbindung"
und "Proxy-Einstellungen bearbeiten"):

- `dolphin.baseUrl` — die lokale Dolphin-Anty-API-URL (Standard-Annahme:
  `http://localhost:3001/v1.0`, siehe Verifikationsschritt unten).
- `dolphin.token` — falls deine Dolphin-Anty-Installation einen API-Token
  verlangt.
- `proxies` — alle 10 Proxies (8 primär + 2 Ersatz, alle gleichwertig). Für
  jeden: `changeIpUrl` (IP-Reset-Link, siehe unten) und entweder
  `dolphinProxyId` (wenn Dolphin Proxies als eigene, referenzierbare
  Objekte verwaltet) oder `host`/`port`/`login`/`password` (falls Dolphin
  volle Zugangsdaten pro Profil erwartet).

## Starten

```bash
npm run dev
```

Öffnet den Vite-Dev-Server auf `http://localhost:5173` (proxyt `/api` und
`/ws` automatisch zum Backend auf Port 4545).

Für einen produktionsnahen Lauf auf einem festen Rechner:

```bash
npm run build
npm start
```

Danach ist die komplette App unter `http://localhost:4545` erreichbar
(Backend liefert das gebaute Frontend selbst mit aus).

## API-Erkundung (einmalig vor dem ersten echten Lauf)

Mit laufender Dolphin-Anty-Desktop-App und aktivierter Local API:

1. `curl http://localhost:3001/v1.0/browser_profiles` — Pfad/Port/Version
   bestätigen, Antwortform inspizieren (insb. `tags`, `folder`, `proxy`
   pro Profil).
2. Ein Profil mit bereits in der GUI gesetztem Proxy abfragen:
   `curl http://localhost:3001/v1.0/browser_profiles/<id>` — das `proxy`-
   Feld genau ansehen: enthält es eine `changeIpUrl`-ähnliche Eigenschaft?
   Ist der Proxy durch eine ID referenziert oder mit vollen Zugangsdaten
   eingebettet?
3. Testweise `PATCH http://localhost:3001/v1.0/browser_profiles/<id>` mit
   geändertem `proxy`-Feld senden, danach erneut `GET` — bleibt die Änderung
   erhalten? Das beantwortet die zentrale Annahme in
   `DolphinClient.setProfileProxy`.
4. `GET http://localhost:3001/v1.0/browser_profiles/<id>/start?automation=1`
   einmal aufrufen und das Antwortformat für den CDP-Endpoint (WebSocket-URL)
   notieren.
5. Gefundene Feldnamen in `src/dolphin/types.ts` und `src/dolphin/client.ts`
   anpassen (dort stehen an jeder betroffenen Stelle `VERIFY`-Kommentare).

## CDP-Fenster-Spike (einmalig, auf jedem Zielrechner)

Bevor der volle Lauf mit vielen parallelen Hintergrund-Fenstern vertraut
wird: ein Profil über die App starten/beobachten und prüfen, ob
`WindowController.moveOffscreen()` (Standard-Hintergrund-Strategie, siehe
`src/cdp/windowController.ts`) auf dem jeweiligen Betriebssystem/Window-
Manager wirklich nie kurz aufblitzt oder den Fokus stiehlt. Falls doch,
`minimizeState()` als Alternative ausprobieren (dafür Zeile in
`scheduler.ts`, Aufruf von `moveOffscreen`, durch `minimizeState` ersetzen).

## Bedienung

1. Dolphin-Anty-Verbindung (Local-API-URL/Token) und Proxies einmalig unter
   den jeweiligen "Einstellungen"-Panels speichern.
2. Ziel-Domain eintragen, Filter-Modus (Tags/Ordner/Beides) wählen, Tags
   bzw. Ordner auswählen.
3. Slot-Anzahl (Standard 10 = alle Proxies) und Vordergrund-Größe (Standard 4)
   setzen.
4. "Lauf starten" — die ersten `foregroundCount` Profile werden sichtbar
   geöffnet, der Rest bereitet sich im Hintergrund vor (Proxy-Reset läuft,
   das dauert bewusst — die sichtbaren Profile halten dich in der
   Zwischenzeit beschäftigt).
5. Schließt du ein sichtbares Profil-Fenster, rutscht automatisch das
   nächste bereite Hintergrund-Fenster nach vorne (ohne den Fokus
   aufzuzwingen — du wechselst per Alt-Tab), und der freigewordene Slot
   beginnt sofort, das nächste Profil aus der Warteschlange im Hintergrund
   vorzubereiten.
6. Ein dauerhaft ausgefallener Proxy wird rot markiert ("Retry"-Knopf nach
   Behebung); die Pipeline läuft mit den verbleibenden Proxies einfach
   weiter — kein Neustart nötig.

## Tests

```bash
npm test          # Vitest: ProxyPool- und Scheduler-Logik gegen Mocks/Fakes
npm run typecheck # TypeScript-Check für Backend, Tests und Frontend
```

Die Tests laufen komplett gegen `FakeDolphinClient`/`FakeWindowController`
(`test/fixtures/`) — kein echtes Dolphin Anty oder echter Browser nötig.
Abgedeckt sind u. a.: Proxy stirbt während Reset (Pipeline läuft mit
kleinerem Pool weiter), alle Proxies belegt (Slot wartet, füllt sich beim
nächsten frei werdenden Proxy), Warteschlange leer während Slots noch
laufen (Lauf beendet sich erst, wenn wirklich alles fertig ist), Vordergrund
schließt ohne bereiten Hintergrund-Slot (kein Crash), doppeltes
Schließungs-Signal auf denselben Slot (idempotent).

## Projektstruktur

```
src/
  domain/types.ts        Proxy/Profile/Slot/RunConfig + Zustandsautomaten
  dolphin/client.ts       Dolphin-Anty-API-Client (Endpunkte VERIFY-markiert)
  proxy/pool.ts            Proxy-Lebenszyklus, Reset, Dead-Handling
  scheduler/               Warteschlange + Slot-Pipeline (Kernlogik)
  cdp/windowController.ts  CDP-Fenstersteuerung (Hintergrund ohne Fokus-Diebstahl)
  server/                  Fastify-REST-Routen + WebSocket-Broadcast
  config/store.ts          Persistierte Einstellungen (data/config.json)
frontend/                  Ein-Seiten-UI (Vite + Vanilla TS)
test/                      Vitest-Suiten + Fakes/Fixtures
```

## Bekannte Grenzen / mögliche nächste Schritte

- Proxy-Zugangsdaten liegen unverschlüsselt in `data/config.json` (lokal,
  gitignored) — angemessen für ein lokales Einzelnutzer-Tool, aber kein
  Secret-Store.
- Schließungs-Erkennung verlässt sich primär auf den CDP-`disconnected`-
  Event; ein zusätzlicher Status-Poll-Backstop über
  `DolphinClient.getProfileStatus` ist vorbereitet, aber noch nicht in den
  Scheduler verdrahtet — bei Bedarf ergänzen, falls CDP-Events in der Praxis
  unzuverlässig sind.
- Ein Profil, das wiederholt (> 3×) beim Start fehlschlägt, wird
  übersprungen statt endlos wiederholt — in der UI taucht es dann einfach
  nicht mehr in der Warteschlange auf; für produktive Nutzung ggf. eine
  sichtbare "fehlgeschlagene Profile"-Liste ergänzen.
