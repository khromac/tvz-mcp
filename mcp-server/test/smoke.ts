// Smoke test posluzitelja preko pravog MCP stdio transporta.
// Preduvjet: mock API pokrenut u drugom terminalu (npm run mock-api),
// odnosno `npm run mock-api -- --legacy` uz `tsx test/smoke.ts --legacy`.
// Provjerava popis alata, uspjesan poziv, fallback na stari format odgovora
// te in-band greske za krivi kljuc i nedostupan API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const LEGACY = process.argv.includes('--legacy');
const MOCK_URL = `http://localhost:${process.env.MOCK_PORT ?? 3000}`;

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: { results?: { text: string; score?: number }[] };
}

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.error(
    `${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`
  );
  if (!ok) failures += 1;
}

/** Spaja se na svjeze pokrenut posluzitelj sa zadanim env varijablama. */
async function connect(env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: { ...process.env, ...env } as Record<string, string>,
    })
  );
  return client;
}

async function main() {
  // 1) popis alata i anotacije
  const client = await connect({
    TVZ_MCP_API_URL: MOCK_URL,
    TVZ_MCP_API_KEY: 'test',
  });
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'tvz_search_docs');
  check('tool tvz_search_docs is listed', tool !== undefined);
  check(
    'tool is annotated read-only/open-world',
    tool?.annotations?.readOnlyHint === true &&
      tool?.annotations?.openWorldHint === true
  );
  check('tool declares outputSchema', tool?.outputSchema !== undefined);

  // 2) uspjesan poziv (u legacy nacinu ocekuje se fallback na jedan rezultat)
  const result = (await client.callTool({
    name: 'tvz_search_docs',
    arguments: { query: 'zavrsni rad', maxResults: 2 },
  })) as ToolResult;
  const results = result.structuredContent?.results ?? [];
  const text = result.content?.[0]?.text ?? '';
  if (LEGACY) {
    check(
      'legacy fallback wraps formatted text as one result',
      !result.isError && results.length === 1 && results[0].score === undefined,
      `got ${results.length} results`
    );
  } else {
    check(
      'call returns structured results',
      !result.isError && results.length === 2,
      `got ${results.length} results`
    );
    check(
      'text content includes score and source',
      text.includes('[score') && text.includes('source: s3://')
    );
  }
  await client.close();

  // 3) krivi API kljuc -> in-band greska koja spominje TVZ_MCP_API_KEY
  const badKey = await connect({
    TVZ_MCP_API_URL: MOCK_URL,
    TVZ_MCP_API_KEY: 'wrong',
  });
  const keyResult = (await badKey.callTool({
    name: 'tvz_search_docs',
    arguments: { query: 'x' },
  })) as ToolResult;
  check(
    'wrong key yields actionable isError',
    keyResult.isError === true &&
      (keyResult.content?.[0]?.text ?? '').includes('TVZ_MCP_API_KEY')
  );
  await badKey.close();

  // 4) nedostupan API -> in-band greska koja spominje TVZ_MCP_API_URL
  const badUrl = await connect({
    TVZ_MCP_API_URL: 'http://localhost:59999',
    TVZ_MCP_API_KEY: 'test',
  });
  const urlResult = (await badUrl.callTool({
    name: 'tvz_search_docs',
    arguments: { query: 'x' },
  })) as ToolResult;
  check(
    'unreachable API yields actionable isError',
    urlResult.isError === true &&
      (urlResult.content?.[0]?.text ?? '').includes('TVZ_MCP_API_URL')
  );
  await badUrl.close();

  console.error(
    failures === 0 ? 'All smoke checks passed.' : `${failures} check(s) failed.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
