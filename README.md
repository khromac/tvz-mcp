# TVZ MCP

CDK infrastruktura za TVZ MCP posluzitelj: Bedrock Knowledge Base nad S3 Vectors
indeksom, s REST API-jem za semanticku pretragu dokumentacije.

## Arhitektura

- **S3 bucket** (`tvz-data-bucket-<account>`) — izvorna dokumentacija
- **S3 Vectors bucket + indeks** — pohrana embeddinga (float32, 1024 dimenzije, cosine)
- **Bedrock Knowledge Base** — Titan Embed Text v2 embeddinzi, semanticki chunking
- **Lambda** (`tvz-mcp-fetch-embeddings`) — dohvat rezultata preko Bedrock Retrieve API-ja
- **Lambda** (`tvz-mcp-start-ingestion`) — automatska sinkronizacija baze znanja na S3 promjene (StartIngestionJob)
- **API Gateway** — `POST /query`, zasticen API kljucem i planom koristenja
- **Budzet + alarm** — mjesecni AWS budzet i CloudWatch alarm na broj poziva
- **MCP posluzitelj** (`mcp-server/`) — lokalni MCP posluzitelj koji AI
  klijentima izlaze pretragu preko ovog API-ja

## Naredbe

* `npm run build`   type-check projekta
* `npm run watch`   type-check u watch nacinu
* `npm run test`    jest testovi
* `npm run lint`    biome provjera
* `npm run lint:fix` biome provjera s automatskim popravcima
* `npx cdk deploy`  deploy stacka
* `npx cdk diff`    usporedba s deployanim stackom
* `npx cdk synth`   generira CloudFormation predlozak

## Koristenje API-ja

`POST /query` zahtijeva `x-api-key` zaglavlje (bez njega API vraca 403).
Vrijednost kljuca se dohvaca nakon deploya:

```bash
aws apigateway get-api-key --api-key <ApiKeyId iz outputa> --include-value
```

Primjer zahtjeva:

```bash
curl -X POST "<ApiUrl>/query" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <vrijednost kljuca>" \
  -d '{"query": "sto je zavrsni rad", "maxResults": 5}'
```

Uz obavezni `query`, tijelo podrzava i `maxResults` (1-20, zadano 5).

Odgovor sadrzi spojeni tekst (`formatted`) i strukturirane rezultate
(`results`) s ocjenom relevantnosti i izvornim dokumentom:

```json
{
  "formatted": "---\n\n<tekst prvog dijela>\n\n---\n\n<tekst drugog dijela>",
  "results": [
    {
      "text": "<tekst prvog dijela>",
      "score": 0.62,
      "source": "s3://tvz-data-bucket-<account>/pravilnik.pdf"
    }
  ]
}
```

## MCP posluzitelj

`mcp-server/` sadrzi zaseban npm paket `tvz-mcp-server` — lokalni MCP
posluzitelj koji alat `tvz_search_docs` izlaze AI klijentima (Claude Desktop,
Claude Code) i pod haubom poziva gornji `POST /query`. Pokrece se preko `npx`,
bez klonanja repozitorija:

```json
{
  "mcpServers": {
    "tvz-docs": {
      "command": "npx",
      "args": ["-y", "tvz-mcp-server"],
      "env": {
        "TVZ_MCP_API_URL": "<ApiUrl iz outputa>",
        "TVZ_MCP_API_KEY": "<vrijednost kljuca>"
      }
    }
  }
}
```

Paket nije objavljen na npm registry — gornji `npx` oblik dokumentira zamisljeni
model distribucije, u kojem svaki konzument pokrece vlastitu instancu s vlastitim
API kljucem. Za stvarno pokretanje koristi se lokalno izgradena verzija
(`node .../mcp-server/dist/index.js`), opisana u
[`mcp-server/README.md`](./mcp-server/README.md), gdje se nalaze i upute za
instalaciju, opis alata te evaluacijski skup.

## Automatska ingestija

Upload ili brisanje objekta u data bucketu automatski pokrece ingestion job koji
sinkronizira bazu znanja. Brisanje objekta uklanja i pripadne vektore
(`dataDeletionPolicy` DELETE) pri sljedecoj sinkronizaciji.

Ako vise datoteka stigne brzo uzastopno, dio uploada moze pasti u
ConflictException prozor (job je vec u tijeku) i nece pokrenuti novi job. U tom
slucaju pokrenuti jos jedan upload ili rucno pokrenuti sinkronizaciju:

```bash
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id <KnowledgeBaseId iz outputa> \
  --data-source-id <DataSourceId iz outputa>
```

PDF-ovi se parsiraju vizualnim modelom (`BEDROCK_FOUNDATION_MODEL`), pa i
skenirani dokumenti bez tekstualnog sloja zavrsavaju u bazi znanja kao tekst.
Parsiranje se naplacuje po stranici i primjenjuje se na sve PDF-ove, i one koji
vec imaju tekst.

Sinkronizacija je inkrementalna — obraduju se samo nove, promijenjene i obrisane
datoteke. Datoteke vece od 50 MB preskacu se bez greske, pa nakon vece objave
vrijedi provjeriti statistiku posla:

```bash
aws bedrock-agent get-ingestion-job \
  --knowledge-base-id <KnowledgeBaseId> \
  --data-source-id <DataSourceId> \
  --ingestion-job-id <id> --query 'ingestionJob.statistics'
```

## Napomene za deploy

- SNS pretplata na e-mail zahtijeva rucnu potvrdu nakon prvog deploya.
- `reservedConcurrentExecutions` moze pasti na svjezem racunu s niskim
  concurrency limitom — u tom slucaju privremeno ukloniti to svojstvo.
