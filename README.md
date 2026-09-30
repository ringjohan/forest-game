# Skogsvandrare

Ett fristående 3D-äventyr i webbläsaren, byggt med Three.js och TypeScript.
Utforska Grönveds skogar och besök fyra byar, med möblerade hus att gå in i.
Följ den skyltade stigen söderut från Björkby till Norrhamn City, utanför
skogen. Alla fyra byar och deras hus finns kvar.
Skogen, byggnaderna, rollfigurerna och naturljuden genereras lokalt.
Staden använder också fritt licensierade material och modeller som följer med
spelet i `public/assets/city/`. Inga externa tjänster eller konton behövs vid spel.

## Starta

Kräver Node.js 20.9+ och en modern webbläsare med WebGL 2.

```sh
npm install
npm run dev
```

Öppna adressen som Vite visar, normalt `http://127.0.0.1:5173`.

```sh
npm run build
npm run preview
```

Byggkommandot typkontrollerar koden och skapar en produktionsversion i `dist/`.

### Regressionstester

Med utvecklingsservern igång, öppna
`http://127.0.0.1:5173/tests/world.html`. Testerna kontrollerar den
sammanhängande gångvägen, koordinatövergången i båda riktningar,
flygplatsens tillgänglighet, befintliga hus, start, vybyte, flyggränser,
landning vid olika bildfrekvenser, kollisionshantering, piltangenternas
flygstyrning och faktisk stigning till 10 000 meter. De verifierar också
flygplanets gångkollision, bilarnas verkliga bredd, BMW:ns uppmätta toppfart,
rödljusbrott, hastighetsgränsen, polisjakt, omedelbart gripande vid kontakt,
krascheffekter, bestående brandskador och möjligheten att komma undan.
De använder spelets riktiga världs- och flygkod
i webbläsaren utan extra testberoenden.

```sh
npx tsc --noEmit -p tests/tsconfig.json
```

## Kontroller

| Kontroll | Funktion |
| --- | --- |
| Piltangenter / WASD | Gå relativt kamerans riktning |
| Shift | Spring |
| Dra med vänster musknapp | Rotera kameran |
| Scrollhjul | Zooma kameran |
| Mellanslag | Hoppa (även medan du går eller springer) |
| E | Prata med en bybo / gå in eller ut vid husets dörr / sova vid sängen / stäng dialogen |
| B | Öppna / stäng ryggsäcken och se ditt svärd |
| 1 | Utrusta / stoppa undan svärdet |
| 2 / 3 | Välj pilbåge / fiskespö efter att du hittat skattkistan |
| Q | Växla pilbågens sikte |
| Dra höger musknapp (med sikte) | Vrid siktet åt alla håll |
| Scrollhjul (med sikte) | Zooma siktet |
| Vänsterklick / F (med pilbåge) | Skjut en synlig pil; obegränsat med pilar |
| F (med svärd) | Hugg i den riktning du är vänd |
| M | Öppna / stäng kartan |
| C | Valfri snabbresa mellan skogen och staden |
| V (i flygplanet) | Växla mellan cockpit och följkamera bakom planet |
| W / S (i flygplanet) | Gas / broms |
| Vänster pil / höger pil (i flygplanet) | Sväng vänster / höger |
| Pil ned / pil upp (i flygplanet) | Höj nosen och stig / sänk nosen och sjunk |
| Escape | Paus / stäng en öppen panel |

Ljud aktiveras med högtalarknappen. Besök alla fyra byar för att slutföra
den första vandringen; världen förblir öppen efteråt. Framsteg gäller den
aktuella spelomgången och återställs när sidan laddas om.

## Äppelkojan

Sydost om startplatsen står ett högt äppelträd, markerat med en gul ruta och
**Äppelkojan** på kartan. Följ stigen söderut och ta av österut vid förgreningen.
Kojan är byggd av separata plankor cirka 19 meter upp i trädet.

- Tryck **E** vid plankstegen på stammen för att klättra upp automatiskt.
  Paneler pausar klättringen. E vid samma stege uppe på verandan tar dig ner igen.
- Gå runt hörnet till öppningen på kojans framsida. **E** vid skattkistan
  öppnar locket och ger en pilbåge, ett extra svärd och ett fiskespö.
  Ditt ursprungliga vandrarsvärd finns kvar; du kan alltid försvara dig med det.
