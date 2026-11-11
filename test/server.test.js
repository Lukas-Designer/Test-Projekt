'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp, angebotFuer, bestellbarkeitPruefen } = require('../server');

// Fixe "Jetzt"-Zeit: Mittwoch, 11.11.2026, 08:00 Uhr Zürich (07:00 UTC)
let jetzt = new Date('2026-11-11T07:00:00Z');
const MITTWOCH = '2026-11-11';
const FREITAG = '2026-11-13';
const SAMSTAG = '2026-11-14';

let server;
let basis;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mittagessen-'));
  const app = createApp({ dataDir, passwort: 'geheim', bestellschluss: '10:00', now: () => jetzt });
  server = app.server;
  await new Promise((r) => server.listen(0, r));
  basis = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body, headers = {}) =>
  fetch(basis + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function anmelden() {
  const res = await post('/api/gastro/login', { passwort: 'geheim' });
  assert.strictEqual(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('Pinsa nur am Freitag im Angebot', () => {
  assert.ok(!angebotFuer(MITTWOCH).some((a) => a.id === 'pinsa'));
  assert.ok(angebotFuer(FREITAG).some((a) => a.id === 'pinsa'));
  assert.deepStrictEqual(angebotFuer(MITTWOCH).map((a) => a.name), ['Menu', 'Salatbowl', 'Sandwich', 'Suppe']);
});

test('Bestellbarkeit: Wochenende, Vergangenheit, Bestellschluss', () => {
  const cfg = { now: () => jetzt, zeitzone: 'Europe/Zurich', bestellschluss: '10:00' };
  assert.strictEqual(bestellbarkeitPruefen(MITTWOCH, cfg), null);
  assert.match(bestellbarkeitPruefen(SAMSTAG, cfg), /Wochenende/);
  assert.match(bestellbarkeitPruefen('2026-11-10', cfg), /Vergangenheit/);
  const spaet = { ...cfg, now: () => new Date('2026-11-11T09:30:00Z') }; // 10:30 Zürich
  assert.match(bestellbarkeitPruefen(MITTWOCH, spaet), /Bestellschluss/);
  assert.strictEqual(bestellbarkeitPruefen('2026-11-12', spaet), null);
});

test('Bestellen, Gastronomie sieht Bestellung, Mitarbeiter storniert', async () => {
  let res = await post('/api/bestellungen', { name: 'Muster Anna', abteilung: 'Pflege', datum: MITTWOCH, gericht: 'salatbowl', bemerkung: 'ohne Nüsse' });
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.ok(b.stornoToken);

  // Ohne Anmeldung kein Zugriff
  res = await fetch(`${basis}/api/gastro/bestellungen?datum=${MITTWOCH}`);
  assert.strictEqual(res.status, 401);

  // Falsches Passwort
  res = await post('/api/gastro/login', { passwort: 'falsch' });
  assert.strictEqual(res.status, 401);

  const cookie = await anmelden();
  res = await fetch(`${basis}/api/gastro/bestellungen?datum=${MITTWOCH}`, { headers: { cookie } });
  const liste = await res.json();
  assert.strictEqual(liste.total, 1);
  assert.strictEqual(liste.bestellungen[0].name, 'Muster Anna');
  assert.strictEqual(liste.bestellungen[0].stornoToken, undefined, 'Token darf nicht an Gastro gehen');
  assert.strictEqual(liste.summen.find((s) => s.gericht === 'salatbowl').anzahl, 1);

  // Fremde dürfen nicht stornieren
  res = await fetch(`${basis}/api/bestellungen/${b.id}`, { method: 'DELETE', headers: { 'X-Storno-Token': 'falsch' } });
  assert.strictEqual(res.status, 403);

  res = await fetch(`${basis}/api/bestellungen/${b.id}`, { method: 'DELETE', headers: { 'X-Storno-Token': b.stornoToken } });
  assert.strictEqual(res.status, 200);
});

test('Pinsa am Mittwoch wird abgelehnt, am Freitag akzeptiert', async () => {
  let res = await post('/api/bestellungen', { name: 'Test', datum: MITTWOCH, gericht: 'pinsa' });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).fehler, /Freitag/);
  res = await post('/api/bestellungen', { name: 'Test', datum: FREITAG, gericht: 'pinsa', anzahl: 2 });
  assert.strictEqual(res.status, 201);
});

test('Validierung: Name fehlt, Wochenende, ungültiges Gericht', async () => {
  assert.strictEqual((await post('/api/bestellungen', { datum: MITTWOCH, gericht: 'menu' })).status, 400);
  assert.strictEqual((await post('/api/bestellungen', { name: 'X', datum: SAMSTAG, gericht: 'menu' })).status, 400);
  assert.strictEqual((await post('/api/bestellungen', { name: 'X', datum: MITTWOCH, gericht: 'pizza' })).status, 400);
});

test('Gastronomie: als ausgegeben markieren und CSV-Export', async () => {
  const res = await post('/api/bestellungen', { name: '=Formel', datum: MITTWOCH, gericht: 'suppe' });
  const b = await res.json();
  const cookie = await anmelden();
  const patch = await fetch(`${basis}/api/gastro/bestellungen/${b.id}`, {
    method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ erledigt: true }),
  });
  assert.strictEqual((await patch.json()).erledigt, true);

  const csv = await (await fetch(`${basis}/api/gastro/export.csv?datum=${MITTWOCH}`, { headers: { cookie } })).text();
  assert.match(csv, /"'=Formel"/);
  assert.match(csv, /"Suppe"/);
});

test('Daten bleiben nach Neustart erhalten', () => {
  const app2 = createApp({ dataDir, now: () => jetzt });
  assert.ok(app2.speicher.fuerDatum(FREITAG).some((b) => b.gericht === 'pinsa'));
});
