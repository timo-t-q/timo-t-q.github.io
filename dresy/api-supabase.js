/* ============================================================================
   WARRIORS — api-supabase.js
   DÁTOVÁ VRSTVA (Supabase / PostgreSQL)

   Toto je JEDINÝ súbor, ktorý vie o Supabase. UI (index.html) volá výhradne
   funkcie objektu `window.api` a o databáze nevie nič.

   Pri prechode na websupport.sk stačí napísať `api-mysql.js` s tými istými
   funkciami a v index.html vymeniť jeden <script> riadok. Podrobnosti sú
   v README.md v sekcii "Výmena backendu".

   ---------------------------------------------------------------------------
   KONTRAKT (tvar dát, ktorý UI očakáva)
   ---------------------------------------------------------------------------
   player   = { id, number, name, fullname, birth, jerseySize, shortsSize, userId }
   change   = { field, label, oldVal, newVal }
   request  = { id, playerId, type, changes[], proposed{}, oldValue, newValue,
                status: 'pending'|'done'|'rejected', ts: Date, note }
   logEntry = { id, playerId, type, desc, ts: Date }
   numCell  = { number, playerId, fullname, birth, pending }
                fullname je null pre cudzieho rodiča — meno hráča vidí len
                admin a rodič pri vlastnom dieťati (migrácia 08)
   ============================================================================ */

