# Mittagessen-Bestellung

Webapplikation, mit der Mitarbeitende ihr Mittagessen bei der Abteilung **Gastronomie** bestellen.
Die Gastronomie sieht in einer geschützten Ansicht alle Bestellungen pro Tag.

## Angebot

| Gericht   | Verfügbar        |
|-----------|------------------|
| Menu      | Montag – Freitag |
| Salatbowl | Montag – Freitag |
| Sandwich  | Montag – Freitag |
| Suppe     | Montag – Freitag |
| Pinsa     | **nur Freitag**  |

## Funktionen

**Mitarbeitende** (`/`)
- Bestellen mit Name, Abteilung, Datum, Gericht, Anzahl und Bemerkung (z. B. Allergien)
- Bestellungen für heute (bis Bestellschluss) und bis zu 4 Wochen im Voraus, nur Werktage
- Pinsa erscheint nur, wenn ein Freitag gewählt ist (wird auch serverseitig geprüft)
- «Meine Bestellungen»: Übersicht und Stornieren bis zum Bestellschluss (auf dem gleichen Gerät)

**Gastronomie** (`/gastro`, passwortgeschützt)
- Tagesübersicht mit Summen pro Gericht und Total
- Liste aller Bestellungen mit Name, Abteilung, Gericht, Anzahl, Bemerkung
- Bestellung als «ausgegeben» abhaken, Bestellungen löschen
- Tagesnavigation, CSV-Export (Excel-kompatibel), Druckansicht
- Automatische Aktualisierung jede Minute

## Starten

Voraussetzung: Node.js ≥ 18. Es werden keine externen Pakete benötigt.

```bash
GASTRO_PASSWORT='sicheres-passwort' npm start
```

Danach im Browser öffnen: <http://localhost:3000> (Bestellung) bzw. <http://localhost:3000/gastro> (Gastronomie).

### Konfiguration (Umgebungsvariablen)

| Variable          | Standard        | Beschreibung                                         |
|-------------------|-----------------|------------------------------------------------------|
| `PORT`            | `3000`          | Port des Webservers                                  |
| `GASTRO_PASSWORT` | `gastro`        | Passwort der Gastronomie-Ansicht – **bitte ändern!** |
| `BESTELLSCHLUSS`  | `10:00`         | Bis wann am gleichen Tag bestellt/storniert werden kann |
| `DATA_DIR`        | `./data`        | Ablageort der Datendatei `bestellungen.json`         |
| `TZ_NAME`         | `Europe/Zurich` | Zeitzone für Datum und Bestellschluss                |

## Tests

```bash
npm test
```

## Hinweise für den Betrieb

- Die Daten liegen in `data/bestellungen.json`; dieses Verzeichnis sollte gesichert werden.
- Im produktiven Einsatz hinter einem Reverse-Proxy mit HTTPS betreiben (z. B. im Intranet).
- Mitarbeitende werden nicht authentifiziert (Name wird frei eingegeben). Für eine Anbindung
  an das Firmen-Login (z. B. Microsoft Entra ID / SSO) kann die App erweitert werden.
