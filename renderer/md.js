// Tiny, safe markdown → HTML for session summaries / CLAUDE.md (escape first, then format).
function mdToHtml(src) {
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  const out = []; let list = 0, code = false, buf = [];
  const closeLists = () => { while (list > 0) { out.push('</ul>'); list--; } };
  for (const raw of String(src || '').split('\n')) {
    if (/^\s*```/.test(raw)) { if (code) { out.push('<pre>' + esc(buf.join('\n')) + '</pre>'); buf = []; } else closeLists(); code = !code; continue; }
    if (code) { buf.push(raw); continue; }
    const h = /^(#{1,4})\s+(.*)/.exec(raw), li = /^(\s*)(?:[-*•]|\d+\.)\s+(.*)/.exec(raw);
    if (h) { closeLists(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); }
    else if (li) { const depth = Math.min(4, Math.floor(li[1].length / 2) + 1); while (list < depth) { out.push('<ul>'); list++; } while (list > depth) { out.push('</ul>'); list--; } out.push('<li>' + inline(li[2]) + '</li>'); }
    else if (!raw.trim()) { closeLists(); }
    else { closeLists(); out.push('<p>' + inline(raw) + '</p>'); }
  }
  if (code) out.push('<pre>' + esc(buf.join('\n')) + '</pre>');
  closeLists(); return out.join('');
}
