'use strict';

/**
 * Mittagessen-Bestellung – Server ohne externe Abhängigkeiten.
 *
 * Mitarbeitende bestellen ihr Mittagessen, die Abteilung Gastronomie sieht
 * nach Anmeldung alle Bestellungen pro Tag inkl. Summen pro Gericht.
 *
 * Konfiguration über Umgebungsvariablen:
 *   PORT              Port des Webservers (Standard: 3000)
 *   GASTRO_PASSWORT   Passwort für die Gastronomie-Ansicht (Standard: "gastro")
 *   BESTELLSCHLUSS    Uhrzeit HH:MM, bis wann für den aktuellen Tag bestellt
 *                     bzw. storniert werden kann (Standard: "10:00")
 *   DATA_DIR          Verzeichnis für die Datendatei (Standard: ./data)
 *   TZ_NAME           Zeitzone für Datum/Bestellschluss (Standard: Europe/Zurich)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ANGEBOT = [
  { id: 'menu', name: 'Menu', beschreibung: 'Tagesmenu der Gastronomie' },
  { id: 'salatbowl', name: 'Salatbowl', beschreibung: 'Frische Salatbowl' },
  { id: 'sandwich', name: 'Sandwich', beschreibung: 'Belegtes Sandwich' },
  { id: 'suppe', name: 'Suppe', beschreibung: 'Suppe des Tages' },
  { id: 'pinsa', name: 'Pinsa', beschreibung: 'Pinsa – nur am Freitag', nurFreitag: true },
];

function createConfig(overrides = {}) {
  return {
    port: Number(process.env.PORT) || 3000,
    passwort: process.env.GASTRO_PASSWORT || 'gastro',
    bestellschluss: process.env.BESTELLSCHLUSS || '10:00',
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    zeitzone: process.env.TZ_NAME || 'Europe/Zurich',
    now: () => new Date(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Datum-Hilfsfunktionen                                               */
/* ------------------------------------------------------------------ */

/** Liefert { datum: 'YYYY-MM-DD', zeit: 'HH:MM' } in der konfigurierten Zeitzone. */
function lokaleZeit(date, zeitzone) {
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: zeitzone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const t = Object.fromEntries(teile.map((p) => [p.type, p.value]));
  return { datum: `${t.year}-${t.month}-${t.day}`, zeit: `${t.hour}:${t.minute}` };
}

