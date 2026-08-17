# Evaluacija MCP posluzitelja

Cilj evaluacije je provjeriti moze li LLM, koristeci iskljucivo alat
`tvz_search_docs`, tocno odgovoriti na realna pitanja o TVZ dokumentaciji.

## Stanje: skup je popunjen (16. 8. 2026.)

Odgovori vise nisu prazni — popunjeni su nad deployanim sustavom s korpusom od
25 dokumenata (~195 stranica). Odjeljak ispod opisuje zasto su bili prazni i
kako je postupak proveden; odjeljak "Zamijenjena pitanja" biljezi sto se pri
tome pokazalo.

## Zasto su odgovori bili prazni

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

## Zamijenjena pitanja (nalaz evaluacije)

Sest od deset pitanja iz prve verzije skupa zamijenjeno je jer korpus na njih
nacelno ne moze odgovoriti. Postupak iz prethodnog odjeljka to izricito
predvida, a razlog je u svakom slucaju isti obrazac: opci akti *delegiraju*
detalje drugom aktu koji nije javno objavljen ili je specifican za studijski
program.

| Zamijenjeno pitanje | Zasto korpus ne odgovara |
| --- | --- |
| Koliko ECTS bodova nosi zavrsni rad | Pravilnik o ocjenjivanju kaze samo "broj ECTS bodova predviden za kolegij Zavrsni rad" — dakle definira ga studijski program, ne opci akt |
| Uvjeti za prijavu teme zavrsnog rada | Pravilnik o studiranju izricito upucuje da Vijece Veleucilista "posebnim internim aktom" ureduje izbor mentora i prijavu teme |
| Koliko ECTS za upis sljedece godine | U korpusu su samo opca pravila ECTS-a (60 po godini, max 36 po semestru), ne i prag za upis vise godine |
| Strucni studiji i nazivi na racunarstvu | Statut navodi samo podrucja i vrste studija, bez naziva po odjelima |
| Trajanje i ECTS strucne prakse | Nije u opcim aktima; definira studijski program |
| Postupak obrane i sastav povjerenstva | Statut, cl. 82: "Poblize odredbe o rokovima, nacinu izrade i obrane zavrsnog rada utvrduju se posebnim opcim aktom" |

**Za rad je vazniji drugi nalaz.** Prije nego sto je korpus prosiren s
*Pravilnika o studiranju*, pitanje "koliko ispitnih rokova se organizira u
akademskoj godini" vracalo je tekst o semestrima s ocjenom slicnosti **0,781** —
visoka slicnost, netocan odgovor. Nakon prosirenja isto pitanje vraca clanak
"Ispitni rokovi" s ocjenom **0,852**. Ocjena slicnosti dakle **nije mjera
pouzdanosti**: sustav bez dokumenta koji sadrzi odgovor svejedno vraca tematski
blizak tekst s uvjerljivom ocjenom. To je izravan argument za oprez pri
tumacenju ocjena i za to da sustav nema rerank korak (vidi 2.13 u THESIS-NOTES).

Slican primjer zabiljezen je i na popunjenom korpusu: na pitanje "tko cini
strucno vijece Veleucilista" najbolje rangiran rezultat (0,786) bio je zaglavlje
*odluke o skolarinama* — dokument koji se poziva na Strucno vijece, ali ga ne
definira — dok je tocan tekst iz Statuta bio tek drugi (0,785).

## Provodenje evaluacije

Evaluacija se provodi rucno: svako pitanje se postavi u novom razgovoru (bez
konteksta prethodnih pitanja) i odgovor modela usporedi s odgovorom iz
`evaluation.xml`. Biljezi se prolaz/pad po pitanju i, za analizu u radu, broj
poziva alata te je li model naveo izvor.

Deset rucnih prolaza primjereno je opsegu rada; automatizirani pokretac nije
predviden jer bi zahtijevao stabilan korpus i verificirane odgovore, sto su
preduvjeti koje treba prvo ispuniti.
