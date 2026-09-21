/* ============================================================================
   WARRIORS — config.js
   Sem patria prístupové údaje k Supabase projektu.

   Kde ich nájdete:
     Supabase Dashboard → Project Settings → API
       Project URL     → SUPABASE_URL
       anon / public   → SUPABASE_ANON_KEY

   POZOR: sem patrí LEN "anon (public)" kľúč. Ten je určený do prehliadača
   a chránia ho RLS policies zo schema.sql. Kľúč "service_role" sem
   NIKDY nedávajte — obchádza všetky policies.
   ============================================================================ */

window.BS_CONFIG = {
  SUPABASE_URL:      'https://jznwgldtboecyzynrnrr.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6bndnbGR0Ym9lY3l6eW5ybnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NzA5MTAsImV4cCI6MjEwMzM0NjkxMH0.2CE5yV40_8OJKC2vlnc3bErGka-kq4YKPaHWa9zmAL8',

  /* Push upozornenia do telefónu admina (migrácia 19).
     Toto je VEREJNÁ časť kľúča — do prehliadača patrí. Súkromná časť je
     len v Supabase → Edge Functions → Secrets (VAPID_PRIVATE_KEY).
     Ak by sa kľúč menil, treba zmeniť oba naraz a upozornenia si
     v appke zapnúť znova — staré odbery s novým kľúčom nefungujú. */
  VAPID_PUBLIC_KEY: 'BAHX9cBHNua9fr2qmyOtBAmiZJ-kcPQn1R556z_uv2i1u565EwsdrBGHDvr38lUp9_qiYHp881A2lJi_fKfyt2M',

  /* Režim Android appky „Dresy": admin vidí len schvaľovanie, zmeny
     a export pre dodávateľov, a môže si zapnúť upozornenia do telefónu.
     Na webe klubu je VŽDY false. Na true ho prepína publikuj-appku.js
     v kópii, z ktorej beží appka (timo-t-q.github.io/dresy). */
  APPKA: true,

  // Rozsah čísel v mriežke dresov
  NUMBER_MIN: 1,
  NUMBER_MAX: 99,

  /* Čísla, ktoré si rodič nesmie vybrať sám.
     #1 je brankárske — prideľuje ho klub podľa toho, kto chytá,
     nie ten, kto sa prvý prihlási. V mriežke je zamknuté; admin ho
     hráčovi pridelí kliknutím na to číslo vo svojej mriežke. */
  CISLA_LEN_PRE_KLUB: [1],

  // Klubové pravidlo: zdieľať jedno číslo môžu len hráči
  // s rozdielom veku aspoň toľkoto rokov.
  MIN_AGE_GAP: 5,

  /* --------------------------------------------------------------------
     CENNÍK — ceny v eurách, od výrobcu (6. 9. 2026)

     Rodič si vyberá KUSY, nie zmeny. Zmena veľkosti je len jeden
     z dôvodov, prečo si kus kupuje — kúpiť sa dá aj bez zmeny
     (dres sa roztrhol, dieťa chce druhú sadu).

     SADA je zvýhodnená cena za celý komplet naraz. Uplatní sa až
     v súčte, keď má rodič naklikané všetko, čo do sady jeho kategórie
     patrí — čo to je, hovorí `sada` pri kategórii nižšie.

     Ak je cena `null`, appka ju nezobrazí a v súhrne upozorní,
     že ju doplní klub.
     -------------------------------------------------------------------- */
  CENNIK: {
    vrch:    25,   // vrch dresu — tmavý aj svetlý stoja rovnako
    kratase: 22,   // kraťasy sú vždy tmavé
    stulpne:  5,   // jeden pár; druhý pár v inej farbe stojí ďalších 5

    // Cena za celú sadu naraz. Kľúč = `sada` kategórie.
    SADY: {
      dvaVrchy:  75,   // tmavý + svetlý vrch + kraťasy + jedny štulpne
      jedenVrch: 50    // tmavý vrch + kraťasy + jedny štulpne
    }
  },

  /* --------------------------------------------------------------------
     VEĽKOSTI

     Rodič si veľkosť VYBERÁ zo zoznamu, nepíše ju voľne. Predtým to bolo
     textové pole a výrobca dostal presne to, čo tam ktorý rodič napísal.

     `kod`   ide do databázy a na objednávku pre výrobcu — musí sedieť
             s tým, ako veľkosti volá dodávateľ
     `alt`   alternatívne označenie tej istej veľkosti (140 = 4XS)
     `vyska` orientačná výška dieťaťa v cm
     `sirka` A — šírka pod pazuchami, `dlzka` B — dĺžka od ramena
             (rozmery platia pre vrch, kraťasy majú len výšku)

     ⚠ POTVRDIŤ U DODÁVATEĽA. Podklady sú z materiálov, ktoré poslal
       (ATAK, model Tri Classic Basic), ale rozmery nikto nepreveril kus
       po kuse. Kým sa to nestane, platí, že si rodičia môžu vybrať len
       to, čo je v tomto zozname — takže keď tu niečo chýba alebo prebýva,
       prejaví sa to na každej objednávke.
     -------------------------------------------------------------------- */
  VELKOSTI: [
    { kod: '110', alt: null,  vyska: '110',     sirka: 33, dlzka: 48 },
    { kod: '116', alt: null,  vyska: '116',     sirka: 36, dlzka: 50 },
    { kod: '122', alt: null,  vyska: '122',     sirka: 36, dlzka: 52 },
    { kod: '128', alt: null,  vyska: '128',     sirka: 39, dlzka: 54 },
    { kod: '134', alt: null,  vyska: '134',     sirka: 39, dlzka: 56 },
    { kod: '140', alt: '4XS', vyska: '140',     sirka: 42, dlzka: 58 },
    { kod: '146', alt: '3XS', vyska: '146',     sirka: 42, dlzka: 60 },
    { kod: '152', alt: '2XS', vyska: '152',     sirka: 45, dlzka: 62 },
    { kod: '158', alt: 'XS',  vyska: '158',     sirka: 48, dlzka: 64 },
    { kod: '164', alt: null,  vyska: '164',     sirka: 48, dlzka: 66 },
    { kod: 'S',   alt: null,  vyska: '164–170', sirka: 50, dlzka: 66 },
    { kod: 'M',   alt: null,  vyska: '170',     sirka: 53, dlzka: 68 },
    { kod: 'L',   alt: null,  vyska: '176',     sirka: 56, dlzka: 70 },
    { kod: 'XL',  alt: null,  vyska: '182',     sirka: 59, dlzka: 72 },
    { kod: '2XL', alt: null,  vyska: '188',     sirka: 62, dlzka: 74 }
  ],

  // Koľko znakov sa zmestí na chrbát dresu.
  MAX_ZNAKOV_MENO: 14,

  /* --------------------------------------------------------------------
     OBJEDNÁVKOVÉ PRAVIDLÁ
     -------------------------------------------------------------------- */

  // Výrobca berie objednávku až od tohto počtu kusov.
  MIN_OBJEDNAVKA:   7,
  // Počet, pri ktorom sa objednávka oplatí najviac.
  IDEAL_OBJEDNAVKA: 10,

  // Po koľkých dňoch sa čakajúca žiadosť považuje za možno neaktuálnu.
  // Deti rastú — veľkosť zadaná pred mesiacmi už nemusí sedieť.
  PLATNOST_ZIADOSTI_DNI: 30,

  // Ako dlho ostane zahodená žiadosť v koši, kým sa zmaže natrvalo.
  KOS_DNI: 15,

  // Do koľkých minút od odoslania si rodič môže žiadosť sám zrušiť.
  // ⚠ Rovnaké číslo je v databázovej funkcii cancel_request() (migrácia 16).
  //   Tá je rozhodujúca — toto číslo len riadi, kedy sa ukáže tlačidlo.
  ZRUSENIE_MINUT: 15,

  /* --------------------------------------------------------------------
     KATEGÓRIE PODĽA ROČNÍKA

     ⚠ AKTUALIZOVAŤ KAŽDÚ SEZÓNU — deti postupujú o kategóriu vyššie,
       takže ročníky sa každý rok posúvajú.

     `svetly` — či kategória svetlý vrch potrebuje:
       'bezny'       hrá v ňom bežne, ponúkne sa rovnocenne s tmavým
       'dobrovolny'  neponúkne sa nikomu, kým ho admin konkrétnemu hráčovi
                     nepovolí v Správe hráčov (SP, ktorí hrajú aj za MZ)
       'ziadny'      neponúkne sa vôbec — rodič ho ani neuvidí

     `sada` — kľúč do CENNIK.SADY. Hovorí aj to, čo do sady patrí:
       'dvaVrchy'   tmavý + svetlý vrch + kraťasy + jedny štulpne
       'jedenVrch'  tmavý vrch + kraťasy + jedny štulpne

     Kraťasy sú vždy len tmavé. Štulpne si smie ktokoľvek objednať
     v oboch farbách — tréner vie, komu ktoré dať, a veľkosť nemajú.

     Hráč mimo týchto ročníkov kategóriu nemá. Appka ho nenechá visieť:
     starší než najstaršia kategória dostane jej pravidlá, mladší než
     najmladšia zase tie jej. Cenu sady mu ale nepočíta — nevie, do
     ktorej naozaj patrí, a radšej mu naúčtuje po kusoch, než aby
     mu sľúbila zľavu, ktorá mu nepatrí.
     -------------------------------------------------------------------- */
  KATEGORIE: [
    { kod: 'SZ', nazov: 'Starší žiaci',      rocniky: [2012, 2013],
      svetly: 'bezny',      sada: 'dvaVrchy' },

    { kod: 'MZ', nazov: 'Mladší žiaci',      rocniky: [2014, 2015],
      svetly: 'bezny',      sada: 'dvaVrchy' },

    { kod: 'SP', nazov: 'Staršia prípravka', rocniky: [2016, 2017],
      svetly: 'dobrovolny', sada: 'jedenVrch',
      svetlyPoznamka: 'Svetlý vrch vám klub povolil, lebo dieťa hrá aj za mladších žiakov.' },

    { kod: 'MP', nazov: 'Mladšia prípravka', rocniky: [2018, 2019, 2020],
      svetly: 'ziadny',     sada: 'jedenVrch' }
  ]
};

/* Prihlasovacie údaje (demo aj reálne) sa NIKDE v appke nezobrazujú —
   držte si ich mimo repozitára, napr. v poznámkach k prezentácii. */
