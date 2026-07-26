import type { Config } from './config.js';

// jedan rezultat semanticke pretrage kako ga vraca obogaceni /query API
export interface SearchResult {
  text: string;
  score?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchParams {
  query: string;
  filter?: Record<string, string>;
  maxResults?: number;
}

/**
 * Greska s porukom namijenjenom LLM-u/korisniku: opisuje sto je poslo po zlu
 * i koji je sljedeci korak. Vraca se kao in-band tool error (isError), nikad
 * kao protokolska iznimka.
 */
export class ApiError extends Error {}

const REQUEST_TIMEOUT_MS = 30_000;

/** Spaja bazni URL API-ja (sa ili bez zavrsne kose crte) i resurs `query`. */
function queryUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/query`;
}

/**
 * Poziva POST /query i vraca strukturirane rezultate. Ako deployani Lambda
 * jos ne vraca `results` (stariji format samo s `formatted`), cijeli
 * formatirani tekst se zamata u jedan rezultat kako bi posluzitelj radio i
 * prije ponovnog deploya backenda.
 */
export async function searchDocs(
  config: Config,
  params: SearchParams
): Promise<SearchResult[]> {
  const url = queryUrl(config.apiUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      `Could not reach ${url} (${reason}). ` +
        'Check that TVZ_MCP_API_URL points to the deployed API ' +
        '(ApiUrl CDK output) and that you have network connectivity.'
    );
  }

  if (!response.ok) {
    throw new ApiError(await describeHttpError(response));
  }

  let body: { formatted?: string; results?: SearchResult[] };
  try {
    body = (await response.json()) as {
      formatted?: string;
      results?: SearchResult[];
    };
  } catch {
    throw new ApiError(
      `The API at ${url} returned a non-JSON response. ` +
        'Check that TVZ_MCP_API_URL points to the /query API stage.'
    );
  }

  if (Array.isArray(body.results)) return body.results;
  if (body.formatted) return [{ text: body.formatted }];
  return [];
}

// mapiranje HTTP gresaka u poruke s konkretnim sljedecim korakom
async function describeHttpError(response: Response): Promise<string> {
  const status = response.status;

  if (status === 403) {
    return (
      'API key rejected (HTTP 403). Check that TVZ_MCP_API_KEY matches the ' +
      'deployed API key; fetch its value with: aws apigateway get-api-key ' +
      '--api-key <ApiKeyId output> --include-value'
    );
  }

  if (status === 429) {
    return (
      'Rate limit exceeded (HTTP 429) — the usage plan allows 1000 ' +
      'requests/month with bursts of 20. Wait a moment and try again.'
    );
  }

  if (status === 400) {
    const message = await response
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => undefined);
    return `Invalid request (HTTP 400): ${message ?? 'unknown error'}.`;
  }

  return (
    `Backend error (HTTP ${status}). If this persists, check the ` +
    'tvz-mcp-fetch-embeddings Lambda logs in CloudWatch.'
  );
}
