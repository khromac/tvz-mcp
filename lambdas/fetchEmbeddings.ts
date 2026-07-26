import {
  BedrockAgentRuntimeClient,
  type RetrievalFilter,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

// klijent se inicijalizira izvan handlera kako bi se ponovno koristio izmedu poziva
const client = new BedrockAgentRuntimeClient({ region: process.env.REGION });
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;

// CORS zaglavlja moraju biti na svakom odgovoru, ne samo na OPTIONS preflightu
const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Gradi metadata filter za pretragu baze znanja iz opcionalne mape filtera.
 * Jedan uvjet postaje "equals", vise uvjeta se spaja u "andAll".
 */
function buildFilter(
  filterMap?: Record<string, string>
): RetrievalFilter | undefined {
  if (!filterMap) return undefined;

  const conditions: RetrievalFilter[] = Object.entries(filterMap)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([key, value]) => ({ equals: { key, value } }));

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { andAll: conditions };
}

export const handler = async (event: any): Promise<any> => {
  // parsiranje tijela zahtjeva uz zastitu od nevaljanog JSON-a
  let body: any;
  try {
    body = event.body ? JSON.parse(event.body) : event;
  } catch {
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Bad Request: invalid JSON body' }),
    };
  }

  const { query, filter, maxResults = 5 } = body;

  if (!query) {
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Bad Request: query is required' }),
    };
  }

  // API se poziva i izravno (curl), pa se maxResults ogranicava i ovdje
  const numberOfResults = Math.min(Math.max(Number(maxResults) || 5, 1), 20);

  const metadataFilter = buildFilter(filter);

  try {
    // semanticka pretraga baze znanja preko Bedrock Retrieve API-ja
    const retrieved = await client.send(
      new RetrieveCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults,
            ...(metadataFilter && { filter: metadataFilter }),
          },
        },
      })
    );

    const retrievalResults = retrieved.retrievalResults ?? [];

    // rezultati se spajaju u jedan tekst odvojen separatorima
    const formatted = retrievalResults
      .map((r) => {
        const text = r.content?.text?.trim() ?? '';
        return `---\n\n${text}`;
      })
      .join('\n\n');

    // strukturirani rezultati uz `formatted` (koji ostaje radi kompatibilnosti);
    // Bedrockovi interni metapodaci (x-amz-bedrock-kb-*) se izostavljaju jer je
    // izvor vec izlozen kao `source`, a pozivatelju su korisni samo atributi
    // iz vlastitih .metadata.json datoteka
    const results = retrievalResults.map((r) => ({
      text: r.content?.text?.trim() ?? '',
      score: r.score,
      source: r.location?.s3Location?.uri,
      metadata: Object.fromEntries(
        Object.entries(r.metadata ?? {}).filter(
          ([key]) => !key.startsWith('x-amz-bedrock-kb-')
        )
      ),
    }));

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({ formatted, results }),
    };
  } catch (err) {
    console.error('Retrieve failed:', err);
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