(function () {
  'use strict';

  const cfg = window.BS_CONFIG;

  if (!cfg || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('VASPROJEKT')) {
    console.error('[api] Chýba konfigurácia — vyplňte config.js (SUPABASE_URL a SUPABASE_ANON_KEY).');
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /* ---------------------------------------------------------------------
     Odkazy z e-mailu (prihlásenie linkom, obnova hesla)

     Supabase vráti token v adrese za mriežkou a knižnica ho vzápätí
     spracuje a z adresy odstráni. Preto si obsah čítame hneď pri načítaní,
     inak by nám do štartu appky nič neostalo.
     --------------------------------------------------------------------- */
  const HASH_PRI_STARTE = window.location.hash || '';

  function citajHash(kluc) {
    const m = new RegExp('[#&]' + kluc + '=([^&]*)').exec(HASH_PRI_STARTE);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  const CHYBA_Z_ODKAZU = citajHash('error_description') || citajHash('error');
  const KOD_CHYBY      = citajHash('error_code');
  const JE_OBNOVA      = citajHash('type') === 'recovery';

  /* Odkaz s kódom v adrese (?token_hash=…&type=…)
     Šablóny mailov v Supabase vedú priamo na warriorsflorbal.sk/dresy,
     nie na supabase.co. Školské a firemné pošty (Microsoft 365) odkaz na
     cudziu doménu označia ako podozrivý, alebo ho vopred „prekliknú" a
     jednorazový odkaz tým spotrebujú. Kód preto overíme až tu, v prehliadači
     rodiča — kontrola pošty JavaScript nespúšťa. */
  const PARAMETRE    = new URLSearchParams(window.location.search);
  const TOKEN_HASH   = PARAMETRE.get('token_hash');
  const TYP_ODKAZU   = PARAMETRE.get('type');
  const TYPY_ODKAZU  = ['email', 'magiclink', 'signup', 'invite', 'recovery', 'email_change'];
  let chybaOverenia  = null;
  let overenieOdkazu = null;

  /* ---------------------------------------------------------------------
     Mapovanie DB (snake_case) ↔ UI (camelCase)
     --------------------------------------------------------------------- */
  // Tmavý a svetlý vrch sú dva samostatné kusy oblečenia — každý má vlastné
  // meno aj veľkosť a nemusia sa zhodovať (migrácia 15). Kraťasy sú vždy
  // len tmavé, preto majú jedinú veľkosť.
  const toPlayer = (row) => ({
    id:              row.id,
    number:          row.number,
    name:            row.name,
    nameLight:       row.name_light,
    fullname:        row.fullname,
    birth:           row.birth,
    jerseySize:      row.jersey_size,
    jerseySizeLight: row.jersey_size_light,
    shortsSize:      row.shorts_size,
    // Admin povolil svetlý vrch hráčovi, ktorého kategória ho inak nevidí
    svetlyPovoleny:  !!row.svetly_povoleny,
    // Hráč môže mať viac rodičov (napr. otec aj mama po rozvode).
    // Väzby drží tabuľka player_parents; players.user_id sa už nepoužíva.
    parents:    Array.isArray(row.player_parents)
                  ? row.player_parents.map(x => x.user_id)
                  : []
  });

  const toRequest = (row) => ({
    id:        row.id,
    playerId:  row.player_id,
    type:      row.type,
    changes:   row.changes  || [],
    proposed:  row.proposed || {},
    oldValue:  row.old_value,
    newValue:  row.new_value,
    status:    row.status,
    note:      row.note,
    createdBy: row.created_by,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    // V ktorej výzve na platbu objednávka je (migrácia 20); null = ešte nebola
    platbaId:  row.platba_id || null,
    ts:        new Date(row.created_at)
  });

  const toPlatba = (row) => ({
    id:        row.id,
    rodicia:   row.rodicia || [],
    meno:      row.meno,
    kontakt:   row.kontakt,
    obsah:     Array.isArray(row.obsah) ? row.obsah : [],
    suma:      Number(row.suma),
    stav:      row.stav,          // 'poslana' | 'zaplatena'
    poslanaAt: new Date(row.poslana_at),
    zaplatenaAt: row.zaplatena_at ? new Date(row.zaplatena_at) : null
  });

  const toLog = (row) => ({
    id:       row.id,
    playerId: row.player_id,
    type:     row.type,
    desc:     row.description,
    ts:       new Date(row.created_at)
  });

  const toRegistration = (row) => ({
    id:           row.id,
    userId:       row.user_id,
    email:        row.email,
    parentName:   row.parent_name,
    phone:        row.phone,
    childrenNote: row.children_note,
    children:     Array.isArray(row.children) ? row.children : [],
    status:       row.status,
    note:         row.note,
    ts:           new Date(row.created_at),
    processedAt:  row.processed_at ? new Date(row.processed_at) : null
  });

  /* Či má prehliadač platné prihlásenie. Keď vyprší (zmena hesla na inom
     zariadení, odhlásenie v inom okne), obrazovka ešte ukazuje admina, ale
     požiadavky už idú ako neprihlásený — a databáza ich odmietne. Bez tohto
     by appka hlásila „nemáte oprávnenie", hoci ide len o prihlásenie. */
  let jePrihlaseny = false;
  sb.auth.onAuthStateChange((_event, session) => { jePrihlaseny = !!session; });

  // Zrozumiteľná chybová hláška namiesto surového Postgres výstupu
  function fail(err, fallback) {
    if (!err) return;
    const msg = err.message || String(err);
    if (/JWT expired|PGRST301/i.test(msg) ||
        (!jePrihlaseny && /row-level security|permission denied|42501/i.test(msg))) {
      throw new Error('Prihlásenie vypršalo. Obnovte stránku (F5) a prihláste sa znova.');
    }
    if (/row-level security|permission denied|42501/i.test(msg)) {
      throw new Error('Nemáte oprávnenie na túto operáciu.');
    }
    console.error('[api]', err);
    throw new Error(fallback ? fallback + ' (' + msg + ')' : msg);
  }

  /* Chyby pri posielaní odkazu na e-mail — spoločné pre prihlasovací odkaz
     aj pre obnovu hesla. Vráti zrozumiteľnú vetu, alebo null, ak chybu
     nepoznáme a má sa vypísať tak, ako prišla. */
  function chybaOdkazu(err) {
    const m = (err && err.message) || '';
    if (/rate limit|too many|after [0-9]+ seconds/i.test(m))
      return 'Odkaz sme práve poslali. Počkajte chvíľu a skúste znova.';
    if (/signups not allowed/i.test(m))
      return 'Na tento e-mail zatiaľ nemáte konto. Vráťte sa späť a kliknite na „Zaregistrujte sa".';
    // Supabase poštu neodoslal — vypadol SMTP, minula sa kvóta alebo je
    // odosielacia doména ešte neoverená. Rodič s tým nevie nič spraviť,
    // tak nemá zmysel ukazovať mu anglickú hlášku zo servera.
    if (/error sending|smtp|mail/i.test(m))
      return 'E-mail sa nepodarilo odoslať. Skúste to o chvíľu znova — ak to nepomôže, ozvite sa klubu.';
    return null;
  }

  window.api = {

    /* =====================================================================
       AUTENTIFIKÁCIA
       ===================================================================== */

    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({
        email: (email || '').trim(),
        password: password || ''
      });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) {
          throw new Error('Nesprávny e-mail alebo heslo.');
        }
        if (/email not confirmed/i.test(error.message)) {
          throw new Error('E-mail konta nie je potvrdený — v dashboarde zaškrtnite "Auto Confirm User".');
        }
        fail(error, 'Prihlásenie zlyhalo');
      }
      return data.user;
    },

    async signOut() {
      const { error } = await sb.auth.signOut();
      fail(error, 'Odhlásenie zlyhalo');
    },

    // Vytvorenie konta rodičom. Vracia { user, session }.
    // session je null, ak má projekt zapnuté potvrdzovanie e-mailu —
    // vtedy sa rodič musí najprv prihlásiť a žiadosť vyplní až potom.
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({
        email: (email || '').trim(),
        password: password || ''
      });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          throw new Error('Na tento e-mail už konto existuje. Ak heslo nepoznáte, vráťte sa na prihlásenie ' +
                          'a kliknite na „Zabudli ste heslo?" — pošleme vám odkaz.');
        }
        if (/password/i.test(error.message) && /least|short/i.test(error.message)) {
          throw new Error('Heslo je príliš krátke — použite aspoň 6 znakov.');
        }
        if (/signups not allowed|disabled/i.test(error.message)) {
          throw new Error('Registrácia je vypnutá. Kontaktujte admina klubu.');
        }
        fail(error, 'Vytvorenie konta zlyhalo');
      }
      return { user: data.user, session: data.session };
    },

    /* ---- Odkazy z e-mailu ---- */

    // Prihlásenie bez hesla — príde odkaz, po kliknutí je používateľ vnútri
    async sendMagicLink(email) {
      const { error } = await sb.auth.signInWithOtp({
        email: (email || '').trim(),
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
          /* Bez tohto Supabase na neznámy e-mail potichu ZALOŽÍ konto.
             Rodič sa potom prihlási odkazom, nemá heslo ani žiadosť,
             a keď skúsi „Zaregistrujte sa", dozvie sa, že konto už má.
             Presne tak uviazol 23. 9. rodič s dvoma prázdnymi kontami. */
          shouldCreateUser: false
        }
      });
      if (error) {
        const zrozumitelna = chybaOdkazu(error);
        if (zrozumitelna) { console.error('[api]', error); throw new Error(zrozumitelna); }
        fail(error, 'Odoslanie odkazu zlyhalo');
      }
    },

    // Obnova zabudnutého hesla
    async sendPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail((email || '').trim(), {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) {
        const zrozumitelna = chybaOdkazu(error);
        if (zrozumitelna) { console.error('[api]', error); throw new Error(zrozumitelna); }
        fail(error, 'Odoslanie odkazu zlyhalo');
      }
    },

    // Nastavenie nového hesla (po kliknutí na odkaz z e-mailu)
    async updatePassword(noveHeslo) {
      const { error } = await sb.auth.updateUser({ password: noveHeslo });
      if (error) {
        if (/should be at least|too short|6 characters/i.test(error.message)) {
          throw new Error('Heslo musí mať aspoň 6 znakov.');
        }
        if (/same.*password|different from the old/i.test(error.message)) {
          throw new Error('Nové heslo musí byť iné ako to pôvodné.');
        }
        if (/session|expired|invalid/i.test(error.message)) {
          throw new Error('Platnosť odkazu vypršala. Nechajte si poslať nový.');
        }
        fail(error, 'Zmena hesla zlyhala');
      }
    },

    // Overí kód z odkazu v e-maile a prihlási. Volá sa raz pri štarte appky.
    async spracujOdkaz() {
      if (!TOKEN_HASH) return;
      if (!overenieOdkazu) {
        overenieOdkazu = (async () => {
          const typ = TYPY_ODKAZU.indexOf(TYP_ODKAZU) !== -1 ? TYP_ODKAZU : 'email';
          const { error } = await sb.auth.verifyOtp({ token_hash: TOKEN_HASH, type: typ });
          if (error) chybaOverenia = error.message || 'invalid';
          // Kód je jednorazový — z adresy ho odstránime, aby ho F5 neskúšal znova
          window.history.replaceState(null, '', window.location.pathname);
        })();
      }
      return overenieOdkazu;
    },

    // Prišiel používateľ z odkazu na obnovu hesla?
    jeObnovaHesla() {
      return JE_OBNOVA || (TYP_ODKAZU === 'recovery' && !chybaOverenia);
    },

    // Chyba z odkazu — z adresy (starý tvar) alebo z overenia kódu (nový tvar)
    chybaZOdkazu() {
      const chyba = CHYBA_Z_ODKAZU || chybaOverenia;
      if (!chyba) return null;
      if (KOD_CHYBY === 'otp_expired' || /expired/i.test(chyba))
        return 'Platnosť odkazu vypršala alebo už bol použitý. Nechajte si poslať nový.';
      if (/access_denied|invalid/i.test(chyba))
        return 'Odkaz už bol použitý alebo nie je platný. Nechajte si poslať nový.';
      return chyba;
    },

    // Vráti { user } alebo null
    async getSession() {
      const { data } = await sb.auth.getSession();
      return data.session || null;
    },

    onAuthChange(cb) {
      sb.auth.onAuthStateChange((_event, session) => cb(session));
    },

    // 'admin' alebo 'parent'
    async getRole() {
      const { data, error } = await sb.rpc('is_admin');
      fail(error, 'Nepodarilo sa zistiť rolu používateľa');
      return data === true ? 'admin' : 'parent';
    },

    /* =====================================================================
       HRÁČI
       ===================================================================== */

    // Rodič: len svoje deti. Admin: dostane všetkých (rieši RLS policy).
    async getMyPlayers() {
      const { data, error } = await sb
        .from('players')
        .select('*, player_parents(user_id)')
        .order('number', { ascending: true });
      fail(error, 'Načítanie hráčov zlyhalo');
      return (data || []).map(toPlayer);
    },

    // Admin: všetci hráči klubu (rovnaký dotaz, iné RLS práva)
    async getAllPlayers() {
      return this.getMyPlayers();
    },

    // Obsadenosť čísel pre mriežku — cez SECURITY DEFINER funkciu,
    // aby rodič videl obsadené čísla aj bez prístupu k cudzím hráčom.
    async getNumberMap() {
      const { data, error } = await sb.rpc('number_map');
      fail(error, 'Načítanie obsadenosti čísel zlyhalo');
      return data || [];
    },

    async addPlayer(p) {
      const { data, error } = await sb
        .from('players')
        .insert({
          number:            parseInt(p.number, 10),
          name:              p.name,
          name_light:        p.nameLight || null,
          fullname:          p.fullname,
          birth:             p.birth ? parseInt(p.birth, 10) : null,
          jersey_size:       p.jerseySize || null,
          jersey_size_light: p.jerseySizeLight || null,
          shorts_size:       p.shortsSize || null
        })
        .select()
        .single();
      fail(error, 'Pridanie hráča zlyhalo');
      return toPlayer(data);
    },

    async removePlayer(playerId) {
      const { error } = await sb.from('players').delete().eq('id', playerId);
      fail(error, 'Odobratie hráča zlyhalo');
    },

    /* Admin pridelí číslo priamo, bez žiadosti od rodiča.
       Je to jediná cesta k #1 — brankárske číslo si rodič v mriežke
       vybrať nemôže, lebo o tom, kto chytá, nerozhoduje ten, kto sa
       prvý prihlási. Zápis do histórie hovorí, že číslo nepridelila
       appka sama, ale človek. */
    async setPlayerNumber(playerId, cislo) {
      const { data, error } = await sb
        .from('players')
        .update({ number: cislo, updated_at: new Date().toISOString() })
        .eq('id', playerId)
        .select()
        .single();
      fail(error, 'Pridelenie čísla zlyhalo');

      const { error: chyba } = await sb.from('changelog').insert({
        player_id:   playerId,
        type:        'Zmena čísla',
        description: cislo == null
          ? 'Admin odobral číslo dresu.'
          : 'Admin pridelil číslo dresu #' + cislo + '.'
      });
      // História je dôležitá, ale samotné číslo je už zapísané —
      // keby padol zápis do histórie, nemá zmysel rušiť celú operáciu.
      if (chyba) console.warn('[api] číslo pridelené, história sa nezapísala:', chyba.message);

      return toPlayer(data);
    },

    // Admin povolí alebo zakáže svetlý vrch konkrétnemu hráčovi (SP, ktorí hrajú aj za MZ)
    async setSvetlyPovoleny(playerId, povoleny) {
      const { data, error } = await sb
        .from('players')
        .update({ svetly_povoleny: !!povoleny, updated_at: new Date().toISOString() })
        .eq('id', playerId)
        .select()
        .single();
      fail(error, 'Zmena povolenia svetlého dresu zlyhala');

      const { error: chyba } = await sb.from('changelog').insert({
        player_id:   playerId,
        type:        'Prístup',
        description: povoleny ? 'Admin povolil svetlý dres.' : 'Admin zrušil povolenie svetlého dresu.'
      });
      if (chyba) console.warn('[api] povolenie zmenené, história sa nezapísala:', chyba.message);

      return toPlayer(data);
    },

    /* =====================================================================
       ŽIADOSTI
       ===================================================================== */

    // Rodič: svoje. Admin: všetky. (Filtruje RLS, nie klient.)
    async getRequests(playerId) {
      let q = sb.from('requests').select('*')
                .is('deleted_at', null)                 // zahodené sú v koši
                .order('created_at', { ascending: false });
      if (playerId) q = q.eq('player_id', playerId);
      const { data, error } = await q;
      fail(error, 'Načítanie žiadostí zlyhalo');
      return (data || []).map(toRequest);
    },

    /* ---- Kôš na žiadosti (len admin) ---- */

    // Zahodené žiadosti; ostávajú 3 dni, potom ich zmaže purgeOldTrash()
    async getTrashedRequests() {
      const { data, error } = await sb.from('requests').select('*')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });
      fail(error, 'Načítanie koša zlyhalo');
      return (data || []).map(toRequest);
    },

    async trashRequest(reqId) {
      const { data, error } = await sb.rpc('trash_request', { req_id: reqId });
      fail(error, 'Zahodenie žiadosti zlyhalo');
      return data ? toRequest(data) : null;
    },

    async restoreRequest(reqId) {
      const { data, error } = await sb.rpc('restore_request', { req_id: reqId });
      fail(error, 'Obnovenie žiadosti zlyhalo');
      return data ? toRequest(data) : null;
    },

    // Nenávratné zmazanie z koša
    async purgeRequest(reqId) {
      const { error } = await sb.rpc('purge_request', { req_id: reqId });
      fail(error, 'Zmazanie z koša zlyhalo');
    },

    // Automatické vyprázdnenie koša po N dňoch; volá sa pri načítaní dashboardu
    async purgeOldTrash(dni) {
      const { data, error } = await sb.rpc('purge_old_trash', { dni: dni || 3 });
      if (error) { console.warn('[api] purge_old_trash:', error.message); return 0; }
      return data || 0;
    },

    /* ---- Platby rodičov (len admin, migrácia 20) ----
       Poslané aj zaplatené ostávajú v zozname — nezávisle od toho,
       či admin objednávky už spracoval. Archív sa nenačítava. */

    // Chyba = migrácia 20 ešte nebežala; appka potom ukáže starý zoznam
    async getPlatby() {
      const { data, error } = await sb.from('platby').select('*')
        .in('stav', ['poslana', 'zaplatena'])
        .order('poslana_at', { ascending: false });
      fail(error, 'Načítanie platieb zlyhalo');
      return (data || []).map(toPlatba);
    },

    // p = { ziadosti[], rodicia[], meno, kontakt, obsah[], suma }
    async platbaPoslana(p) {
      const { data, error } = await sb.rpc('platba_poslana', {
        p_ziadosti: p.ziadosti,
        p_rodicia:  p.rodicia,
        p_meno:     p.meno,
        p_kontakt:  p.kontakt || null,
        p_obsah:    p.obsah,
        p_suma:     p.suma
      });
      fail(error, 'Platbu sa nepodarilo označiť');
      return data;
    },

    async platbaVratit(id) {
      const { error } = await sb.rpc('platba_vratit', { p_id: id });
      fail(error, 'Platbu sa nepodarilo vrátiť');
    },

    async platbaZaplatena(id) {
      const { error } = await sb.rpc('platba_zaplatena', { p_id: id });
      fail(error, 'Platbu sa nepodarilo označiť ako zaplatenú');
    },

    async platbaNezaplatena(id) {
      const { error } = await sb.rpc('platba_nezaplatena', { p_id: id });
      fail(error, 'Platbu sa nepodarilo vrátiť medzi poslané');
    },

    // req = { playerId, type, changes[], proposed{}, oldValue, newValue }
    // Záznam do changelogu dopisuje databázový trigger — netreba druhý zápis.
    async submitRequest(req) {
      const session = await this.getSession();
      const { data, error } = await sb
        .from('requests')
        .insert({
          player_id:  req.playerId,
          created_by: session ? session.user.id : null,
          type:       req.type,
          changes:    req.changes,
          proposed:   req.proposed,
          old_value:  req.oldValue,
          new_value:  req.newValue,
          status:     'pending'
        })
        .select()
        .single();
      fail(error, 'Odoslanie žiadosti zlyhalo');
      return toRequest(data);
    },

    // Rodič zruší vlastnú žiadosť do 15 minút. Čas, stav aj autora overí
    // databáza (cancel_request, migrácia 16) — rodič na mazanie práva nemá.
    async cancelRequest(reqId) {
      const { error } = await sb.rpc('cancel_request', { req_id: reqId });
      if (error) {
        // hlášky z funkcie sú už po slovensky a pre rodiča zrozumiteľné
        if (/Zrušiť|Žiadosť|prihláste/.test(error.message || '')) throw new Error(error.message);
        fail(error, 'Zrušenie žiadosti zlyhalo');
      }
    },

    /* Rodič pridá ďalšie dieťa k už podanej žiadosti (migrácia 17).
       Žiadosť sa vráti adminovi na schválenie; deti, ktoré rodič už má,
       ostávajú. Vráti aktualizovanú registráciu. */
    async addChild(dieta) {
      const { data, error } = await sb.rpc('pridat_dalsie_dieta', {
        p_meno:  dieta.meno,
        p_datum: dieta.datum,
        p_cislo: dieta.cislo ? parseInt(dieta.cislo, 10) : null
      });
      if (error) {
        if (/Could not find the function|pridat_dalsie_dieta/i.test(error.message || ''))
          throw new Error('Pridanie dieťaťa ešte nie je zapnuté — admin musí spustiť migráciu 17.');
        if (/Vyplňte|Najprv|zamietnutá|najviac|už v žiadosti|Číslo dresu/.test(error.message || ''))
          throw new Error(error.message);
        fail(error, 'Pridanie dieťaťa zlyhalo');
      }
      return toRegistration(data);
    },

    // Admin "Hotovo ✓" — atomicky: aplikuje zmeny na hráča,
    // nastaví status 'done' a zapíše do changelogu.
    async processRequest(reqId) {
      const { data, error } = await sb.rpc('process_request', { req_id: reqId });
      fail(error, 'Spracovanie žiadosti zlyhalo');
      return data ? toRequest(data) : null;
    },

    async rejectRequest(reqId, reason) {
      const { data, error } = await sb.rpc('reject_request', {
        req_id: reqId,
        reason: reason || null
      });
      fail(error, 'Zamietnutie žiadosti zlyhalo');
      return data ? toRequest(data) : null;
    },

    // Vrátenie omylom spracovanej žiadosti späť medzi čakajúce.
    // Zároveň odroluje zmeny, ktoré sa už na hráča zapísali.
    async revertRequest(reqId) {
      const { data, error } = await sb.rpc('revert_request', { req_id: reqId });
      fail(error, 'Vrátenie žiadosti späť zlyhalo');
      return data ? toRequest(data) : null;
    },

    /* =====================================================================
       CHANGELOG / HISTÓRIA
       ===================================================================== */

    async getChangelog(opts) {
      opts = opts || {};
      let q = sb.from('changelog').select('*').order('created_at', { ascending: false });
      if (opts.playerId) q = q.eq('player_id', opts.playerId);
      if (opts.since)    q = q.gt('created_at', new Date(opts.since).toISOString());
      if (opts.limit)    q = q.limit(opts.limit);
      const { data, error } = await q;
      fail(error, 'Načítanie histórie zlyhalo');
      return (data || []).map(toLog);
    },

    /* =====================================================================
       REGISTRÁCIA RODIČOV
       ===================================================================== */

    // Vlastná žiadosť prihláseného rodiča (alebo null)
    async getMyRegistration() {
      const session = await this.getSession();
      if (!session) return null;
      const { data, error } = await sb
        .from('registrations')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      fail(error, 'Načítanie registrácie zlyhalo');
      return data ? toRegistration(data) : null;
    },

    // Podanie alebo oprava žiadosti (po zamietnutí sa dá poslať znova)
    async submitRegistration(reg) {
      const session = await this.getSession();
      if (!session) throw new Error('Najprv sa prihláste.');

      const zaznam = {
        user_id:       session.user.id,
        email:         session.user.email,
        parent_name:   reg.parentName,
        phone:         reg.phone || null,
        children_note: reg.childrenNote,
        children:      reg.children || [],
        status:        'pending',
        note:          null
      };

      const existuje = await this.getMyRegistration();
      let odpoved;
      if (existuje) {
        odpoved = await sb.from('registrations').update(zaznam)
          .eq('user_id', session.user.id).select().single();
      } else {
        odpoved = await sb.from('registrations').insert(zaznam).select().single();
      }
      fail(odpoved.error, 'Odoslanie žiadosti zlyhalo');
      return toRegistration(odpoved.data);
    },

    // Admin: všetky žiadosti (RLS pustí len admina)
    async getRegistrations() {
      const { data, error } = await sb
        .from('registrations')
        .select('*')
        .order('created_at', { ascending: false });
      fail(error, 'Načítanie registrácií zlyhalo');
      return (data || []).map(toRegistration);
    },

    // Admin: schválenie + priradenie hráčov (playerIds môže byť prázdne)
    async approveRegistration(regId, playerIds) {
      const { data, error } = await sb.rpc('approve_registration', {
        reg_id: regId,
        player_ids: playerIds || []
      });
      fail(error, 'Schválenie registrácie zlyhalo');
      return data ? toRegistration(data) : null;
    },

    async rejectRegistration(regId, reason) {
      const { data, error } = await sb.rpc('reject_registration', {
        reg_id: regId,
        reason: reason || null
      });
      fail(error, 'Zamietnutie registrácie zlyhalo');
      return data ? toRegistration(data) : null;
    },

    /* ---- Push upozornenia do telefónu admina (migrácia 19) ----
       Ukladá sa len adresa, kam push služba doručuje. Kľúče p256dh/auth
       zatiaľ netreba (push chodí bez obsahu), ale bez nich by sa neskôr
       nedalo poslať upozornenie s textom — preto sa odkladajú tiež. */
    async ulozPushOdber(odber, zariadenie) {
      const { error } = await sb.from('push_odbery').upsert({
        endpoint:   odber.endpoint,
        p256dh:     (odber.keys && odber.keys.p256dh) || null,
        auth:       (odber.keys && odber.keys.auth) || null,
        zariadenie: String(zariadenie || '').slice(0, 200)
      }, { onConflict: 'endpoint' });
      fail(error, 'Upozornenia sa nepodarilo zapnúť');
    },

    async zmazPushOdber(endpoint) {
      const { error } = await sb.from('push_odbery').delete().eq('endpoint', endpoint);
      fail(error, 'Upozornenia sa nepodarilo vypnúť');
    },

    /* ---- Admin zakladá konto rodičovi ----------------------------------
       Konto sa vytvorí bežnou registráciou, ale na ODDELENOM klientovi,
       ktorý si neuloží reláciu — admin tak ostane prihlásený.

       Zámerne sa nepoužíva supabase.auth.admin.createUser(): tá potrebuje
       kľúč service_role, ktorý obchádza všetky bezpečnostné pravidlá
       a do prehliadača nesmie.
       -------------------------------------------------------------------- */
    async createParentAccount(email, password) {
      const docasny = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'bs-temp-signup' }
      });
      const { error } = await docasny.auth.signUp({
        email: (email || '').trim(),
        password: password || ''
      });

      if (error) {
        // Konto už existuje — nevadí, naviažeme to existujúce
        if (/already registered|already exists|User already/i.test(error.message)) {
          return { vytvorene: false };
        }
        if (/password/i.test(error.message) && /least|short|6/i.test(error.message)) {
          throw new Error('Heslo je príliš krátke — použite aspoň 6 znakov.');
        }
        if (/signups not allowed|disabled/i.test(error.message)) {
          throw new Error('Registrácia je v Supabase vypnutá (Authentication → Providers → Email → Allow new users to sign up).');
        }
        if (/rate limit|too many/i.test(error.message)) {
          throw new Error('Supabase dočasne obmedzil počet nových kont. Skúste o chvíľu.');
        }
        fail(error, 'Vytvorenie konta zlyhalo');
      }
      return { vytvorene: true };
    },

    // Založí konto BEZ hesla a pošle rodičovi prihlasovací odkaz.
    // Admin sa tak k jeho heslu vôbec nedostane — rodič si ho nastaví sám
    // cez "Zabudli ste heslo?", alebo sa bude prihlasovať odkazom.
    // signInWithOtp konto rovno vytvorí, takže linkNewParent ho už nájde.
    async inviteParentAccount(email) {
      const docasny = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'bs-temp-invite' }
      });
      const { error } = await docasny.auth.signInWithOtp({
        email: (email || '').trim(),
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) {
        const zrozumitelna = chybaOdkazu(error);
        if (zrozumitelna) { console.error('[api]', error); throw new Error(zrozumitelna); }
        fail(error, 'Odoslanie pozvánky zlyhalo');
      }
    },

    // Založí rodičovi schválenú žiadosť a naviaže ho na hráča.
    // Konto s daným e-mailom už musí existovať.
    async linkNewParent(playerId, email, parentName, phone) {
      const { data, error } = await sb.rpc('link_new_parent', {
        p_id: playerId,
        u_email: email,
        parent_name: parentName,
        u_phone: phone || null
      });
      fail(error, 'Naviazanie rodiča zlyhalo');
      return data;
    },

    // Admin: odobratie JEDNÉHO rodiča od hráča (ostatní ostávajú)
    async unassignParent(playerId, userId) {
      const { error } = await sb.rpc('unassign_parent', { p_id: playerId, u_id: userId });
      fail(error, 'Odobratie rodiča zlyhalo');
    },

    // Admin: odobratie všetkých rodičov od hráča
    async unassignPlayer(playerId) {
      const { error } = await sb.rpc('unassign_player', { p_id: playerId });
      fail(error, 'Odobratie priradenia zlyhalo');
    },

    /* =====================================================================
       ADMIN — posledné prihlásenie
       ===================================================================== */

    async getAdminLastLogin() {
      const session = await this.getSession();
      if (!session) return null;
      const { data, error } = await sb
        .from('admin_users')
        .select('last_login')
        .eq('user_id', session.user.id)
        .maybeSingle();
      fail(error, 'Načítanie posledného prihlásenia zlyhalo');
      return data ? new Date(data.last_login) : null;
    },

    // Tlačidlo "Označiť ako videné"
    async touchAdminLogin() {
      const { data, error } = await sb.rpc('touch_admin_login');
      fail(error, 'Označenie ako videné zlyhalo');
      return data ? new Date(data) : new Date();
    }
  };
})();
