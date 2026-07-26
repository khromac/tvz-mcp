// ucitavanje konfiguracije iz environment varijabli koje MCP klijent
// (Claude Desktop / Claude Code) prosljeduje posluzitelju
export interface Config {
  readonly apiUrl: string;
  readonly apiKey: string;
}

/**
 * Cita TVZ_MCP_API_URL i TVZ_MCP_API_KEY iz environmenta.
 * Baca gresku s uputom za rjesavanje ako neka varijabla nedostaje,
 * kako bi se problem s konfiguracijom vidio odmah pri pokretanju.
 */
export function loadConfig(): Config {
  const apiUrl = process.env.TVZ_MCP_API_URL;
  const apiKey = process.env.TVZ_MCP_API_KEY;

  const missing: string[] = [];
  if (!apiUrl) missing.push('TVZ_MCP_API_URL');
  if (!apiKey) missing.push('TVZ_MCP_API_KEY');

  if (!apiUrl || !apiKey) {
    throw new Error(
      [
        `Missing required environment variable(s): ${missing.join(', ')}.`,
        'Set them in your MCP client configuration:',
        '- TVZ_MCP_API_URL: the ApiUrl output of the deployed CDK stack,',
        '  e.g. https://xxxx.execute-api.eu-central-1.amazonaws.com/prod/',
        '- TVZ_MCP_API_KEY: the API key value, fetched with:',
        '  aws apigateway get-api-key --api-key <ApiKeyId output> --include-value',
      ].join('\n')
    );
  }

  return { apiUrl, apiKey };
}