function istGueltigesDatum(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 0 = Sonntag … 5 = Freitag, 6 = Samstag */
function wochentag(datum) {
  return new Date(`${datum}T12:00:00Z`).getUTCDay();
}

function plusTage(datum, tage) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** Angebot für ein bestimmtes Datum (Pinsa nur freitags). */
function angebotFuer(datum) {
  const freitag = wochentag(datum) === 5;
  return ANGEBOT.filter((a) => !a.nurFreitag || freitag);
}

/**
 * Prüft, ob für das Datum (noch) bestellt/storniert werden darf.
 * Gibt null zurück, wenn ok, sonst eine Fehlermeldung.
 */
function bestellbarkeitPruefen(datum, config) {
  if (!istGueltigesDatum(datum)) return 'Ungültiges Datum.';
  const wt = wochentag(datum);
  if (wt === 0 || wt === 6) return 'Am Wochenende kann nicht bestellt werden.';
  const jetzt = lokaleZeit(config.now(), config.zeitzone);
  if (datum < jetzt.datum) return 'Dieses Datum liegt in der Vergangenheit.';
  if (datum === jetzt.datum && jetzt.zeit >= config.bestellschluss) {
    return `Bestellschluss für heute war um ${config.bestellschluss} Uhr.`;
  }
  if (datum > plusTage(jetzt.datum, 28)) return 'Bestellungen sind höchstens 4 Wochen im Voraus möglich.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Datenhaltung (JSON-Datei)                                           */
/* ------------------------------------------------------------------ */

class Speicher {
  constructor(dataDir) {
    this.datei = path.join(dataDir, 'bestellungen.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.bestellungen = [];
    if (fs.existsSync(this.datei)) {
      this.bestellungen = JSON.parse(fs.readFileSync(this.datei, 'utf8'));
    }
  }

  speichern() {
    const tmp = `${this.datei}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.bestellungen, null, 2));
    fs.renameSync(tmp, this.datei);
  }

  hinzufuegen(b) {
    this.bestellungen.push(b);
    this.speichern();
    return b;
  }

  finden(id) {
    return this.bestellungen.find((b) => b.id === id);
  }

  entfernen(id) {
    this.bestellungen = this.bestellungen.filter((b) => b.id !== id);
    this.speichern();
  }

  fuerDatum(datum) {
    return this.bestellungen
      .filter((b) => b.datum === datum)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  aktualisieren(id, felder) {
    const b = this.finden(id);
    if (!b) return null;
    Object.assign(b, felder);
    this.speichern();
    return b;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP-Hilfsfunktionen                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function json(res, status, daten, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(daten));
}

function fehler(res, status, meldung) {
  json(res, status, { fehler: meldung });
}

function bodyLesen(req) {
  return new Promise((resolve, reject) => {
    let daten = '';
    req.on('data', (chunk) => {
      daten += chunk;
      if (daten.length > 10_000) {
        reject(new Error('zu gross'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(daten ? JSON.parse(daten) : {});
      } catch {
        reject(new Error('ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cookiesLesen(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function sicherVergleichen(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function textBereinigen(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function csvFeld(s) {
  const t = String(s ?? '');
  // Schutz vor Formel-Injektion in Excel
  const sicher = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return `"${sicher.replace(/"/g, '""')}"`;
}

/* ------------------------------------------------------------------ */
/* Anwendung                                                           */
/* ------------------------------------------------------------------ */

function createApp(overrides = {}) {
  const config = createConfig(overrides);
  const speicher = new Speicher(config.dataDir);
  const sitzungen = new Map(); // token -> Ablaufzeit
  const SITZUNGSDAUER = 12 * 60 * 60 * 1000;
  const publicDir = path.join(__dirname, 'public');

  function istGastro(req) {
    const token = cookiesLesen(req).gastro_sitzung;
    if (!token) return false;
    const ablauf = sitzungen.get(token);
    if (!ablauf || ablauf < Date.now()) {
      sitzungen.delete(token);
      return false;
    }
    return true;
  }

  function oeffentlich(b) {
    // Ohne Storno-Token nach aussen
    const { stornoToken, ...rest } = b;
    return rest;
  }

  async function api(req, res, url) {
    const { pathname, searchParams } = url;
    const methode = req.method;

    // --- Angebot & Konfiguration ---------------------------------------
    if (methode === 'GET' && pathname === '/api/angebot') {
      const heute = lokaleZeit(config.now(), config.zeitzone);
      const datum = searchParams.get('datum') || heute.datum;
      if (!istGueltigesDatum(datum)) return fehler(res, 400, 'Ungültiges Datum.');
      return json(res, 200, {
        datum,
        heute: heute.datum,
        bestellschluss: config.bestellschluss,
        angebot: angebotFuer(datum),
        bestellbar: bestellbarkeitPruefen(datum, config) === null,
        hinweis: bestellbarkeitPruefen(datum, config),
      });
    }

    // --- Bestellung aufgeben -------------------------------------------
    if (methode === 'POST' && pathname === '/api/bestellungen') {
      const body = await bodyLesen(req);
      const name = textBereinigen(body.name, 80);
      const abteilung = textBereinigen(body.abteilung, 80);
      const bemerkung = textBereinigen(body.bemerkung, 200);
      const datum = String(body.datum || '');
      const gerichtId = String(body.gericht || '');
      const anzahl = Number(body.anzahl ?? 1);

      if (!name) return fehler(res, 400, 'Bitte Namen angeben.');
      if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 10) {
        return fehler(res, 400, 'Anzahl muss zwischen 1 und 10 liegen.');
      }
      const problem = bestellbarkeitPruefen(datum, config);
      if (problem) return fehler(res, 400, problem);
      const gericht = angebotFuer(datum).find((a) => a.id === gerichtId);
      if (!gericht) {
        if (gerichtId === 'pinsa') return fehler(res, 400, 'Pinsa gibt es nur am Freitag.');
        return fehler(res, 400, 'Bitte ein gültiges Gericht wählen.');
      }

      const bestellung = speicher.hinzufuegen({
        id: crypto.randomUUID(),
        stornoToken: crypto.randomBytes(16).toString('hex'),
        datum,
        name,
        abteilung,
        gericht: gericht.id,
        gerichtName: gericht.name,
        anzahl,
        bemerkung,
        erledigt: false,
        erstelltAm: config.now().toISOString(),
      });
      return json(res, 201, { ...oeffentlich(bestellung), stornoToken: bestellung.stornoToken });
    }

    // --- Eigene Bestellungen abfragen (per Storno-Token) ---------------
    if (methode === 'POST' && pathname === '/api/meine-bestellungen') {
      const body = await bodyLesen(req);
      const tokens = Array.isArray(body.tokens) ? body.tokens.slice(0, 200).map(String) : [];
      const map = new Map(tokens.map((t) => [t, true]));
      const heute = lokaleZeit(config.now(), config.zeitzone).datum;
      const liste = speicher.bestellungen
        .filter((b) => map.has(b.stornoToken) && b.datum >= heute)
        .sort((a, b) => a.datum.localeCompare(b.datum))
        .map((b) => ({ ...oeffentlich(b), stornoToken: b.stornoToken, stornierbar: bestellbarkeitPruefen(b.datum, config) === null }));
      return json(res, 200, liste);
    }

    // --- Bestellung stornieren (Mitarbeitende) -------------------------
    const stornoMatch = pathname.match(/^\/api\/bestellungen\/([\w-]+)$/);
    if (methode === 'DELETE' && stornoMatch) {
      const b = speicher.finden(stornoMatch[1]);
      if (!b) return fehler(res, 404, 'Bestellung nicht gefunden.');
      const token = req.headers['x-storno-token'];
      if (istGastro(req)) {
        speicher.entfernen(b.id);
        return json(res, 200, { ok: true });
      }
      if (!token || !sicherVergleichen(token, b.stornoToken)) {
        return fehler(res, 403, 'Keine Berechtigung, diese Bestellung zu stornieren.');
      }
      const problem = bestellbarkeitPruefen(b.datum, config);
      if (problem) return fehler(res, 400, `Stornieren nicht mehr möglich: ${problem}`);
      speicher.entfernen(b.id);
      return json(res, 200, { ok: true });
    }

    // --- Gastronomie: Anmeldung ----------------------------------------
    if (methode === 'POST' && pathname === '/api/gastro/login') {
      const body = await bodyLesen(req);
      if (!sicherVergleichen(body.passwort || '', config.passwort)) {
        return fehler(res, 401, 'Falsches Passwort.');
      }
      const token = crypto.randomBytes(32).toString('hex');
      sitzungen.set(token, Date.now() + SITZUNGSDAUER);
      return json(res, 200, { ok: true }, {
        'Set-Cookie': `gastro_sitzung=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SITZUNGSDAUER / 1000}`,
      });
    }

    if (methode === 'POST' && pathname === '/api/gastro/logout') {
      sitzungen.delete(cookiesLesen(req).gastro_sitzung);
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'gastro_sitzung=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    if (methode === 'GET' && pathname === '/api/gastro/status') {
      return json(res, 200, { angemeldet: istGastro(req) });
    }

    // --- Gastronomie: geschützte Endpunkte -----------------------------
    if (pathname.startsWith('/api/gastro/')) {
      if (!istGastro(req)) return fehler(res, 401, 'Bitte als Gastronomie anmelden.');

      if (methode === 'GET' && pathname === '/api/gastro/bestellungen') {
        const datum = searchParams.get('datum') || lokaleZeit(config.now(), config.zeitzone).datum;
        if (!istGueltigesDatum(datum)) return fehler(res, 400, 'Ungültiges Datum.');
        const liste = speicher.fuerDatum(datum).map(oeffentlich);
        const summen = angebotFuer(datum).map((a) => ({
          gericht: a.id,
          name: a.name,
          anzahl: liste.filter((b) => b.gericht === a.id).reduce((s, b) => s + b.anzahl, 0),
        }));
        return json(res, 200, {
          datum,
          bestellungen: liste,
          summen,
          total: summen.reduce((s, x) => s + x.anzahl, 0),
        });
      }

      if (methode === 'GET' && pathname === '/api/gastro/export.csv') {
        const datum = searchParams.get('datum') || lokaleZeit(config.now(), config.zeitzone).datum;
        if (!istGueltigesDatum(datum)) return fehler(res, 400, 'Ungültiges Datum.');
        const zeilen = [['Datum', 'Name', 'Abteilung', 'Gericht', 'Anzahl', 'Bemerkung', 'Erledigt', 'Bestellt am']];
        for (const b of speicher.fuerDatum(datum)) {
          zeilen.push([b.datum, b.name, b.abteilung, b.gerichtName, b.anzahl, b.bemerkung, b.erledigt ? 'ja' : 'nein', b.erstelltAm]);
        }
        const csv = '﻿' + zeilen.map((z) => z.map(csvFeld).join(';')).join('\r\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="bestellungen-${datum}.csv"`,
          'Cache-Control': 'no-store',
        });
        return res.end(csv);
      }

      const erledigtMatch = pathname.match(/^\/api\/gastro\/bestellungen\/([\w-]+)$/);
      if (methode === 'PATCH' && erledigtMatch) {
        const body = await bodyLesen(req);
        const b = speicher.aktualisieren(erledigtMatch[1], { erledigt: Boolean(body.erledigt) });
        if (!b) return fehler(res, 404, 'Bestellung nicht gefunden.');
        return json(res, 200, oeffentlich(b));
      }
    }

    return fehler(res, 404, 'Nicht gefunden.');
  }

  function statisch(req, res, pathname) {
    let datei = pathname === '/' ? '/index.html' : pathname;
    if (datei === '/gastro') datei = '/gastro.html';
    const voll = path.normalize(path.join(publicDir, datei));
    if (!voll.startsWith(publicDir + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(voll, (err, inhalt) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Seite nicht gefunden');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(voll)] || 'application/octet-stream' });
      res.end(inhalt);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return fehler(res, 405, 'Methode nicht erlaubt.');
      return statisch(req, res, url.pathname);
    } catch (err) {
      if (!res.headersSent) fehler(res, 400, err.message || 'Fehlerhafte Anfrage.');
    }
  });

  return { server, config, speicher };
}

if (require.main === module) {
  const { server, config } = createApp();
  server.listen(config.port, () => {
    console.log(`Mittagessen-Bestellung läuft auf http://localhost:${config.port}`);
    console.log(`Gastronomie-Ansicht: http://localhost:${config.port}/gastro`);
    if (!process.env.GASTRO_PASSWORT) {
      console.warn('WARNUNG: Standard-Passwort "gastro" aktiv. Bitte GASTRO_PASSWORT setzen!');
    }
  });
}

module.exports = { createApp, angebotFuer, bestellbarkeitPruefen, lokaleZeit, ANGEBOT };
