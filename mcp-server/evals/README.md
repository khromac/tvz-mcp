# Evaluacija MCP posluzitelja

Cilj evaluacije je provjeriti moze li LLM, koristeci iskljucivo alat
`tvz_search_docs`, tocno odgovoriti na realna pitanja o TVZ dokumentaciji.

## Zasto su odgovori prazni

Korpus dokumentacije nije dio repozitorija — nalazi se u S3 data bucketu
deployanog stacka. Zbog toga nijedan odgovor u `evaluation.xml` nije unaprijed
poznat: upisati odgovor bez provjere nad stvarnim korpusom znacilo bi izmisliti
mjerilo. Pitanja su zato odabrana tako da ciljaju teme koje korpus gotovo sigurno
pokriva (pravilnik o studiranju, zavrsni rad, upisi, ispitni rokovi, strucna
praksa), a odgovori se popunjavaju tek nakon provjere.

## Postupak pripreme (jednokratno, nad deployanim sustavom)

Za svako pitanje iz `evaluation.xml`:

1. Postaviti pitanje kroz MCP klijent s povezanim posluziteljem (Claude Desktop
   ili Claude Code).
2. Provjeriti da je alat vratio relevantne dijelove teksta i da `source`
   stvarno upucuje na dokument koji potkrepljuje odgovor.
3. Otvoriti taj izvorni dokument i iz njega prepisati tocan odgovor u polje
   `<answer>`, umjesto `TODO` oznake.
4. Ako korpus ne sadrzi odgovor, pitanje preformulirati ili zamijeniti drugim —
   ne ostavljati pitanja na koja sustav nacelno ne moze odgovoriti.

Odgovore drzati kratkima i jednoznacnima (broj, naziv, kratka recenica) kako bi
usporedba bila moguca bez tumacenja.

## Provodenje evaluacije

Evaluacija se provodi rucno: svako pitanje se postavi u novom razgovoru (bez
konteksta prethodnih pitanja) i odgovor modela usporedi s odgovorom iz
`evaluation.xml`. Biljezi se prolaz/pad po pitanju i, za analizu u radu, broj
poziva alata te je li model naveo izvor.

Deset rucnih prolaza primjereno je opsegu rada; automatizirani pokretac nije
predviden jer bi zahtijevao stabilan korpus i verificirane odgovore, sto su
preduvjeti koje treba prvo ispuniti.
