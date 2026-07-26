// Lokalna imitacija POST /query API-ja za testiranje posluzitelja bez AWS-a.
// Pokretanje:  npm run mock-api            (obogaceni odgovor: formatted + results)
//              npm run mock-api -- --legacy (stari odgovor: samo formatted)
// Ocekivani API kljuc je "test"; bez njega vraca 403 kao API Gateway.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 3000);
const LEGACY = process.argv.includes('--legacy');
const API_KEY = 'test';

const chunks = [
  {
    text: 'Zavrsni rad na strucnom studiju nosi 10 ECTS bodova i prijavljuje se putem studomata.',
    score: 0.62,
    source: 's3://tvz-data-bucket-123456789012/pravilnik-o-zavrsnom-radu.pdf',
    metadata: { category: 'pravilnik' },
  },
  {
    text: 'Student moze prijaviti temu zavrsnog rada nakon odslusanog petog semestra.',
    score: 0.55,
    source: 's3://tvz-data-bucket-123456789012/pravilnik-o-studiranju.pdf',
    metadata: { category: 'pravilnik' },
  },
];

const server = createServer((req, res) => {
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST' || req.url !== '/query') {
    return respond(404, { message: 'Not Found' });
  }
  if (req.headers['x-api-key'] !== API_KEY) {
    return respond(403, { message: 'Forbidden' });
  }

  let raw = '';
  req.on('data', (d) => {
    raw += d;
  });
  req.on('end', () => {
    let body: { query?: string; maxResults?: number };
    try {
      body = JSON.parse(raw);
    } catch {
      return respond(400, { error: 'Bad Request: invalid JSON body' });
    }
    if (!body.query) {
      return respond(400, { error: 'Bad Request: query is required' });
    }

    const results = chunks.slice(0, body.maxResults ?? 5);
    const formatted = results.map((r) => `---\n\n${r.text}`).join('\n\n');

    // legacy nacin simulira Lambda prije obogacivanja odgovora
    respond(200, LEGACY ? { formatted } : { formatted, results });
  });
});

server.listen(PORT, () => {
  console.error(
    `mock /query API on http://localhost:${PORT} ` +
      `(key: "${API_KEY}", mode: ${LEGACY ? 'legacy' : 'enriched'})`
  );
});
