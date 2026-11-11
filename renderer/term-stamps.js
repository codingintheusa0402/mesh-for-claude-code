// A time column on the left of a Claude Code terminal (2026-11-01): every prompt line (`>` / `❯`) and every reply
// line (`●` / `⏺`) gets the time it was made — Claude Code itself only prints "done 3:15 PM" at the end of a turn.
// The terminal stream carries no times, so the lines are matched by their first words to the session's transcript
// (transcript-stamps.js on the Mac side). Tool lines ("Ran 2 shell commands", "● Bash(…)") stay unlabelled.
// Used by the Mac app (renderer/app.js) and the phone (phone/phone.js).
//   attachTermStamps(term, box, { sid: () => sessionId, fetch: sid => Promise<[{t,k,x}]>, gutter: 40 })
//   → { refresh(), dispose() }
(function () {
  const norm = s => String(s || '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[`*_#>❯⏺•●]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
  const PROMPT = /^\s*[>❯]\s+\S/, REPLY = /^\s*[●⏺]\s+\S/;
  const two = n => String(n).padStart(2, '0');
  const label = t => { const d = new Date(t), now = new Date();
    return d.toDateString() === now.toDateString() ? `${two(d.getHours())}:${two(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`; };

  function attachTermStamps(term, box, opt) {
    const G = opt.gutter || 40;
    const host = box.parentElement; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const gut = document.createElement('div'); gut.className = 'tstamps';
    gut.style.cssText = `position:absolute;width:${G - 6}px;overflow:hidden;pointer-events:none;z-index:2;` +
      `font:10px/1 -apple-system,system-ui,sans-serif;color:rgba(200,205,220,.55);font-variant-numeric:tabular-nums;text-align:right`;
    host.appendChild(gut);
    // the terminal starts right of the column: padding on xterm's own element (the fit addon subtracts that one)
    const te = term.element, pad0 = te ? parseFloat(getComputedStyle(te).paddingLeft) || 0 : 0;
    if (te) te.style.paddingLeft = (pad0 + G) + 'px';
    let stamps = [], sid = null, raf = 0, timer = 0, dead = false, lastKey = '';

    const place = () => {                                          // the column sits over the box's left edge
      const hb = host.getBoundingClientRect(), bb = box.getBoundingClientRect();
      gut.style.left = (bb.left - hb.left + 2) + 'px'; gut.style.top = (bb.top - hb.top) + 'px'; gut.style.height = box.clientHeight + 'px';
      gut.style.background = (term.options.theme && term.options.theme.background) || getComputedStyle(box).backgroundColor || 'transparent';
    };
    const pick = (k, p, from) => {                                 // the matching transcript entry, in order
      let best = -1;
      for (let i = 0; i < stamps.length; i++) {
        const e = stamps[i]; if (e.k !== k) continue;
        if (e.x.startsWith(p) || (e.x.length >= 6 && p.startsWith(e.x))) { best = i; if (i >= from) break; }
      }
      return best;
    };
    const draw = () => {
      raf = 0; if (dead || !term.element) return;
      place();
      const b = term.buffer.active, rows = term.rows, scr = term.element.querySelector('.xterm-screen'); if (!scr) return;
      const cellH = scr.getBoundingClientRect().height / rows, gt = gut.getBoundingClientRect().top, st = scr.getBoundingClientRect().top;
      let html = '', from = 0;
      for (let y = 0; y < rows; y++) {
        const line = b.getLine(b.viewportY + y); if (!line) continue;
        const s = line.translateToString(true); const isP = PROMPT.test(s), isR = !isP && REPLY.test(s); if (!isP && !isR) continue;
        const p = norm(s).slice(0, 28); if (p.length < 4) continue;
        const i = pick(isP ? 'u' : 'a', p, from); if (i < 0) continue; from = i + 1;
        const top = st + y * cellH - gt + (cellH - 10) / 2;
        if (top < -10 || top > gut.clientHeight) continue;
        html += `<div style="position:absolute;right:0;top:${top.toFixed(1)}px${isP ? ';color:rgba(143,180,255,.8)' : ''}">${label(stamps[i].t)}</div>`;
      }
      if (html !== lastKey) { gut.innerHTML = html; lastKey = html; }
    };
    const soon = () => { if (!raf && !dead) raf = requestAnimationFrame(draw); };
    const load = async () => {
      const s = opt.sid(); if (!s) { stamps = []; soon(); return; }
      try { const r = await opt.fetch(s); if (Array.isArray(r)) { stamps = r; sid = s; soon(); } } catch { }
    };
    const subs = [term.onRender(soon), term.onScroll(soon), term.onResize(soon)];
    box.addEventListener('scroll', soon, { passive: true }); addEventListener('resize', soon);
    load(); timer = setInterval(() => { if (document.visibilityState === 'visible' && gut.offsetParent) load(); }, 8000);
    return {
      refresh: () => { load(); soon(); },
      dispose: () => { dead = true; clearInterval(timer); cancelAnimationFrame(raf); subs.forEach(d => d && d.dispose && d.dispose());
        box.removeEventListener('scroll', soon); removeEventListener('resize', soon); gut.remove(); if (te) te.style.paddingLeft = pad0 ? pad0 + 'px' : ''; },
    };
  }
  window.attachTermStamps = attachTermStamps;
})();
