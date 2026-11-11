'use strict';

const $ = (id) => document.getElementById(id);
let heuteServer = null;
let timer = null;

async function anfrage(url, optionen = {}) {
  const res = await fetch(url, {
    ...optionen,
    headers: { 'Content-Type': 'application/json', ...(optionen.headers || {}) },
  });
  const daten = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/login')) {
    zeigeAnmeldung();
    throw new Error(daten.fehler || 'Nicht angemeldet');
  }
  if (!res.ok) throw new Error(daten.fehler || 'Unbekannter Fehler');
  return daten;
}

function datumFormatieren(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('de-CH', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function werktagVerschieben(iso, richtung) {
  const d = new Date(`${iso}T12:00:00`);
  do { d.setDate(d.getDate() + richtung); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().slice(0, 10);
}

function zeigeAnmeldung() {
  clearInterval(timer);
  $('anmeldung').classList.remove('versteckt');
  $('uebersicht').classList.add('versteckt');
  $('abmelden').classList.add('versteckt');
  $('passwort').focus();
}

function zeigeUebersicht() {
  $('anmeldung').classList.add('versteckt');
  $('uebersicht').classList.remove('versteckt');
  $('abmelden').classList.remove('versteckt');
  laden();
  clearInterval(timer);
  timer = setInterval(laden, 60_000);
}

function zelle(text) {
  const td = document.createElement('td');
  td.textContent = text ?? '';
  return td;
}

async function laden() {
  const datum = $('datum').value;
  if (!datum) return;
  $('export').href = `/api/gastro/export.csv?datum=${encodeURIComponent(datum)}`;
  let daten;
  try {
    daten = await anfrage(`/api/gastro/bestellungen?datum=${encodeURIComponent(datum)}`);
  } catch (err) {
    console.error(err);
    return;
  }

  $('titel').textContent = `Bestellungen für ${datumFormatieren(daten.datum)}`;

  const summen = $('summen');
  summen.replaceChildren();
  const kachel = (zahl, bez, extra = '') => {
    const div = document.createElement('div');
    div.className = `summe ${extra}`;
    const z = document.createElement('div');
    z.className = 'zahl';
    z.textContent = zahl;
    const b = document.createElement('div');
    b.className = 'bez';
    b.textContent = bez;
    div.append(z, b);
    return div;
  };
  summen.append(kachel(daten.total, 'Total', 'total'));
  for (const s of daten.summen) summen.append(kachel(s.anzahl, s.name));

  const tbody = $('tabelle');
  tbody.replaceChildren();
  $('leer').classList.toggle('versteckt', daten.bestellungen.length > 0);

  for (const b of daten.bestellungen) {
    const tr = document.createElement('tr');
    if (b.erledigt) tr.className = 'erledigt';
    tr.append(zelle(b.name), zelle(b.abteilung), zelle(b.gerichtName), zelle(b.anzahl), zelle(b.bemerkung));

    const tdCheck = document.createElement('td');
    tdCheck.className = 'nicht-drucken';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = b.erledigt;
    cb.style.width = 'auto';
    cb.setAttribute('aria-label', `Bestellung von ${b.name} ausgegeben`);
    cb.addEventListener('change', async () => {
      try {
        await anfrage(`/api/gastro/bestellungen/${b.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ erledigt: cb.checked }),
        });
        tr.classList.toggle('erledigt', cb.checked);
      } catch (err) {
        cb.checked = !cb.checked;
        alert(err.message);
      }
    });
    tdCheck.append(cb);

    const tdAktion = document.createElement('td');
    tdAktion.className = 'nicht-drucken';
    const del = document.createElement('button');
    del.className = 'gefahr klein';
    del.textContent = 'Löschen';
    del.addEventListener('click', async () => {
      if (!confirm(`Bestellung von ${b.name} (${b.gerichtName}) löschen?`)) return;
      try {
        await anfrage(`/api/bestellungen/${b.id}`, { method: 'DELETE' });
        laden();
      } catch (err) {
        alert(err.message);
      }
    });
    tdAktion.append(del);

    tr.append(tdCheck, tdAktion);
    tbody.append(tr);
  }
}

$('loginFormular').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('loginMeldung');
  try {
    await anfrage('/api/gastro/login', {
      method: 'POST',
      body: JSON.stringify({ passwort: $('passwort').value }),
    });
    $('passwort').value = '';
    m.classList.add('versteckt');
    zeigeUebersicht();
  } catch (err) {
    m.textContent = err.message;
    m.classList.remove('versteckt');
  }
});

$('abmelden').addEventListener('click', async () => {
  await anfrage('/api/gastro/logout', { method: 'POST' }).catch(() => {});
  zeigeAnmeldung();
});

$('datum').addEventListener('change', laden);
$('aktualisieren').addEventListener('click', laden);
$('drucken').addEventListener('click', () => window.print());
$('heute').addEventListener('click', () => { $('datum').value = heuteServer; laden(); });
$('vorher').addEventListener('click', () => { $('datum').value = werktagVerschieben($('datum').value, -1); laden(); });
$('nachher').addEventListener('click', () => { $('datum').value = werktagVerschieben($('datum').value, 1); laden(); });

(async function start() {
  try {
    const info = await anfrage('/api/angebot');
    heuteServer = info.heute;
  } catch {
    heuteServer = new Date().toISOString().slice(0, 10);
  }
  $('datum').value = heuteServer;
  const status = await anfrage('/api/gastro/status').catch(() => ({ angemeldet: false }));
  if (status.angemeldet) zeigeUebersicht();
  else zeigeAnmeldung();
})();