- En andra plankstege på verandans högra sida leder till det gångbara taket.
  **E** vid den klättrar upp eller ner. Räcken hindrar dig från att gå över kanten.
- **2** utrustar pilbågen och visar ett förstapersonssikte. Dra med höger musknapp
  för att sikta, scrolla för att zooma och skjut med vänsterklick eller **F**.
  **Q** växlar tillbaka till följkameran. Gå nära takräcket för fri sikt ner mot
  skogen. Pilar färdas genom världen och stoppas av terräng, träd och byggnader.
- Efter att skatten öppnats finns maskerade tjuvar i skogen kring kojan.
  På natten kommer även varulvar. En pilträff får fienden att snurra, krympa
  och försvinna i ett färgat partikelmoln, utan blod. Fienderna når inte taket.
- **3** låter dig hålla fiskespöet. Själva fiskandet är inte implementerat.

Pilarna tar aldrig slut, men det finns en kort paus mellan skotten. Utrustning
och den öppnade kistan finns kvar under spelomgången, även efter snabbresa eller
räddning. Klättra ner till marken innan du snabbreser. Siktesläge och strider
är avstängda i staden, inomhus och under flygning.

## Norrhamn City

Du behöver inte snabbresa: promenera söderut på stigen från Björkby,
förbi startplatsen och skyltarna mot Norrhamn. Träden glesnar, terrängen
planar ut och stadens byggnader och skyskrapor blir synliga mellan träden.
Skogen och staden ritas samtidigt i en sammanhängande värld: ingen
teleportering, scenladdning eller kameraklipp sker vid skogsbrynet.
Fortsätt genom infarten till terminalen, eller följ den gröna skylten och
stigen tillbaka till skogen. Övergången kan göras till fots i båda riktningarna.
Världskartan visar skogen, staden, flygplatsen och deras förbindelser.
Upptäckta byar, hälsa, tid och utrustning följer med;
husen går fortfarande att besöka. C finns kvar som valfri snabbresa.

Staden har olika stadsdelar med egen arkitektur, skyltade caféer,
restauranger och butiker, uteserveringar, fotgängare och trafik.
Alla skyltade verksamheter har en spelbar interiör.
Asfalt, trottoarer och tegelfasader har 2K PBR-material med ytstruktur och
varierad strävhet. Ett fotograferat HDR-ljus ger utomhusreflektioner.
Uteserveringar och gatlyktor använder modellerade detaljer; sportbilen har
en detaljerad glTF-modell med interiör, lack och glas när du är nära.
På längre avstånd används den enklare bilmodellen. Övriga fordon är
fortfarande procedurgenererade.

Fyra stadsdelar har olika arkitektur och egna platsnamn:

- **Gamla stan**, i nordost: låga sten- och tegelfasader, tak och gesimser.
- **Centrum**, i sydost: höga glastorn med metallramar och takinstallationer.
- **Magasinskvarteren**, i nordväst: lägre tegelmagasin, stora portar och matställen.
- **Lindkvarteren**, i sydväst: bostadshus med balkonger.

Över hundra fotgängare rör sig i staden, med fler kring terminalen och
matkvarteren. Några korsar gatorna vid övergångsställen och väntar på trafiken.
Tryck E nära en stadsbo för att prata. Små sällskap står vid skyltfönstren.
Uteserveringarna har bord, stolar, koppar, planteringar och randiga markiser.
Bilarna har rundade karosser, lack med reflektioner, lutande bilrutor, fälgar,
backspeglar, dörrhandtag, grill och fram-/bakljus. Buss och skåpbil har egna
karosser. Fönster lyser på natten. Avlägsna personer och fordon döljs och
statiska detaljer ritas i grupper för att begränsa renderingskostnaden.
Träd kantar infarten, Centralparken har en animerad fontän, och närliggande
gatlyktor och serveringar belyser omgivningen på natten.

### Gå in i stadens lokaler

Gå till dörren under verksamhetens skylt och tryck **E** när "Gå in i …"
visas. Dörrarna är markerade med "ÖPPET · E". På kartan är caféer gula,
restauranger rosa och butiker turkosa.

- **Caféer:** kaffebar, espressomaskin, bakverksmonter, diskho, kyl,
  menytavla, dukade bord, sittande gäster och barista.
