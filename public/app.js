'use strict';

const SPEICHER_TOKENS = 'mittagessen.tokens';
const SPEICHER_PERSON = 'mittagessen.person';

const $ = (id) => document.getElementById(id);
const form = $('bestellformular');

function lesen(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function schreiben(key, wert) {
  try { localStorage.setItem(key, JSON.stringify(wert)); } catch { /* ignorieren */ }
}

function datumFormatieren(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function meldung(el, text, art) {
  el.textContent = text;
  el.className = `meldung ${art}`;
}

async function anfrage(url, optionen = {}) {
  const res = await fetch(url, {
    ...optionen,
    headers: { 'Content-Type': 'application/json', ...(optionen.headers || {}) },
  });
  const daten = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(daten.fehler || 'Unbekannter Fehler');
  return daten;
}

/** Nächster Werktag ab heute (oder heute selbst). */
function naechsterWerktag(iso) {
  const d = new Date(`${iso}T12:00:00`);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function angebotLaden() {
  const datum = $('datum').value;
  if (!datum) return;
  const gewaehlt = form.querySelector('input[name="gericht"]:checked')?.value;
  try {
    const daten = await anfrage(`/api/angebot?datum=${encodeURIComponent(datum)}`);
    const container = $('gerichte');
    container.replaceChildren();
    for (const g of daten.angebot) {
      const label = document.createElement('label');
      label.className = `gericht${g.nurFreitag ? ' freitag' : ''}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'gericht';
      input.value = g.id;
      input.required = true;
      input.disabled = !daten.bestellbar;
      if (g.id === gewaehlt) input.checked = true;
      const span = document.createElement('span');
      span.textContent = g.name;
      const small = document.createElement('small');
      small.textContent = g.beschreibung;
      span.append(small);
      label.append(input, span);
      container.append(label);
    }
    const hinweis = $('datumHinweis');
    if (daten.hinweis) {
      meldung(hinweis, daten.hinweis, 'hinweis');
    } else if (datum === daten.heute) {
      meldung(hinweis, `Bestellschluss für heute: ${daten.bestellschluss} Uhr.`, 'hinweis');
    } else {
      hinweis.className = 'meldung hinweis versteckt';
    }
    $('absenden').disabled = !daten.bestellbar;
  } catch (err) {
    meldung($('formMeldung'), err.message, 'fehler');
  }
}

async function meineBestellungenLaden() {
  const tokens = lesen(SPEICHER_TOKENS, []);
  const liste = $('meineListe');
  liste.replaceChildren();
  if (tokens.length === 0) {
    $('keineBestellungen').classList.remove('versteckt');
    return;
  }
  try {
    const bestellungen = await anfrage('/api/meine-bestellungen', {
      method: 'POST',
      body: JSON.stringify({ tokens }),
    });
    // Alte (vergangene/stornierte) Tokens aufräumen
    schreiben(SPEICHER_TOKENS, bestellungen.map((b) => b.stornoToken));
    $('keineBestellungen').classList.toggle('versteckt', bestellungen.length > 0);

    for (const b of bestellungen) {
      const li = document.createElement('li');
      const text = document.createElement('div');
      const titel = document.createElement('strong');
      titel.textContent = `${b.anzahl > 1 ? b.anzahl + '× ' : ''}${b.gerichtName}`;
      const info = document.createElement('div');
      info.className = 'gedaempft';
      info.textContent = `${datumFormatieren(b.datum)} · ${b.name}${b.bemerkung ? ' · ' + b.bemerkung : ''}`;
      text.append(titel, info);
      li.append(text);

      if (b.stornierbar) {
        const knopf = document.createElement('button');
        knopf.className = 'gefahr klein';
        knopf.textContent = 'Stornieren';
        knopf.addEventListener('click', async () => {
          if (!confirm(`Bestellung «${b.gerichtName}» am ${datumFormatieren(b.datum)} stornieren?`)) return;
          try {
            await anfrage(`/api/bestellungen/${b.id}`, {
              method: 'DELETE',
              headers: { 'X-Storno-Token': b.stornoToken },
            });
            meineBestellungenLaden();
          } catch (err) {
            alert(err.message);
          }
        });
        li.append(knopf);
      } else {
        const s = document.createElement('span');
        s.className = 'gedaempft';
        s.textContent = 'Bestellschluss erreicht';
        li.append(s);
      }
      liste.append(li);
    }
  } catch (err) {
    const li = document.createElement('li');
    li.textContent = err.message;
    liste.append(li);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fm = $('formMeldung');
  const daten = Object.fromEntries(new FormData(form));
  if (!daten.name?.trim()) return meldung(fm, 'Bitte Namen angeben.', 'fehler');
  if (!daten.gericht) return meldung(fm, 'Bitte ein Gericht auswählen.', 'fehler');

  $('absenden').disabled = true;
  try {
    const b = await anfrage('/api/bestellungen', {
      method: 'POST',
      body: JSON.stringify({ ...daten, anzahl: Number(daten.anzahl || 1) }),
    });
    schreiben(SPEICHER_TOKENS, [...lesen(SPEICHER_TOKENS, []), b.stornoToken]);
    schreiben(SPEICHER_PERSON, { name: daten.name, abteilung: daten.abteilung });
    meldung(fm, `Danke! ${b.gerichtName} für ${datumFormatieren(b.datum)} ist bestellt.`, 'ok');
    form.querySelectorAll('input[name="gericht"]').forEach((i) => { i.checked = false; });
    $('bemerkung').value = '';
    $('anzahl').value = 1;
    meineBestellungenLaden();
  } catch (err) {
    meldung(fm, err.message, 'fehler');
  } finally {
    $('absenden').disabled = false;
  }
});

$('datum').addEventListener('change', () => {
  $('formMeldung').className = 'meldung versteckt';
  angebotLaden();
});

(async function start() {
  const person = lesen(SPEICHER_PERSON, null);
  if (person) {
    $('name').value = person.name || '';
    $('abteilung').value = person.abteilung || '';
  }
  // Heute laut Server bestimmen (Zeitzone Zürich)
  try {
    const info = await anfrage('/api/angebot');
    let start = naechsterWerktag(info.heute);
    if (start === info.heute && !info.bestellbar) {
      const d = new Date(`${start}T12:00:00`);
      d.setDate(d.getDate() + 1);
      start = naechsterWerktag(d.toISOString().slice(0, 10));
    }
    $('datum').min = info.heute;
    $('datum').value = start;
  } catch {
    $('datum').valueAsDate = new Date();
  }
  angebotLaden();
  meineBestellungenLaden();
})();
