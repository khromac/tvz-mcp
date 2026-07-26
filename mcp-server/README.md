# tvz-mcp-server

MCP (Model Context Protocol) posluzitelj koji AI klijentima poput Claude
Desktopa i Claude Codea omogucuje semanticku pretragu TVZ dokumentacije.

Posluzitelj se izvodi lokalno preko stdio transporta i poziva `POST /query` API
deployanog [tvz-mcp](../README.md) stacka (Bedrock Knowledge Base nad S3 Vectors
indeksom). Sam po sebi ne sadrzi dokumentaciju ni model — on je tanak, prenosiv
sloj izmedu MCP klijenta i backenda.

## Preduvjeti

- Node.js 20 ili noviji
- Deployan `tvz-mcp` stack, iz cijih se izlaza uzimaju:
  - `ApiUrl` — vrijednost za `TVZ_MCP_API_URL`
  - `ApiKeyId` — iz njega se dohvaca vrijednost kljuca za `TVZ_MCP_API_KEY`:

```bash
aws apigateway get-api-key --api-key <ApiKeyId> --include-value
```

## Konfiguracija klijenta

> Paket **nije objavljen** na npm registry. `npx` primjeri ispod dokumentiraju
> zamisljeni model distribucije — svaki konzument pokrece vlastitu instancu
> posluzitelja s vlastitim API kljucem, cime se odgovornost za hosting i
> postivanje ogranicenja plana koristenja prenosi na konzumenta. Za stvarno
> pokretanje koristiti odjeljak [Lokalni razvoj](#lokalni-razvoj-iz-repozitorija).

### Claude Desktop

U `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tvz-docs": {
      "command": "npx",
      "args": ["-y", "tvz-mcp-server"],
      "env": {
        "TVZ_MCP_API_URL": "https://xxxx.execute-api.eu-central-1.amazonaws.com/prod/",
        "TVZ_MCP_API_KEY": "<vrijednost kljuca>"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add tvz-docs \
  --env TVZ_MCP_API_URL=https://xxxx.execute-api.eu-central-1.amazonaws.com/prod/ \
  --env TVZ_MCP_API_KEY=<vrijednost kljuca> \
  -- npx -y tvz-mcp-server
```

### Lokalni razvoj (iz repozitorija)

Umjesto `npx`, pokrenuti izgradenu verziju izravno:

```json
{
  "command": "node",
  "args": ["/putanja/do/tvz-mcp/mcp-server/dist/index.js"]
}
```

## Alat

### `tvz_search_docs`

Semanticka pretraga TVZ dokumentacije. Oznacen je kao read-only (ne mijenja
nista) i open-world (dohvaca podatke izvan konteksta razgovora).

| Parametar | Tip | Zadano | Opis |
| --- | --- | --- | --- |
| `query` | string | — | Upit prirodnim jezikom; hrvatski daje najbolje rezultate jer je korpus na hrvatskom |
| `filter` | mapa string→string | — | Filtar po metapodacima, npr. `{"category": "pravilnik"}`; vise kljuceva se spaja logickim I |
| `maxResults` | broj (1–20) | 5 | Broj dijelova teksta koji se vracaju |

Odgovor sadrzi strukturirane rezultate (`text`, `score`, `source`, `metadata`) i
citljivu tekstualnu inacicu s ocjenom relevantnosti i izvorom po rezultatu, pa
model moze navesti iz kojeg dokumenta odgovor dolazi.

Ako backend jos vraca stari oblik odgovora (samo `formatted`, prije obogacivanja
Lambda funkcije), posluzitelj taj tekst zamata u jedan rezultat i nastavlja
raditi — bez ocjena i izvora.

### Zasto samo jedan alat

Svaki registrirani alat trajno zauzima dio konteksta u svakom razgovoru, pa se
dodatni dijagnosticki alat (provjera konfiguracije, "health check") ne isplati:
koristio bi se jednom, a placao bi se stalno. Umjesto toga posluzitelj se pri
pokretanju odmah prekida ako nedostaje konfiguracija, a greske pri pozivu vraca
s uputom sto napraviti — cime je dijagnostika pokrivena bez dodatnog alata.

## Rjesavanje problema

| Poruka | Uzrok i rjesenje |
| --- | --- |
| `Missing required environment variable(s)` | `TVZ_MCP_API_URL` ili `TVZ_MCP_API_KEY` nisu postavljeni u konfiguraciji klijenta |
| `API key rejected (HTTP 403)` | Kljuc ne odgovara deployanom; dohvatiti ga ponovno naredbom iz odjeljka Preduvjeti |
| `Rate limit exceeded (HTTP 429)` | Iscrpljen plan koristenja (1000 zahtjeva mjesecno, burst 20) |
| `Could not reach ...` | Neispravan `TVZ_MCP_API_URL` ili nema mrezne veze |
| `Backend error (HTTP 5xx)` | Provjeriti logove `tvz-mcp-fetch-embeddings` Lambda funkcije u CloudWatchu |

Poruke posluzitelja idu na stderr (stdout je rezerviran za MCP protokol); u
Claude Desktopu su vidljive u MCP logovima.

## Razvoj

```bash
npm install
npm run build          # tsc -> dist/
npm run mock-api       # lokalna imitacija /query API-ja na portu 3000
npm run smoke          # smoke test preko stvarnog MCP stdio transporta
npm run inspector      # MCP Inspector nad izgradenim posluziteljem
```

Testiranje bez AWS-a: pokrenuti `npm run mock-api` u jednom terminalu, zatim
`npm run smoke` u drugom. Stari oblik odgovora provjerava se s
`npm run mock-api -- --legacy` i `npm run smoke -- --legacy`.

## Evaluacija

Evaluacijski skup i postupak provjere nalaze se u [`evals/`](./evals/README.md).