- **Restauranger:** kök med spis, grytor, fläkt, kyl och arbetsbänkar,
  serveringsdisk, matsal, kock, serveringspersonal och gäster.
- **Butiker:** bokhandel, saluhall eller klädbutik med fyllda hyllor,
  varuexponering, kassa, personal och kunder som går omkring.

Utforska med vanliga rörelsekontroller och tryck E nära en person för att
prata. Tryck **E vid utgångsmattan** för att gå tillbaka till samma dörr
på gatan. Om utgången är blockerad av människor eller fordon får du
vänta i lokalen tills det finns plats. Kartan visar lokalens läge i staden,
inte rummets interna koordinater. Snabbresa görs först efter att du gått ut.

Lokalerna är trygga även på natten. Tid och återhämtning fortsätter inomhus;
paneler och dialoger pausar även människorna i lokalen. Butiker och menyer
är till för utforskning och samtal, inte ett köp- eller beställningssystem.
Interiörerna återanvänder befintliga modeller; inga nya nedladdningar behövs.

### Fria spelresurser

- PBR-material: [ambientCG](https://ambientcg.com/), CC0.
- Utemöbler, gatlyktor och HDR: [Poly Haven](https://polyhaven.com/), CC0.
- Car Concept: Eric Chadwick / Darmstadt Graphics Group GmbH,
  [glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept),
  CC BY 4.0. Modellens logotyper tillhör Khronos Group.

Fullständiga källor, licenslänkar och ändringar finns i
[CREDITS.txt](public/assets/city/CREDITS.txt). De lokala bild- och modellfilerna
ökar spelets nedladdningsstorlek. Första laddningen kan därför ta längre tid.

Gå nära ett stillastående fordon och tryck E för att köra. WASD eller
piltangenterna ger gas, backar och styr; Space bromsar. Stanna och tryck E
för att kliva ur på en ledig plats. Trafiken följer trafikljus och bromsar
för människor och andra fordon. Staden är trygg även på natten.

### Bilar och polisjakt

Bilarnas kollisionsytor följer karossens längd, bredd och riktning.
Den röda sportbilens när- och avståndsmodeller har samma mått; den har inte
längre en bred osynlig cirkel som fastnar vid föremål bredvid bilen.
Snabba bilar kontrolleras i små rörelsesteg så att de inte passerar genom hinder.

**BMW Sport** står vid bussterminalen tillsammans med de andra parkerade
fordonen. Den har BMW-märkning, en egen sportkaross, toppfart **400 km/h**,
kraftigare acceleration och bromsar samt fartberoende styrning för bättre
stabilitet. Det är en egen procedurgenererad, inofficiell spelmodell, inte
en licensierad modell av en viss serieproducerad BMW. Toppfarten är spelprestanda.

För biltrafiken i hela staden gäller **70 km/h**:

- Fortkörning eller att passera stopplinjen vid **rött ljus** gör dig efterlyst.
  Grönt ljus, väntan vid rött och att redan befinna sig i korsningen när
  ljuset slår om startar inte en jakt.
- Polisbilar följer gatunätet och jagar dig med blåljus. Sirener hörs om
  spelets ljud är aktiverat. Patruller i tjänst kan inte lånas.
- När du är efterlyst räcker minsta kontakt med en polispatrulls bil
  för att du omedelbart ska hamna i fängelse. Det gäller både till fots och
  i bil, oavsett hastighet. Enbart närhet räcker inte, och polisen kan inte
  fånga dig genom husväggar.
- Håll dig på säkert avstånd från alla patruller i **20 sammanhängande
  sekunder** för att skaka av dig dem. HUD visar jakt och nedräkning.
- Om du blir fångad får du tillbringa **60 sekunder i häktet**. Därefter
  släpps du automatiskt ut vid terminalens polisstation. Upptäckter,
  hälsa och utrustning behålls; bilen står kvar där du blev stoppad.
- Snabbresa är avstängd under jakt och fängelsevistelse. Öppna paneler
  och tappat fönsterfokus pausar både jakten och fängelsetiden, precis som resten av spelet.

## Flygplats och flygning

Norrhamns flygplats ligger öster om staden. Öppna **M** för världskartan:
flygplatsen och planet är markerade. En anslutningsväg går från stadens
östra ytterkant till terminalen och startbanan. Bilar kan köras till
stadsgränsen; fortsätt till fots till planet och tryck **E** nära flygplanet.
Flygkropp, vingar och hjul är solida när planet står på marken. Gå runt
planet till ombordstigningsplatsen; det går inte att gå genom flygplanet.

- Håll **W** för att accelerera längs banan och lyfta.
- **Vänster / höger pil** svänger åt vänster / höger.
- **Pil ned (↓)** höjer nosen och stiger. **Pil upp (↑)** sänker nosen och sjunker.
- **S** minskar farten och bromsar på marken. Piltangenterna ändrar inte gasen.
- **V** växlar mellan en cockpit med instrument och en följkamera bakom planet.
- Flyg fritt över både staden och skogen utan områdesbyten. HUD visar fart,
  höjd över mark och vald vy.
- Återvänd till startbanan, sänk farten och sjunk försiktigt för att landa.
  Håll **S + pil upp (↑)** på rak inflygning: planet hjälper till att plana ut
  nära banan. Stanna helt innan du trycker **E** för att kliva ur.
  Planet står kvar.

Flygningen är lättillgänglig arkadflygning, inte en flygsimulator.
Världen har en yttre flyggräns och ett höjdtak på **10 000 meter** över
världens nollnivå; HUD visar i stället höjd över marken under planet.
Du kan stiga långt över skyskraporna och skogen. Siktavståndet och diset
anpassas för flygning på hög höjd, och följkameran höjer sig bakom planet
för att visa landskapet nedanför. Space, Shift och A/D styr inte planet;
gång- och bilkontrollerna är oförändrade.
Kollisioner med hinder och alltför snabba eller sneda landningar ger en
krasch med eldklot, ljussken och stigande rök. Planet försvinner i eldklotet,
och kameran stannar vid kraschen i fyra sekunder innan planet återställs
säkert vid flygplatsen. Upptäckter och utrustning behålls.
Byggnader får synliga brandskador, sprickor och spillror vid träffen,
men står kvar och kan fortfarande besökas. Vid markkrasch lämnas sot på
marken, även utanför flygplatsen. De senaste 16 nedslagsplatsernas märken
finns kvar under spelomgången. Hus, träd och stadsbyggnader går inte att
flyga igenom. Öppna paneler pausar även kraschsekvensen och röken.
Snabbresa och svärd är avstängda ombord. Karta, hjälp, dialoger,
ryggsäck och tappat fönsterfokus pausar även flygningen.
Flygplats, flygplan och cockpit genereras lokalt utan nya resursnedladdningar.

## Dag, natt och skydd

Dagen varar i tre minuter och natten i 90 sekunder, med gradvis skymning
och gryning. På natten dyker upp till fyra varulvar upp i närheten. Spring
undan, sök skydd eller utrusta svärdet i ryggsäcken. Två träffar driver bort
en varulv; huggen har 0,28 sekunders återhämtningstid och en svepande
svärdseffekt. Träffar ger en kort rekyl och gnistor; besegrade varulvar
krymper bort i ett mjukt partikelmoln utan blod eller skärmblinkningar.
Varulvar blockerar vägen även när du hoppar. De försvinner på dagen.

Hoppet har ett kort avstamp med böjda knän, en luftpose och en mjuk
knäböjning vid landning.

Alla hus har en ingång: gå fram till dörren och tryck E. Interiörerna har
säng, kök, matplats, förvaring och belysning. Där är du trygg från varulvar,
men tiden fortsätter gå. Gå nära sängen och tryck E för att lägga dig i sängen.
Efter en kort sovanimation kliver du automatiskt upp på samma plats bredvid
sängen nästa morgon med full hälsa. Under animationen kan du inte gå, hoppa
eller hugga; öppna paneler pausar även sömnen. Det fungerar både på dagen och på natten;
varulvarna försvinner och du stannar i huset, med utrustning och upptäckter
kvar. Gå tillbaka till dörren och tryck E för att gå ut.
Hälsan återhämtas inomhus och i dagsljus. Om hälsan tar slut hjälper en bybo
dig till ett hus utan att du förlorar svärdet eller upptäckta byar.

Kartan, ryggsäcken, dialoger och hjälpmenyn pausar dag/natt, rörelse och
strider. Spelet pausas också när fönstret tappar fokus.

Spelet är utformat för dator med tangentbord och mus. Simning ingår inte.
