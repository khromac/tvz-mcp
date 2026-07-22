# TVZ MCP

CDK infrastruktura za TVZ MCP posluzitelj: Bedrock Knowledge Base nad S3 Vectors
indeksom, s REST API-jem za semanticku pretragu dokumentacije.

## Arhitektura

- **S3 bucket** (`tvz-data-bucket-<account>`) — izvorna dokumentacija
- **S3 Vectors bucket + indeks** — pohrana embeddinga (float32, 1024 dimenzije, cosine)
- **Bedrock Knowledge Base** — Titan Embed Text v2 embeddinzi, semanticki chunking
- **Lambda** (`tvz-mcp-fetch-embeddings`) — dohvat rezultata preko Bedrock Retrieve API-ja
- **API Gateway** — `POST /query`, zasticen API kljucem i planom koristenja
- **Budzet + alarm** — mjesecni AWS budzet i CloudWatch alarm na broj poziva

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

Opcionalno tijelo podrzava i `filter` (mapa kljuc-vrijednost za metadata
filtriranje) te `maxResults` (zadano 5).

## Napomene za deploy

- SNS pretplata na e-mail zahtijeva rucnu potvrdu nakon prvog deploya.
- `reservedConcurrentExecutions` moze pasti na svjezem racunu s niskim
  concurrency limitom — u tom slucaju privremeno ukloniti to svojstvo.
