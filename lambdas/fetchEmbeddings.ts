import {
  BedrockAgentRuntimeClient,
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

  const { query, maxResults = 5 } = body;

  if (!query) {
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Bad Request: query is required' }),
    };
  }

  // API se poziva i izravno (curl), pa se maxResults ogranicava i ovdje
  const numberOfResults = Math.min(Math.max(Number(maxResults) || 5, 1), 20);

  try {
    // semanticka pretraga baze znanja preko Bedrock Retrieve API-ja
    const retrieved = await client.send(
      new RetrieveCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults,
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

    // strukturirani rezultati uz `formatted` (koji ostaje radi kompatibilnosti)
    const results = retrievalResults.map((r) => ({
      text: r.content?.text?.trim() ?? '',
      score: r.score,
      source: r.location?.s3Location?.uri,
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
