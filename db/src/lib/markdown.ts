// Tiny, dependency-free Markdown → HTML for event descriptions.
// Supports: **bold**, *italic*, [links](url), bullet lists (- / *),
// and # / ## / ### headings. HTML is escaped first, so club-entered
// text can never inject markup. URLs are restricted to http(s)/mailto.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const safeUrl = (u: string) =>
  /^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : '#';

const inline = (t: string) =>
  esc(t)
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_m, text, url) =>
        `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer" class="underline" style="color:var(--brand,#1f6feb)">${text}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const blocks = src.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) return '';
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return (
          '<ul class="list-disc space-y-1 pl-5">' +
          lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') +
          '</ul>'
        );
      }
      const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
      if (lines.length === 1 && h) {
        const lvl = h[1].length;
        const cls = lvl === 1 ? 'text-lg font-semibold' : lvl === 2 ? 'text-base font-semibold' : 'font-semibold';
        return `<p class="${cls}">${inline(h[2])}</p>`;
      }
      return `<p>${lines.map(inline).join('<br/>')}</p>`;
    })
    .filter(Boolean)
    .join('');
}
