// The Endurance's hangar (2026-10-29) — an inventory screen, after Kevin's game reference: click the Endurance →
// category tabs (Skills / Commands / Plugins / Connectors), a grid of slots with GLoot-style pixel-art items (pixel-icons.js;
// the biggest skills take a 2×2 slot), the target session
// on the right as the "character" (its real numbers as stat bars), and the chosen item's card along the bottom.
// Implant an item into a session — drag a tile onto a bubble or a Sessions row, or double-click a tile to implant it
// into the session on the right — and the probe flies it from the Endurance to that bubble (probe-deliver.js). The
// session is selected and its terminal comes up at once; when the probe arrives the command is typed into its input
// (not sent): "/<skill> " for a skill or command, "Use the <connector> connector to " for a connector.
// Items implanted this run are marked E (equipped) for that session. Data: main.js hangar:list. Loaded after app.js.
// Each item's card has its actions: Implant / Remove (skills and commands go to a trash with Undo; plugins are
// uninstalled; MCP servers removed; claude.ai connectors open claude.ai). The Discover tab finds new ones — Anthropic's
// skills, Anthropic's plugin directory by category, the most-starred claude-skills / mcp-server repos on GitHub, the
// official MCP Registry — searchable, with Install / Open on each (hangar-main.js).
(() => {
  const MIME = 'application/x-mesh-cap', GOLD = '#d9b86c';
  let el = null, data = null, loading = null, tab = 'skill', pick = null, target = null, disc = null, discQ = null, discLoading = false, sub = 'anthropicSkills', cat = 'all', busy = null, undoBar = null, discT = 0;
  const equipped = new Map();                                                  // sid → Set of item names implanted this run
  // which pixel sprite (pixel-icons.js, GLoot-style) an item gets, from what its name / description talks about
  const iconFor = c => {                                                      // the name decides first, the description if the name says nothing
    const byName = iconOf({ ...c, desc: '' }); return byName !== 'sword' ? byName : iconOf(c);
  };
  const iconOf = c => {
    const s = (c.name + ' ' + (c.desc || '')).toLowerCase(), has = (...w) => w.some(x => s.includes(x));
    if (c.kind === 'connector' || c.src === 'github-mcp' || c.src === 'mcp-registry') return has('calendar') ? 'hourglass' : has('gmail', 'mail') ? 'envelope' : has('drive') ? 'barrel' : has('snowflake', 'database', 'sql', 'data') ? 'chest'
      : has('blender', '3d') ? 'gem' : has('docs', 'notion', 'confluence') ? 'tome' : has('apify', 'scrap') ? 'hammer' : has('rea', 'reverse') ? 'lens' : has('monday') ? 'crown' : has('slack', 'chat') ? 'amulet' : has('github', 'git') ? 'compass' : 'gkey';
    return has('ticket', 'issue') ? 'ticket' : has('alert', 'alarm') ? 'bell' : has('slide', 'deck', 'pptx') ? 'gscroll' : has('sheet', 'xlsx', 'spreadsheet') ? 'map'
      : has('blender', '3d', 'image', 'flux') ? 'gem' : has('scrap', 'apify', 'actor') ? 'hammer' : has('broadcast', 'notify') ? 'lantern' : has('chat', 'monday', 'request', 'mail') ? 'envelope' : has('design', 'frontend', 'artifact') ? 'quill'
      : has('trader', 'price', 'cost', 'sales') ? 'coin' : has('chart', 'dataviz', 'review', 'propagate') ? 'potion' : has('report', 'weekly', 'wbr', 'docx', 'pdf', 'doc') ? 'book' : has('reverse', 'search', 'lookup', 'find') ? 'lens'
      : has('schedule', 'loop', 'daily', 'cron', 'sync') ? 'hourglass' : has('server', 'deploy', 'run') ? 'boots' : has('security', 'incident', 'guard') ? 'armour' : has('config', 'setting', 'keybind', 'init') ? 'shield'
      : has('sweep', 'clean', 'delete', 'remove') ? 'bomb' : has('lead', 'manager', 'boss', 'chief') ? 'crown' : 'sword';
  };
  // every item in a tab gets its own picture: its natural one, or the next free one that suits (2026-10-30, Kevin: "more variety")
  const ALT_SKILL = ['sword', 'dagger', 'axe', 'staff', 'book', 'tome', 'scroll', 'gscroll', 'potion', 'gem', 'ring', 'amulet', 'helmet', 'armour', 'shield', 'lantern', 'compass', 'quill', 'map', 'lens', 'hammer', 'bell', 'boots', 'crown', 'coin', 'hourglass', 'bomb', 'chest', 'barrel', 'orb', 'envelope', 'ticket', 'key', 'gkey'];
  const ALT_CONN = ['gkey', 'key', 'orb', 'gem', 'lantern', 'compass', 'ring', 'amulet', 'crown', 'hourglass', 'tome', 'gscroll', 'chest', 'barrel', 'coin', 'armour', 'helmet', 'staff', 'bell', 'envelope', 'map', 'lens', 'hammer', 'book', 'potion', 'shield', 'sword', 'dagger', 'axe', 'boots', 'quill', 'bomb', 'scroll', 'ticket'];
  const picked = new Map(), tint = new Map();                                   // tint: how many earlier items share this picture (→ a different colour)
  const pickIcons = list => {
    picked.clear(); tint.clear(); const used = new Set(), count = new Map();
    for (const c of list) {
      const id = c.key || c.name, pref = iconFor(c), conn = c.kind === 'connector' || c.src === 'github-mcp' || c.src === 'mcp-registry', alts = conn ? ALT_CONN : ALT_SKILL;
      let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      let ic = pref; if (used.has(ic)) for (let i = 0; i < alts.length; i++) { const a = alts[(h + i) % alts.length]; if (!used.has(a)) { ic = a; break; } }
      if (used.has(ic)) { let best = alts[h % alts.length]; for (let i = 0; i < alts.length; i++) { const a = alts[(h + i) % alts.length]; if ((count.get(a) || 0) < (count.get(best) || 0)) best = a; } ic = best; }   // more items than pictures: the least-used one, recoloured
      const n = count.get(ic) || 0; count.set(ic, n + 1); used.add(ic); picked.set(id, ic); tint.set(id, n);
    }
  };
  const iconOfItem = c => picked.get(c.key || c.name) || iconFor(c);
  const pxImg = (c, sz) => { const n = tint.get(c.key || c.name) || 0, ic = iconOfItem(c), file = window.PX_GLOOT_FILES && PX_GLOOT_FILES.has(ic);
    return `<img class="px" draggable="false" width="${sz}" height="${sz}" src="${window.pixelIconURL ? pixelIconURL(ic, c.name, n) : ''}" alt=""${file && n ? ` style="filter:hue-rotate(${(n * 137) % 360}deg) drop-shadow(0 3px 0 rgba(0,0,0,.45))"` : ''}>`; };
  const textFor = c => c.kind === 'connector' ? `Use the ${c.name} connector to ` : `/${c.name} `;

  const st = document.createElement('style');
  st.textContent = `#hangar { position: fixed; z-index: 45; inset: 0; display: none; place-items: center; background: rgba(0,0,0,.5); } #hangar *, #hangar *::before { box-sizing: border-box; }
    #hangar .hg { position: relative; width: min(var(--hw, min(980px, 94vw)), calc(100vw - 16px)); height: min(var(--hh, min(640px, 90vh)), calc(100vh - 16px)); container: hg / size; background: radial-gradient(120% 90% at 30% 20%, #10131b, #07080b 70%); border: 1px solid #1d2230; border-radius: 6px; color: #e9e6dc; font-family: "SF Pro Text", -apple-system, system-ui, sans-serif; }
    #hangar .hgi { --rc: clamp(240px, 30cqw, 380px); --cg: clamp(14px, 2.2cqw, 24px); position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr) var(--rc); grid-template-rows: auto auto minmax(0, 1fr) auto auto; gap: 0 var(--cg); padding: clamp(14px, 2.4cqh, 24px) clamp(16px, 3cqw, 32px) 12px; overflow: hidden; }
    /* the resize grip (bottom-right) — or pinch anywhere on the inventory */
    #hangar .grip { position: absolute; right: 4px; bottom: 4px; width: 16px; height: 16px; z-index: 3; cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, #5b5440 50%, #5b5440 58%, transparent 58%, transparent 70%, #5b5440 70%, #5b5440 78%, transparent 78%); opacity: .8; } #hangar .grip:hover { opacity: 1; }
    #hangar .szt { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 4; font: 600 11px/1 -apple-system, system-ui, sans-serif; color: #e9e6dc; background: rgba(12,14,22,.85); border: 1px solid #3a3e4a; padding: 5px 9px; border-radius: 10px; pointer-events: none; opacity: 0; transition: opacity .25s; } #hangar .szt.on { opacity: 1; }
    #hangar .hg::before { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px); background-size: 4px 4px; mix-blend-mode: screen; opacity: .6; }
    #hangar .cn { position: absolute; width: 26px; height: 26px; border: 3px solid #eceae2; pointer-events: none; }
    #hangar .cn.a { left: -6px; top: -6px; border-right: 0; border-bottom: 0; border-top-left-radius: 14px; } #hangar .cn.b { right: -6px; top: -6px; border-left: 0; border-bottom: 0; border-top-right-radius: 14px; }
    #hangar .cn.c { left: -6px; bottom: -6px; border-right: 0; border-top: 0; border-bottom-left-radius: 14px; } #hangar .cn.d { right: -6px; bottom: -6px; border-left: 0; border-top: 0; border-bottom-right-radius: 14px; }
    #hangar .tabs { min-width: 0; display: flex; gap: 14px; align-items: center; border-bottom: 1px solid #2a2f3b; padding-bottom: 0; margin-bottom: 14px; } #hangar .tabs .tl { flex: 1 1 auto; min-width: 0; display: flex; gap: 14px; align-items: flex-end; align-self: stretch; overflow-x: auto; scrollbar-width: none; } #hangar .tabs .tl::-webkit-scrollbar { display: none; }
    #hangar .tabs button { flex: none; background: none; border: 0; color: #8c8f99; font: 600 11px/1 inherit; letter-spacing: .07em; text-transform: uppercase; padding: 8px 0 10px; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    #hangar .tabs button.on { color: #f1eee6; border-bottom-color: #d4553b; } #hangar .tabs button i { font-style: normal; color: ${GOLD}; margin-left: 6px; letter-spacing: 0; }
    #hangar .tabs input { margin: 0 0 4px; width: clamp(84px, 9vw, 130px); flex: 0 0 auto; height: 28px; padding: 5px 8px; background: #05060a; border: 1px solid #2a2f3b; border-radius: 3px; color: inherit; font-size: 12px; }
    #hangar .who { grid-column: 2; grid-row: 1; align-self: end; margin-bottom: 14px; min-width: 0; padding-right: 34px; }
    #hangar .who .nm { display: flex; justify-content: flex-end; align-items: center; gap: 10px; } #hangar .who .nm b { font-weight: 400; font-size: 21px; background: #1a1d26; padding: 3px 10px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #hangar .who .xp { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 10.5px; color: ${GOLD}; letter-spacing: .06em; font-variant-numeric: tabular-nums; } #hangar .who .xp div { flex: 1; height: 5px; background: #2a2d36; border-radius: 3px; overflow: hidden; } #hangar .who .xp div i { display: block; height: 100%; background: linear-gradient(90deg, #c99b2e, #f2c94c); }
    #hangar .grid { grid-column: 1; grid-row: 3; min-height: 0; min-width: 0; grid-auto-flow: row dense; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); grid-auto-rows: 112px; gap: 6px; padding: 2px 6px 2px 2px; align-content: start; }
    #hangar .t { position: relative; border: 1px solid #2b303c; background: radial-gradient(80% 80% at 50% 45%, #141824, #0a0c12); display: grid; place-items: center; color: ${GOLD}; cursor: grab; user-select: none; transition: border-color .12s; }
    #hangar .t:hover { border-color: #5b5440; } #hangar .t.sel { border: 2px solid #d9d3bd; box-shadow: inset 0 0 0 3px #0a0c12, inset 0 0 0 4px #7d7350; }
    #hangar .t .nm { position: absolute; left: 6px; right: 6px; bottom: 5px; font-size: 10.5px; color: #b7b2a4; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #hangar .px { image-rendering: pixelated; margin-top: -12px; filter: drop-shadow(0 3px 0 rgba(0,0,0,.45)); } #hangar .t.big { grid-column: span 2; grid-row: span 2; } #hangar .t.big .px { margin-top: -16px; } #hangar .t.off .px { filter: grayscale(.85) brightness(.7); }
    #hangar .t { background: radial-gradient(70% 70% at 50% 42%, #1a1f2c, #0b0d13); box-shadow: inset 0 0 0 1px #0a0b10, inset 0 2px 0 rgba(255,255,255,.03); }
    #hangar .hcard .pic .px { margin: 0; }
    #hangar .hx { position: absolute; right: 12px; top: 12px; z-index: 2; width: 30px; height: 30px; display: grid; place-items: center; background: #14171f; border: 1px solid #3a3e4a; color: #e9e6dc; padding: 0; cursor: pointer; border-radius: 4px; } #hangar .hx svg { display: block; } #hangar .hx:hover { background: #c4473a; border-color: #c4473a; } #hangar .hx:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; } #hangar .t.off { color: #6d6a62; }
    #hangar .t .e { position: absolute; left: 4px; top: 4px; width: 18px; height: 18px; display: grid; place-items: center; background: #e9e6dc; color: #0a0c12; font: 700 11px/1 inherit; }
    #hangar .t .dot { position: absolute; right: 6px; top: 6px; width: 6px; height: 6px; border-radius: 50%; }
    #hangar .t.empty { cursor: default; background: linear-gradient(to top right, transparent calc(50% - .5px), #262a35 50%, transparent calc(50% + .5px)), #08090d; }
    #hangar .char { grid-column: 2; grid-row: 2 / 4; min-height: 0; min-width: 0; border: 1px solid #262a35; position: relative; overflow: hidden; background-image: radial-gradient(rgba(255,255,255,.18) 1px, transparent 1.2px); background-size: 22px 22px; display: grid; place-items: center; }
    #hangar .char .orbc { width: 180px; height: 180px; } #hangar .char .orb { width: 150px; height: 150px; border-radius: 50%; position: relative; }
    #hangar .char .lab { position: absolute; left: 12px; right: 12px; bottom: 10px; font-size: 11px; color: #a9a597; text-align: center; } #hangar .char .lab b { display: block; color: #e9e6dc; font-weight: 500; font-size: 12.5px; margin-bottom: 2px; }
    #hangar .char { touch-action: pan-y; cursor: grab; } #hangar .char .orbc { transition: transform .22s ease-out, opacity .22s; }
    #hangar .char .nav { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 26px; height: 40px; border: 1px solid #2f3442; border-radius: 6px; background: rgba(12,14,22,.6); color: #cfc9b8; font-size: 20px; line-height: 1; cursor: pointer; padding: 0; } #hangar .char .nav.l { left: 8px; } #hangar .char .nav.r { right: 8px; } #hangar .char .nav:hover { border-color: #d9b86c; color: #fff; }
    #hangar .char .dots { position: absolute; top: 28px; left: 0; right: 0; display: flex; justify-content: center; gap: 4px; pointer-events: none; } #hangar .char .dots i { width: 5px; height: 5px; border-radius: 50%; background: #3a3e4a; } #hangar .char .dots i.on { background: #d9b86c; }
    #hangar .char .hint { position: absolute; top: 10px; left: 0; right: 0; text-align: center; font-size: 10.5px; color: #77746b; letter-spacing: .06em; text-transform: uppercase; }
    #hangar .bot { grid-column: 1 / -1; grid-row: 4; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) var(--rc); gap: var(--cg); margin-top: 12px; }
    #hangar .hcard { min-width: 0; background: rgba(18,20,28,.55); border: 1px solid #2a2e3a; border-radius: 12px; padding: 12px 18px 14px; display: grid; grid-template-columns: 110px minmax(0, 1fr); grid-template-rows: 26px 86px 18px 28px; gap: 9px 18px; height: 222px; overflow: hidden; }
    #hangar .hcard h3 { grid-column: 1 / -1; margin: 0; padding: 0; height: 26px; line-height: 26px; min-width: 0; overflow: hidden; white-space: nowrap; display: flex; align-items: center; gap: 10px; font: 500 15px/1.2 inherit; letter-spacing: .1em; text-transform: uppercase; } #hangar .hcard h3 .k, #hangar .hcard h3 .v { line-height: 1.25; display: inline-block; } #hangar .hcard h3 .n { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; } #hangar .hcard h3 .k { flex: none; font-size: 10px; letter-spacing: .08em; color: #9a968a; border: 1px solid #3a3e4a; padding: 2px 5px; } #hangar .hcard h3 .v { margin-left: auto; flex: none; white-space: nowrap; color: ${GOLD}; font-size: 12px; letter-spacing: 0; background: #1a1d26; padding: 2px 8px; }
    #hangar .hcard .pic { border: 1px solid #2b303c; display: grid; place-items: center; color: ${GOLD}; height: 86px; }
    #hangar .hcard .bars { display: grid; grid-template-columns: 74px 1fr; gap: 7px 10px; align-content: start; font-size: 10.5px; letter-spacing: .1em; color: #c9c5b8; text-transform: uppercase; } #hangar .hcard .bars div { height: 5px; margin-top: 3px; background: #262a33; } #hangar .hcard .bars div i { display: block; height: 100%; background: #cfc3a4; } #hangar .hcard .bars div i.r { background: #c4473a; } #hangar .hcard .bars div i.g { background: #8fb36a; }
    #hangar .hcard .q { grid-column: 1 / -1; line-height: 18px; text-align: left; color: #b8b4a8; font-size: 12px; font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #hangar .stats { border-top: 1px solid ${GOLD}55; padding-top: 10px; } #hangar .stats h4 { margin: 0 0 10px; font: 500 12px/1 inherit; letter-spacing: .12em; text-transform: uppercase; }
    #hangar .stats .cols { display: flex; justify-content: space-between; gap: 10px; height: 92px; } #hangar .stats .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; } #hangar .stats .col div { flex: 1; width: 22px; background: #2a2e38; position: relative; } #hangar .stats .col div i { position: absolute; left: 0; right: 0; bottom: 0; background: #8a8d94; } #hangar .stats .col div i.hi { background: #a9c46a; } #hangar .stats .col span { font-size: 9.5px; color: #9a968a; letter-spacing: .06em; }
    #hangar .foot { grid-column: 1 / -1; grid-row: 5; align-items: center; margin-top: 12px; display: flex; gap: 22px; font-size: 10.5px; letter-spacing: .1em; color: #a19d91; text-transform: uppercase; } #hangar .foot b { color: #e9e6dc; font-weight: 500; margin-right: 6px; }
    #hangar .hcard .acts { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; min-width: 0; overflow: hidden; } #hangar .hcard .acts button { flex: none; height: 28px; box-sizing: border-box; display: inline-flex; align-items: center; margin: 0; font: 600 11px/1 inherit; letter-spacing: .06em; text-transform: uppercase; padding: 7px 10px; border-radius: 3px; border: 1px solid #3a3e4a; background: #14171f; color: #e9e6dc; cursor: pointer; white-space: nowrap; }
    #hangar .hcard .acts button[data-act=implant] { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; } #hangar .hcard .acts button.pri { background: ${GOLD}; border-color: ${GOLD}; color: #14110a; } #hangar .hcard .acts button.del:hover { background: #c4473a; border-color: #c4473a; } #hangar .hcard .acts button:disabled { opacity: .45; cursor: default; } #hangar .hcard .acts span { color: #9a968a; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    #hangar .hbar { grid-column: 1; grid-row: 2; display: flex; gap: 8px; align-items: flex-start; margin: -4px 0 10px; min-width: 0; min-height: 27px; } #hangar .hbar:has(.row + .row) { min-height: 60px; }   /* (the chip strips scroll sideways, so the row is sized for them here) */ #hangar .hbar input { flex: 0 0 150px; height: 27px; padding: 5px 9px; background: #05060a; border: 1px solid #2a2f3b; border-radius: 13px; color: inherit; font-size: 12px; } #hangar .hbar input:focus-visible { outline: 1px solid #d9b86c; }
    #hangar .sub { flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; min-width: 0; } #hangar .sub:empty { display: none; } #hangar .sub .row { flex: none; height: 27px; align-items: center; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; mask-image: linear-gradient(90deg, #000 92%, transparent); } #hangar .sub .row::-webkit-scrollbar { display: none; }
    #hangar .sub button { font: 500 11px/1 inherit; padding: 6px 10px; border-radius: 12px; border: 1px solid #2f3442; background: #0d0f15; color: #b7b2a4; cursor: pointer; white-space: nowrap; } #hangar .sub button.on { background: #e9e6dc; color: #0a0c12; border-color: #e9e6dc; } #hangar .sub button i { font-style: normal; opacity: .6; margin-left: 5px; } #hangar .sub .sep { width: 1px; background: #2f3442; margin: 2px 4px; }
    #hangar .t .st, #hangar .t .ok, #hangar .t .e, #hangar .t .dot { z-index: 1; } #hangar .t .st { position: absolute; right: 5px; top: 5px; font-size: 10px; color: ${GOLD}; background: #0a0c12cc; padding: 1px 5px; border-radius: 2px; } #hangar .t .ok { position: absolute; left: 5px; top: 5px; font-size: 10px; color: #0a0c12; background: #8fb36a; padding: 1px 5px; border-radius: 2px; }
    #hangar .t.disc { cursor: pointer; } #hangar .msg { grid-column: 1 / -1; color: #8c8f99; padding: 10px; }
    #hangar .undo { margin-left: auto; text-transform: none; letter-spacing: 0; font-size: 12px; color: #e9e6dc; display: flex; gap: 10px; align-items: center; } #hangar .undo button { font: 600 11px/1 inherit; padding: 5px 10px; border-radius: 3px; border: 1px solid ${GOLD}; background: none; color: ${GOLD}; cursor: pointer; }
    /* responsive: laid out by the inventory's own size (container queries on .hg) */
    @container hg (min-width: 1180px) { #hangar .grid { grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); grid-auto-rows: 136px; } #hangar .t .px { width: 96px; height: 96px; } #hangar .t.big .px { width: 168px; height: 168px; } #hangar .char .orbc { width: 220px; height: 220px; } }
    @container hg (max-width: 860px) { #hangar .hgi { --rc: 220px; } #hangar .tabs .tl { gap: 10px; } #hangar .tabs button { font-size: 10px; letter-spacing: .03em; } #hangar .char .orbc { width: 140px; height: 140px; } #hangar .stats .col div { width: 16px; } #hangar .stats .col span { font-size: 8.5px; } #hangar .hbar input { flex-basis: 120px; } #hangar .grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); grid-auto-rows: 100px; } #hangar .t .px { width: 64px; height: 64px; } #hangar .t.big .px { width: 120px; height: 120px; } }
    @container hg (max-width: 700px) {                                          /* one column: the target becomes a header strip */
      #hangar .hgi { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto minmax(0, 1fr) auto auto; }
      #hangar .tabs { grid-row: 1; } #hangar .who { grid-column: 1; grid-row: 2; margin-bottom: 10px; padding-right: 0; display: flex; align-items: center; gap: 12px; } #hangar .who .nm { justify-content: flex-start; min-width: 0; flex: 0 1 auto; } #hangar .who .nm b { font-size: 15px; } #hangar .who .xp { margin-top: 0; flex: 1 1 auto; min-width: 0; }
      #hangar .hbar { grid-row: 3; } #hangar .grid { grid-row: 4; } #hangar .char, #hangar .stats { display: none; }
      #hangar .bot { grid-row: 5; grid-template-columns: minmax(0, 1fr); } #hangar .foot { grid-row: 6; }
      #hangar .tabs { padding-right: 36px; }
    }
    @container hg (max-width: 560px) { #hangar .tabs .tl { gap: 8px; } #hangar .tabs button { font-size: 9.5px; letter-spacing: 0; } #hangar .tabs button i { margin-left: 3px; } #hangar .hbar input { flex-basis: 96px; } }
    @container hg (max-height: 600px) { #hangar .hcard { grid-template-columns: 76px minmax(0, 1fr); grid-template-rows: 26px 56px 18px 28px; height: 186px; gap: 7px 14px; padding: 10px 14px 12px; } #hangar .hcard .pic { height: 56px; } #hangar .hcard .pic .px { width: 44px; height: 44px; } #hangar .hcard .bars { gap: 4px 10px; } #hangar .stats .cols { height: 70px; } #hangar .foot { display: none; } }
    @container hg (max-height: 430px) { #hangar .hcard { grid-template-rows: 26px 28px !important; height: 82px !important; gap: 6px 14px; padding: 8px 12px 10px; } #hangar .hcard .q { display: none; } #hangar .tabs { margin-bottom: 8px; } #hangar .tabs button { padding: 6px 0 8px; } #hangar .hbar { margin-bottom: 6px; } }
    @container hg (max-height: 430px) and (max-width: 700px) { #hangar .who { display: none; } }
    @container hg (max-height: 480px) { #hangar .hcard { grid-template-columns: minmax(0, 1fr); grid-template-rows: 26px 18px 28px; height: 116px; padding: 10px 14px 12px; } #hangar .hcard .pic, #hangar .hcard .bars { display: none; } #hangar .stats { display: none; } #hangar .bot { grid-template-columns: minmax(0, 1fr); } #hangar .char .orbc { width: 110px; height: 110px; } #hangar .char .hint { display: none; } }
    .srow.capT { outline: 1px solid ${GOLD}; outline-offset: -1px; }
    body.simple #hangar .t { transition: none; }`;
  document.head.appendChild(st);

  const TABS = [['skill', 'Skills'], ['command', 'Commands'], ['plugin', 'Plugins'], ['connector', 'Connectors'], ['discover', 'Discover']];
  const SUBS = [['anthropicSkills', 'Anthropic skills'], ['anthropicPlugins', 'Anthropic plugins'], ['githubSkills', 'GitHub skills ★'], ['githubMcp', 'GitHub MCP servers ★'], ['registry', 'MCP Registry']];
  const kStars = n => n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n || 0);
  const installedNames = () => new Set(!data ? [] : [...data.skills.map(x => x.name.replace(/^[^:]+:/, '')), ...data.skills.filter(x => x.plugin).map(x => x.plugin.split('@')[0]), ...data.connectors.map(x => x.name.toLowerCase())]);
  const discList = () => {
    if (!disc) return [];
    let L = (disc[sub] || []);
    if (sub === 'anthropicPlugins' && cat !== 'all') L = L.filter(x => x.category === cat);
    return L.map(x => ({ ...x, kind: 'disc', key: (x.repo || '') + '|' + (x.id || '') + '|' + x.name }));
  };
  function loadDisc(q) {
    discLoading = true; discQ = q; render();
    window.api.hangarOps.discover(q).then(d => { if (discQ !== q) return; disc = d || {}; discLoading = false; render(); }).catch(() => { disc = { failed: [sub] }; discLoading = false; render(); });
  }
  const items = () => tab === 'discover' ? discList() : !data ? [] : tab === 'connector' ? data.connectors.map(c => ({ ...c, kind: 'connector' })) : data.skills.filter(s => s.src === tab).map(s => ({ ...s, kind: 'skill' }));
  const fmtAge = ms => { const d = (Date.now() - ms) / 864e5; return !ms ? '—' : d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 60 ? Math.round(d) + ' days ago' : Math.round(d / 30) + ' months ago'; };
  // the target can be changed right here: swipe (trackpad two-finger, or drag) left / right, the ‹ › buttons, or ← →
  const liveTargets = () => snap.sessions.filter(s => !s.offline && s.kind !== 'bg');
  function shiftTarget(dir) {
    const L = liveTargets(); if (!L.length) return; const cur = tgtSession(), i = Math.max(0, L.findIndex(s => s === cur));
    target = L[(i + dir + L.length) % L.length].sid; render();
    const cv = el.querySelector('.char .orbc'); if (cv && !isSimple()) { cv.style.transition = 'none'; cv.style.transform = `translateX(${dir * 60}px)`; cv.style.opacity = '0'; requestAnimationFrame(() => { cv.style.transition = ''; cv.style.transform = ''; cv.style.opacity = ''; }); }
  }
  // (a trackpad swipe moves one session: the gesture ends when its wheel events pause)
  let swipeAcc = 0, swipeT = 0, swipeLock = false;
  function targetSwipeInit() {
    const W = el.querySelector('.char');
    W.addEventListener('wheel', e => { if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); const now = performance.now(), gap = now - swipeT; swipeT = now; if (gap > 250) { swipeAcc = 0; swipeLock = false; } if (swipeLock) return; swipeAcc += e.deltaX; if (Math.abs(swipeAcc) > 60) { shiftTarget(swipeAcc > 0 ? 1 : -1); swipeLock = true; } }, { passive: false });
    let px = null; W.addEventListener('pointerdown', e => { if (e.target.closest('.nav')) return; px = e.clientX; }); addEventListener('pointerup', e => { if (px == null) return; const dx = e.clientX - px; px = null; if (Math.abs(dx) > 40) shiftTarget(dx < 0 ? 1 : -1); });
    W.addEventListener('click', e => { const b = e.target.closest('.nav'); if (b) shiftTarget(+b.dataset.nav); });
    addEventListener('keydown', e => { if (!el || el.style.display === 'none' || (document.activeElement && document.activeElement.tagName === 'INPUT') || !document.getElementById('modal').classList.contains('hidden')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); shiftTarget(e.key === 'ArrowRight' ? 1 : -1); } });
  }
  const tgtSession = () => snap.sessions.find(s => s.sid === (target || selected)) || null;

  function render(full = true) {
    if (!el) return;
    const q = (el.querySelector('.hbar input').value || '').toLowerCase();
    el.querySelectorAll('.tabs button').forEach(b => { const k = b.dataset.t, n = k === 'discover' ? '' : !data ? '' : k === 'connector' ? data.connectors.length : data.skills.filter(s => s.src === k).length; b.classList.toggle('on', k === tab); b.innerHTML = `${TABS.find(x => x[0] === k)[1]}<i>${n}</i>`; });
    const S = tgtSession(), eq = (S && equipped.get(S.sid)) || new Set();
    const D = tab === 'discover', idOf = c => D ? c.key : c.name;
    const list = D ? items() : items().filter(c => !q || c.name.toLowerCase().includes(q) || (c.desc || c.status || '').toLowerCase().includes(q));
    if (full) pickIcons(list);
    if (!pick || !list.find(c => idOf(c) === pick)) pick = list[0] ? idOf(list[0]) : null;
    // the Discover sources (and, for Anthropic's plugins, their categories) as chips under the tabs
    const SB = el.querySelector('.sub'), sx = [...SB.querySelectorAll('.row')].map(r => r.scrollLeft);
    if (!D) SB.innerHTML = '';
    else {
      const cats = disc && disc.anthropicPlugins ? [...disc.anthropicPlugins.reduce((m, x) => m.set(x.category, (m.get(x.category) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]) : [];
      SB.innerHTML = '<div class="row">' + SUBS.map(([k, l]) => `<button data-sub="${k}" class="${k === sub ? 'on' : ''}">${l}<i>${disc && disc[k] ? disc[k].length : ''}</i></button>`).join('') + '</div>'
        + (sub === 'anthropicPlugins' && cats.length ? '<div class="row">' + [['all', disc.anthropicPlugins.length], ...cats].map(([c, n]) => `<button data-cat="${esc(c)}" class="${c === cat ? 'on' : ''}">${esc(c)}<i>${n}</i></button>`).join('') + '</div>' : '');
    }
    SB.querySelectorAll('.row').forEach((r, i) => { r.scrollLeft = sx[i] || 0; });
    const have = installedNames(), isHave = c => have.has(c.name) || have.has(String(c.name).toLowerCase()) || (c.src === 'mcp-registry' && have.has(String(c.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-')));
    const G = el.querySelector('.grid');
    if (!full) G.querySelectorAll('.t[data-n]').forEach(t => t.classList.toggle('sel', t.dataset.n === pick));
    else if (D) G.innerHTML = discLoading && !disc ? '<div class="msg">Searching Anthropic, GitHub and the MCP Registry…</div>' : !list.length ? `<div class="msg">${discLoading ? 'Searching…' : disc && (disc.failed || []).includes(sub) ? 'Couldn\'t reach this source. Open the tab again to retry.' : 'Nothing found here' + (discQ ? ' for “' + esc(discQ) + '”' : '') + '.'}</div>`
      : list.map(c => `<div class="t disc${c.key === pick ? ' sel' : ''}" data-n="${esc(c.key)}" title="${esc(c.repo || c.id || c.name)} · double-click to install">${isHave(c) ? '<span class="ok">✓ installed</span>' : ''}${c.stars != null ? `<span class="st">★ ${kStars(c.stars)}</span>` : c.category && cat === 'all' ? `<span class="st">${esc(c.category)}</span>` : ''}${pxImg(c, 80)}<span class="nm">${esc(c.name)}</span></div>`).join('')
        + Array.from({ length: Math.max(0, 8 - list.length) }, () => '<div class="t empty"></div>').join('');
    else G.innerHTML = !data ? '<div class="msg">Loading the hangar…</div>'
      : list.map(c => `<div class="t${c.name === pick ? ' sel' : ''}${c.kind === 'connector' && !c.ok ? ' off' : ''}${(c.lines || 0) >= 600 ? ' big' : ''}" draggable="true" data-n="${esc(c.name)}" data-k="${c.kind}" title="${esc(c.name)} · drag onto a session, or double-click to implant">${eq.has(c.name) ? '<span class="e">E</span>' : ''}${c.kind === 'connector' ? `<span class="dot" style="background:${c.ok ? '#8fb36a' : '#c4473a'}"></span>` : ''}${pxImg(c, (c.lines || 0) >= 600 ? 144 : 80)}<span class="nm">${esc(c.name.replace(/^[^:]+:/, ''))}</span></div>`).join('')
        + Array.from({ length: Math.max(0, (Math.ceil(Math.max(list.length, 1) / 5) * 5) - list.length + (list.length < 10 ? 5 : 0)) }, () => '<div class="t empty"></div>').join('');
    // the "character": the session the items go into
    const W = el.querySelector('.char'), col = { working: '#4ade80', waiting: '#fbbf24', error: '#f87171', quiet: '#7dd3fc', idle: '#8a93b8' }[S && S.health] || '#8a93b8';
    W.innerHTML = S ? `<div class="hint">Implant target</div><button class="nav l" data-nav="-1" aria-label="Previous session">‹</button><button class="nav r" data-nav="1" aria-label="Next session">›</button><div class="dots"></div><canvas class="orbc" width="360" height="360"></canvas><div class="lab"><b>${esc(S.name)}</b>${esc((S.model || '').replace('claude-', ''))} · ${esc(S.health || '')}${S.hostLabel ? ' · ' + esc(S.hostLabel) : ''}</div>`
      : '<div class="hint">Implant target</div><div class="lab"><b>No session selected</b>Select a session, or drag an item onto a bubble</div>';
    { const D = W.querySelector('.dots'), L = liveTargets(), k = L.findIndex(x => x === S); if (D) D.innerHTML = L.length > 1 ? L.slice(0, 14).map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('') : ''; W.querySelectorAll('.nav').forEach(b => b.style.display = L.length > 1 ? '' : 'none'); }
    const nm = el.querySelector('.who .nm b'); nm.textContent = S ? S.name : '—';
    const ctx = S && S.ctxMax ? Math.min(1, (S.ctx || 0) / S.ctxMax) : 0;
    el.querySelector('.who .xp').innerHTML = `<span>${S ? fmtTok(S.ctx || 0) + ' / ' + fmtTok(S.ctxMax || 0) + ' CONTEXT' : ''}</span><div><i style="width:${(ctx * 100).toFixed(1)}%"></i></div>`;
    // session stats (real numbers, scaled against the busiest live session)
    const live = snap.sessions.filter(s => !s.offline), mx = f => Math.max(1, ...live.map(s => +s[f] || 0));
    const bars = S ? [['Tokens', (S.todayTok || 0) / mx('todayTok')], ['Speed', (S.tps || 0) / mx('tps')], ['Context', ctx], ['Cost', (S.todayUsd || 0) / mx('todayUsd')], ['Items', Math.min(1, eq.size / 5)]] : [];
    el.querySelector('.stats .cols').innerHTML = bars.map(([k, v], i) => `<div class="col"><div><i class="${i === 0 ? 'hi' : ''}" style="height:${Math.round(Math.max(.03, v) * 100)}%"></i></div><span>${k}</span></div>`).join('');
    // the chosen item's card, with its actions
    const c = list.find(x => idOf(x) === pick), C = el.querySelector('.hcard');
    if (!c) { C.innerHTML = `<h3><span class="n">${D ? (discLoading ? 'Searching…' : 'Pick a source above') : !data ? 'Loading…' : tab === 'connector' && data.connectorsErr ? 'Couldn\'t list connectors: ' + esc(data.connectorsErr) : 'Nothing here'}</span></h3>`; return; }
    const t = S ? S.name : null, B = busy && busy.key === idOf(c) ? busy : null;
    if (D) {
      const srcL = { 'anthropic-skill': 'Anthropic skill', 'anthropic-plugin': 'Anthropic plugin', 'github-skill': 'GitHub skill', 'github-mcp': 'GitHub MCP', 'mcp-registry': 'MCP Registry' }[c.src];
      const can = c.src !== 'github-mcp' && !(c.src === 'mcp-registry' && !c.remote && !c.pkg), got = isHave(c);
      const rows = [['Stars', c.stars != null ? Math.min(1, Math.log10(1 + c.stars) / 5) : c.src.startsWith('anthropic') ? 1 : .3, ''], ['Fresh', c.updated ? Math.max(.04, 1 - (Date.now() - Date.parse(c.updated)) / (864e5 * 180)) : .7, ''], ['Trust', c.src.startsWith('anthropic') ? 1 : c.src === 'mcp-registry' ? .6 : .4, c.src.startsWith('anthropic') ? 'g' : '']];
      C.innerHTML = `<h3><span class="n">${esc(c.name)}</span><span class="k">${srcL}</span>${c.stars != null || c.category || c.id ? `<span class="v">${c.stars != null ? '★ ' + kStars(c.stars) : esc(c.category || c.id || '')}</span>` : ''}</h3>
        <div class="pic">${pxImg(c, 64)}</div><div class="bars">${rows.map(([k, v, cl]) => `<span>${k}</span><div><i class="${cl}" style="width:${Math.round(Math.max(.04, Math.min(1, v)) * 100)}%"></i></div>`).join('')}</div>
        <div class="q">“${esc((c.desc || 'No description.').replace(/\s+/g, ' ').slice(0, 220))}”</div>
        <div class="acts">${can ? `<button class="pri" data-act="install" ${B || got ? 'disabled' : ''}>${B ? 'Installing…' : got ? 'Installed' : 'Install'}</button>` : ''}<button data-act="details">Details</button>${c.url ? '<button data-act="openurl">Open ↗</button>' : ''}<span>${esc(B && B.msg || c.repo || c.id || (c.author ? 'by ' + c.author : ''))}</span></div>`;
      return;
    }
    const maxL = Math.max(1, ...data.skills.map(s => s.lines || 0)), fresh = c.mtime ? Math.max(.04, 1 - (Date.now() - c.mtime) / (864e5 * 120)) : 0;
    const rows = c.kind === 'connector' ? [['Status', c.ok ? 1 : .15, c.ok ? 'g' : 'r'], ['Reach', /claude\.ai/.test(c.name) ? .9 : .55, '']] : [['Depth', (c.lines || 0) / maxL, ''], ['Fresh', fresh, fresh < .25 ? 'r' : ''], ['Source', c.src === 'skill' ? 1 : c.src === 'plugin' ? .6 : .35, '']];
    const delL = c.kind === 'connector' ? (/^claude\.ai\s/.test(c.name) ? 'Remove on claude.ai ↗' : 'Remove') : c.src === 'plugin' ? 'Uninstall plugin' : 'Remove';
    C.innerHTML = `<h3><span class="n">${esc(c.name)}</span><span class="k">${c.kind === 'connector' ? 'connector' : c.src}</span>${eq.has(c.name) ? '<span class="k" style="color:#e9e6dc">equipped</span>' : ''}${c.kind === 'connector' && !c.status ? '' : `<span class="v">${c.kind === 'connector' ? esc(c.status || '') : (c.lines || 0) + ' lines · ' + fmtAge(c.mtime)}</span>`}</h3>
      <div class="pic">${pxImg(c, 64)}</div><div class="bars">${rows.map(([k, v, cl]) => `<span>${k}</span><div><i class="${cl}" style="width:${Math.round(Math.max(.04, Math.min(1, v)) * 100)}%"></i></div>`).join('')}</div>
      <div class="q">“${esc((c.desc || (c.kind === 'connector' ? 'A connector Claude Code can call from any session.' : 'No description.')).replace(/\s+/g, ' ').slice(0, 220))}”</div>
      <div class="acts"><button class="pri" data-act="implant" ${t ? '' : 'disabled'}>Implant${t ? ' into ' + esc(t.length > 22 ? t.slice(0, 21) + '…' : t) : ''}</button><button data-act="details">Details</button><button class="del" data-act="remove" ${B ? 'disabled' : ''}>${B ? 'Removing…' : delL}</button><span>${esc(B && B.msg || (c.plugin ? 'from ' + c.plugin : ''))}</span></div>`;
  }
  // a yes / no in the app's own dialog (it sits above the hangar)
  const ask = (title, body, ok, danger) => new Promise(res => {
    modal(`<h2>${esc(title)}</h2><div style="color:var(--dim);margin:6px 0 14px;line-height:1.5">${body}</div><div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="hOk" ${danger ? 'style="background:#c4473a;border-color:#c4473a;color:#fff"' : ''}>${esc(ok)}</button></div>`);
    $('#mCancel').onclick = () => { closeModal(); res(false); }; $('#hOk').onclick = () => { closeModal(); res(true); };
  });
  const reload = () => { data = null; loading = window.api.hangar().then(d => { data = d || { skills: [], connectors: [] }; loading = null; render(); }).catch(() => { loading = null; }); };
  function showUndo(text, u) {
    const F = el.querySelector('.foot'); let U = F.querySelector('.undo'); if (U) U.remove();
    U = document.createElement('span'); U.className = 'undo'; U.innerHTML = `${esc(text)}${u ? '<button>Undo</button>' : ''}`; F.appendChild(U);
    if (u) U.querySelector('button').onclick = async () => { const r = await window.api.hangarOps.undo(u); U.remove(); toast(r && r.ok ? 'Restored' : 'Could not restore it'); reload(); };
    clearTimeout(undoBar); undoBar = setTimeout(() => U.remove(), 15000);
  }
  async function act(kind) {
    const D = tab === 'discover', c = items().find(x => (D ? x.key : x.name) === pick); if (!c) return;
    const key = D ? c.key : c.name;
    if (kind === 'openurl') return window.api.hangarOps.open(c.url);
    if (kind === 'details') {                                                    // the whole description and the facts, in the app's dialog
      const rows = D ? [['Source', { 'anthropic-skill': 'Anthropic skill', 'anthropic-plugin': 'Anthropic plugin', 'github-skill': 'GitHub skill', 'github-mcp': 'GitHub MCP server', 'mcp-registry': 'MCP Registry' }[c.src]], ['Repository', c.repo], ['Registry ID', c.id], ['Category', c.category], ['Author', c.author], ['Stars', c.stars != null ? c.stars.toLocaleString() : null], ['Updated', c.updated ? new Date(c.updated).toLocaleDateString() : null], ['Runs as', c.remote ? 'hosted · ' + c.remote : c.pkg ? c.pkg.type + ' · ' + c.pkg.id : null]]
        : [['Type', c.kind === 'connector' ? 'Connector' : c.src], ['Status', c.status], ['Plugin', c.plugin], ['File', c.file ? c.file.replace(/^\/Users\/[^/]+/, '~') : null], ['Size', c.lines ? c.lines + ' lines' : null], ['Updated', c.mtime ? new Date(c.mtime).toLocaleString() : null], ['Command', c.kind === 'connector' ? null : '/' + c.name]];
      modal(`<h2 style="margin-bottom:4px">${esc(c.name)}</h2><div style="white-space:pre-wrap;line-height:1.55;max-height:46vh;overflow:auto;margin:8px 0 14px;color:var(--fg,#e8eaf0)">${esc(c.desc || 'No description.')}</div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 14px;font-size:12px;margin-bottom:14px">${rows.filter(r => r[1]).map(([k, v]) => `<span style="color:var(--dim)">${k}</span><span style="overflow-wrap:anywhere">${esc(v)}</span>`).join('')}</div>
        <div class="btns" style="justify-content:flex-end">${c.url ? '<button id="hdOpen">Open ↗</button>' : ''}<button class="primary" id="mCancel">Close</button></div>`);
      $('#modalCard').classList.add('wide'); if ($('#hdOpen')) $('#hdOpen').onclick = () => window.api.hangarOps.open(c.url);
      return;
    }
    if (kind === 'implant') { const S = tgtSession(); if (!S) return; close(); return implant(S.sid, { kind: c.kind, name: c.name }); }
    if (kind === 'remove') {
      const cai = c.kind === 'connector' && /^claude\.ai\s/.test(c.name);
      if (!cai && !(await ask(c.src === 'plugin' ? 'Uninstall this plugin?' : `Remove ${c.name}?`,
        c.kind === 'connector' ? `Removes the MCP server <b>${esc(c.name)}</b> from Claude Code on this Mac (<code>claude mcp remove</code>).`
          : c.src === 'plugin' ? `<b>${esc(c.plugin)}</b> is uninstalled with <code>claude plugin uninstall</code> — every skill it brings goes with it.`
            : `The ${c.src} moves to a trash folder (<code>~/.claude/.hangar-trash</code>); you can undo it right after. Skills in ClaudeConfig sync, so it also leaves the other Mac.`, c.src === 'plugin' ? 'Uninstall' : 'Remove', true))) return;
      busy = { key }; render(false); render();
      const r = await window.api.hangarOps.remove({ kind: c.kind, name: c.name, src: c.src, file: c.file, plugin: c.plugin }); busy = null;
      if (r && r.ok) { showUndo(`Removed ${c.name}`, r.undo); pick = null; reload(); } else { render(); toast(r && r.err ? r.err : 'Could not remove it'); }
      return;
    }
    if (kind === 'install') {
      const what = { 'anthropic-skill': `Copies Anthropic's <b>${esc(c.name)}</b> skill into <code>~/.claude/skills</code>.`, 'github-skill': `Copies the SKILL.md folders from <b>${esc(c.repo)}</b> (★ ${kStars(c.stars)}) into <code>~/.claude/skills</code>. Files only — nothing is run — but read third-party skills before you use them.`,
        'anthropic-plugin': `Installs <b>${esc(c.name)}</b> from Anthropic's plugin directory (<code>claude plugin install</code>).`,
        'mcp-registry': c.remote ? `Adds the hosted MCP server <b>${esc(c.name)}</b> (${esc(c.remote)}) to Claude Code.` : `Adds <b>${esc(c.name)}</b>, run locally with ${c.pkg && c.pkg.type === 'npm' ? 'npx' : 'uvx'} (<code>${esc(c.pkg && c.pkg.id || '')}</code>) — third-party code that runs on this Mac when a session uses it.` }[c.src];
      if (!(await ask(`Install ${c.name}?`, what, 'Install'))) return;
      busy = { key, msg: 'Installing…' }; render();
      const r = await window.api.hangarOps.install(c); busy = null;
      if (r && r.ok) { showUndo('Installed ' + (r.installed || [c.name]).join(', ')); reload(); } else { render(); toast(r && r.err ? r.err : 'Install failed'); }
    }
  }
  function open() {
    if (!el) {
      el = document.createElement('div'); el.id = 'hangar';
      el.innerHTML = `<div class="hg"><button class="hx" title="Close (Esc)" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button><i class="cn a"></i><i class="cn b"></i><i class="cn c"></i><i class="cn d"></i><div class="hgi">
        <div class="tabs"><div class="tl">${TABS.map(([k]) => `<button data-t="${k}"></button>`).join('')}</div></div>
        <div class="hbar"><input placeholder="Search" aria-label="Search the hangar"><div class="sub"></div></div><div class="who"><div class="nm"><b></b></div><div class="xp"></div></div>
        <div class="grid"></div><div class="char"></div>
        <div class="bot"><div class="hcard"></div><div class="stats"><h4>Session stats</h4><div class="cols"></div></div></div>
        <div class="foot"><span><b>Drag</b>onto a session</span><span><b>Double-click</b>implant into the target</span><span><b>Pinch</b>resize</span><span><b>Esc</b>close</span></div></div><i class="grip" title="Drag to resize · double-click to reset"></i><span class="szt"></span></div>`;
      document.body.appendChild(el); sizingInit(); targetSwipeInit();
      el.addEventListener('click', e => {
        if (e.target === el || e.target.closest('.hx')) return close();
        const b = e.target.closest('.tabs button'); if (b) { tab = b.dataset.t; pick = null; if (tab === 'discover' && !disc && !discLoading) loadDisc(el.querySelector('.hbar input').value.trim()); return render(); }
        const sb = e.target.closest('.sub button[data-sub]'); if (sb) { sub = sb.dataset.sub; cat = 'all'; pick = null; return render(); }
        const cb = e.target.closest('.sub button[data-cat]'); if (cb) { cat = cb.dataset.cat; pick = null; return render(); }
        const ab = e.target.closest('.hcard .acts button[data-act]'); if (ab && !ab.disabled) return act(ab.dataset.act);
        const t = e.target.closest('.t[data-n]'); if (t) { pick = t.dataset.n; render(false); }
      });
      el.addEventListener('dblclick', e => { const t = e.target.closest('.t[data-n]'), S = tgtSession(); if (!t) return; if (tab === 'discover') { pick = t.dataset.n; return act('install'); } if (!S) return toast('Select a session first, or drag the item onto a bubble'); close(); implant(S.sid, { kind: t.dataset.k, name: t.dataset.n }); });
      el.querySelector('.hbar input').oninput = () => { if (tab !== 'discover') return render(); clearTimeout(discT); discT = setTimeout(() => loadDisc(el.querySelector('.hbar input').value.trim()), 500); };
      el.addEventListener('dragstart', e => { const t = e.target.closest('.t[data-n]'); if (!t || tab === 'discover') return; pick = t.dataset.n; const c = { kind: t.dataset.k, name: t.dataset.n }; e.dataTransfer.setData(MIME, JSON.stringify(c)); e.dataTransfer.setData('text/plain', textFor(c)); e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setDragImage(t, 56, 56); setTimeout(() => { el.style.opacity = '.12'; el.style.pointerEvents = 'none'; }, 0); });   // the screen fades so you can see the mesh
      el.addEventListener('dragend', () => { el.style.opacity = ''; el.style.pointerEvents = ''; viz.capHover = null; document.querySelectorAll('.capT').forEach(r => r.classList.remove('capT')); });
      // (capture: runs before the app's own Escape, so a dialog open on top closes alone and the hangar stays)
      addEventListener('keydown', e => { if (e.key !== 'Escape' || !el || el.style.display === 'none') return; if (!document.getElementById('modal').classList.contains('hidden')) { e.stopImmediatePropagation(); return closeModal(); } close(); }, true);
    }
    target = selected; el.style.display = 'grid'; if (size) applySize(size.w, size.h); requestAnimationFrame(portrait);
    if (window.anime && !isSimple()) { const hg = el.querySelector('.hg'); anime.remove(hg); anime.animate(hg, { opacity: [0, 1], scale: [.97, 1], ease: anime.createSpring({ stiffness: 300, damping: 26 }) });
      setTimeout(() => anime.animate(el.querySelectorAll('.grid .t'), { opacity: [0, 1], translateY: [8, 0], delay: anime.stagger(14), duration: 380, ease: 'outQuad' }), 20); }
    render();
    if (!data && !loading) loading = window.api.hangar().then(d => { data = d || { skills: [], connectors: [] }; loading = null; render(); setTimeout(() => { data = null; }, 600000); }).catch(e => { loading = null; data = { skills: [], connectors: [], connectorsErr: e.message || 'failed' }; render(); setTimeout(() => { data = null; }, 5000); });
  }
  // the target's portrait: its real bubble, drawn by the mesh's own drawMote (organism.js) into the panel's canvas — the
  // same palette, glow, sparks and rings, at full brightness and without its name tag; ~30×/s while the hangar is open
  let portraitT = 0;
  function portrait(ts) {
    if (!el || el.style.display === 'none') return;
    requestAnimationFrame(portrait);
    if (ts - portraitT < 32) return; portraitT = ts;
    const cv = el.querySelector('.char .orbc'), S = tgtSession(); if (!cv || !S) return;
    const n = viz.nodes.get(S.sid) || (viz.portalNodes ? viz.portalNodes().find(p => p.sid === S.sid) : null), x = cv.getContext('2d'); if (!n) return;
    const pn = Object.assign(Object.create(Object.getPrototypeOf(n)), n, { x: 0, y: 0, z: 1, rec: 1, focus: 0, dying: 0, born: viz.time - 99, gscale: 1, gslot: null, eaten: null, bhScale: 1, bhStretch: null, swell: 0 });
    const R = viz.nodeRadius(pn), k = Math.min(cv.width * .2 / Math.max(8, R), 6), keep = { ctx: viz.ctx, clean: viz.cineClean };
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); x.setTransform(k, 0, 0, k, cv.width / 2, cv.height / 2);
    viz.ctx = x; viz.cineClean = true;
    try { viz.drawMote(pn, 0); } catch { } finally { viz.ctx = keep.ctx; viz.cineClean = keep.clean; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; }
  }
  // ---- the inventory's size: pinch on it (the trackpad pinch arrives as ctrl+wheel), or drag the corner grip; kept on
  // screen, remembered (localStorage), double-click the grip for the default size
  const SIZE_KEY = 'mesh.hangarSize', MINW = 520, MINH = 380;
  let size = null; try { size = JSON.parse(localStorage.getItem(SIZE_KEY)); } catch { }
  const fitSize = (w, h) => [Math.round(Math.max(Math.min(MINW, innerWidth - 16), Math.min(innerWidth - 16, w))), Math.round(Math.max(Math.min(MINH, innerHeight - 16), Math.min(innerHeight - 16, h)))];
  let szT = 0;
  function applySize(w, h, tip) {
    const hg = el.querySelector('.hg');
    if (w == null) { hg.style.removeProperty('--hw'); hg.style.removeProperty('--hh'); size = null; try { localStorage.removeItem(SIZE_KEY); } catch { } }
    else { [w, h] = fitSize(w, h); hg.style.setProperty('--hw', w + 'px'); hg.style.setProperty('--hh', h + 'px'); size = { w, h }; try { localStorage.setItem(SIZE_KEY, JSON.stringify(size)); } catch { } }
    if (tip) { const r = hg.getBoundingClientRect(), T = el.querySelector('.szt'); T.textContent = Math.round(r.width) + ' × ' + Math.round(r.height); T.classList.add('on'); clearTimeout(szT); szT = setTimeout(() => T.classList.remove('on'), 900); }
  }
  function sizingInit() {
    const hg = el.querySelector('.hg'), grip = el.querySelector('.grip');
    el.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;                                                   // a pinch (plain scrolling still scrolls the grid)
      e.preventDefault(); e.stopPropagation();
      const r = hg.getBoundingClientRect(), k = Math.exp(-e.deltaY * .01);
      applySize(r.width * k, r.height * k, true);
    }, { passive: false });
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const r = hg.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      const mv = ev => applySize(r.width + (ev.clientX - x0) * 2, r.height + (ev.clientY - y0) * 2, true);   // (×2: the panel is centred)
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => applySize(null, null, true));
    addEventListener('resize', () => { if (el.style.display !== 'none' && size) applySize(size.w, size.h); });
  }
  function close() { if (el) { el.style.display = 'none'; el.style.opacity = ''; el.style.pointerEvents = ''; } }
  viz.onEndClick = () => open();

  // implant: the session comes up at once; the probe carries the item from the Endurance; on arrival the command is typed
  function implant(sid, cap) {
    const s = snap.sessions.find(x => x.sid === sid); if (!s) return;
    const text = textFor(cap), id = termOf(s);
    if (id && terms.has(id) && document.body.dataset.view === 'mesh') setView('split');
    select(sid); if (id && terms.has(id)) activate(id);
    let done = false;
    const type = () => {
      if (done) return; done = true;
      (equipped.get(sid) || equipped.set(sid, new Set()).get(sid)).add(cap.name);
      if (id && terms.has(id)) { window.api.pty.write(id, text); const T = terms.get(id); if (T && T.term) T.term.focus(); toast(`Implanted ${text.trim()} → ${s.name}`); }
      else { const i = $('#cText'); if (i && !i.disabled) { i.value = text; i.focus(); i.setSelectionRange(text.length, text.length); toast(`Implanted ${text.trim()} → ${s.name} (press Enter to send)`); } else toast(`${s.name} can't take input from here`); }
    };
    const c = cap.kind === 'connector' ? '#8fb36a' : GOLD, it = (data && (cap.kind === 'connector' ? data.connectors : data.skills).find(x => x.name === cap.name)) || {};
    if (!viz.probeDeliver || !viz.probeDeliver(sid, { label: cap.name.replace(/^[^:]+:/, ''), color: c, px: window.pixelIconURL ? pixelIconURL(picked.get(cap.name) || iconFor({ ...it, ...cap }), cap.name) : null }, type)) type();
    setTimeout(type, 12000);                                                    // (never left waiting on the probe)
  }
  const capOf = e => { try { return JSON.parse(e.dataTransfer.getData(MIME)); } catch { return null; } };
  const isCap = e => [...(e.dataTransfer.types || [])].includes(MIME);
  const meshSid = e => { const h = viz.hit(e); return h && h !== 'hub' && !String(h).startsWith('grp:') ? h : null; };
  viz.c.addEventListener('dragover', e => { if (!isCap(e)) return; const sid = meshSid(e); viz.capHover = sid; viz.hover = sid; if (sid) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  viz.c.addEventListener('drop', e => { if (!isCap(e)) return; e.preventDefault(); const sid = meshSid(e), c = capOf(e); viz.capHover = null; if (sid && c) { close(); implant(sid, c); } });
  $('#list').addEventListener('dragover', e => { if (!isCap(e)) return; const r = e.target.closest('.srow'); document.querySelectorAll('.capT').forEach(x => x !== r && x.classList.remove('capT')); if (r && r.dataset.sid) { e.preventDefault(); r.classList.add('capT'); } }, true);
  $('#list').addEventListener('drop', e => { if (!isCap(e)) return; e.preventDefault(); e.stopPropagation(); const r = e.target.closest('.srow'), c = capOf(e); document.querySelectorAll('.capT').forEach(x => x.classList.remove('capT')); if (r && r.dataset.sid && c) { close(); implant(r.dataset.sid, c); } }, true);
})();
