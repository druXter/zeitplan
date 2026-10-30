// auskunft.js
// Auskunft und Löschung zu einer E-Mail-Adresse (Art. 15 und 17 DSGVO, Idee Q8 der Suite, Regeln in
// suite-kit/docs/KONVENTIONEN.md „Datenschutz“). Läuft nur auf dem Server, es gibt keinen Endpunkt dafür.
//
//   node auskunft.js <adresse>                  alles zu dieser Adresse als JSON auf stdout
//   node auskunft.js <adresse> --loeschen       zeigt, was gelöscht würde - ändert nichts
//   node auskunft.js <adresse> --loeschen --ja  löscht
//
// Docker: docker compose exec -T zeitplan node auskunft.js anna@example.org
// Für alle Tools auf einmal: suite-kit/scripts/auskunft.sh
//
// zeitplan kennt Adressen nur von Verwaltungskonten (Gäste bleiben ohne Namen und Adresse; Push-Abos von Gästen hängen an keiner Adresse). Die Auskunft zeigt das Konto mit Zahlen zu dem, was daran
// hängt; gelöscht wird nichts (an einem Konto hängen Events) - nur ein Hinweis, wie es geht.
const { PrismaClient } = require('@prisma/client');

const TOOL = 'zeitplan';
const prisma = new PrismaClient();

/** Technisches, das keine Auskunft braucht und nicht hinausgehört (Tokens, Hashes, Push-Schlüssel). */
const SECRET_KEYS = /(token|hash|secret|hmac|nonce|enc)$|^p256dh$|^auth$|^endpoint$/i;
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, v]) => [key, clean(v)]));
  }
  return value;
}
const same = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === b;
async function idsByEmail(model, email, fields = ['email']) {
  const rows = await model.findMany({ select: { id: true, ...Object.fromEntries(fields.map(f => [f, true])) } });
  return rows.filter(row => fields.some(f => same(row[f], email))).map(row => row.id);
}

/** Gemeinsamer Ablauf: Adresse prüfen, Auskunft oder Probe bzw. Löschung ausgeben. */
async function run({ collect, report, plan, erase, hints }) {
  const [rawEmail, ...flags] = process.argv.slice(2);
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Aufruf: node auskunft.js <adresse> [--loeschen [--ja]]');
    process.exit(1);
  }
  const found = await collect(email);
  const notes = hints(found);
  if (!flags.includes('--loeschen')) {
    console.log(JSON.stringify({ tool: TOOL, adresse: email, erstellt: new Date().toISOString(), daten: clean(report(found)), hinweise: notes }, null, 2));
    return;
  }
  const confirmed = flags.includes('--ja');
  if (confirmed) await erase(found, email);
  console.log(JSON.stringify({ tool: TOOL, adresse: email, modus: confirmed ? 'geloescht' : 'probe', loeschen: plan(found), hinweise: notes }, null, 2));
}

async function collect(email) {
  const users = await prisma.user.findMany({
    where: { id: { in: await idsByEmail(prisma.user, email) } },
    include: { identities: true, _count: { select: { sessions: true, events: true, pushSubscriptions: true, assignedItems: true } } }
  });
  return { users };
}

function report({ users }) {
  return { verwaltungskonten: users };
}

function plan() {
  return {};
}

function hints({ users }) {
  return users.length ? ['Verwaltungskonto vorhanden: wird nicht automatisch gelöscht (daran hängen Events). Löschen über „Konten“ einer Admin-Person.'] : [];
}

async function erase() {}

run({ collect, report, plan, erase, hints })
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
