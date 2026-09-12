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
| F | Hugg med utrustat svärd i den riktning du är vänd |
| M | Öppna / stäng kartan |
| C | Valfri snabbresa mellan skogen och staden |
| Escape | Paus / stäng en öppen panel |

Ljud aktiveras med högtalarknappen. Besök alla fyra byar för att slutföra
den första vandringen; världen förblir öppen efteråt. Framsteg gäller den
aktuella spelomgången och återställs när sidan laddas om.

## Norrhamn City

Du behöver inte snabbresa: promenera söderut på stigen från Björkby,
förbi startplatsen och skyltarna mot Norrhamn. Vid skogens södra gräns
byter spelet automatiskt till stadens infart. Fortsätt österut till
terminalen, eller gå västerut mot den gröna portskylten för att återvända till
skogsstigen. Vid skogsutgången visas **E: Gå tillbaka till Grönvedsskogen**.
Du kan också bara fortsätta västerut genom den breda passagen; övergången
utlöses innan kartans osynliga ytterkant. Övergången sker till fots, inte i ett fordon. Kartan visar
stigen och utfarten. Upptäckta byar, hälsa, tid och utrustning följer med;
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

Fyra stadsdelar syns både på kartan och i platsnamnet:

- **Gamla stan**, i nordväst: låga sten- och tegelfasader, tak och gesimser.
- **Centrum**, i nordost: höga glastorn med metallramar och takinstallationer.
- **Magasinskvarteren**, i sydväst: lägre tegelmagasin, stora portar och matställen.
- **Lindkvarteren**, i sydost: bostadshus med balkonger.

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
