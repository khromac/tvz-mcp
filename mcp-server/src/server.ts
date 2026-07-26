import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError, type SearchResult, searchDocs } from './api-client.js';
import type { Config } from './config.js';

// zajednicki oblik izlaza: koristi se i za outputSchema i za structuredContent
const resultShape = {
  results: z.array(
    z.object({
      text: z.string().describe('Retrieved text chunk'),
      score: z.number().optional().describe('Relevance score (0-1)'),
      source: z.string().optional().describe('S3 URI of the source document'),
    })
  ),
};

/** Slaze citljiv tekstualni prikaz rezultata za klijente bez structuredContent podrske. */
function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found. Try rephrasing the query (Croatian works best).';
  }

  return results
    .map((r, i) => {
      const header = [
        `Result ${i + 1}`,
        r.score !== undefined ? `[score ${r.score.toFixed(2)}]` : undefined,
        r.source ? `source: ${r.source}` : undefined,
      ]
        .filter(Boolean)
        .join(' ');
      return `${header}\n${r.text}`;
    })
    .join('\n\n');
}

/** Stvara MCP posluzitelj s jednim alatom za pretragu TVZ dokumentacije. */
export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: 'tvz-mcp-server',
    version: '0.1.0',
  });

  server.registerTool(
    'tvz_search_docs',
    {
      title: 'TVZ Documentation Search',
      description:
        'Semantic search over TVZ (Zagreb University of Applied Sciences) ' +
        'documentation: regulations, thesis rules, enrollment information ' +
        'and study programmes. The content is in Croatian — query in ' +
        'Croatian for best results. Returns text chunks with relevance ' +
        'scores and source document URIs.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Natural-language search query (Croatian recommended)'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Number of chunks to return (1-20, default 5)'),
      },
      outputSchema: resultShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, maxResults }) => {
      try {
        const results = await searchDocs(config, {
          query,
          maxResults,
        });
        return {
          content: [{ type: 'text', text: formatResults(results) }],
          structuredContent: { results },
        };
      } catch (err) {
        // greske API-ja se vracaju in-band (isError) kako bi ih LLM mogao
        // procitati i predloziti korisniku sljedeci korak
        const message =
          err instanceof ApiError
            ? err.message
            : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }
  );

  return server;
}
