// GitHub release notes, reduced to text blocks the dialog can show.
//
// Never rendered as HTML: a release note is text from the network. Headings
// and bullets keep their shape; links keep their words; markup is dropped.

function plain(s) {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

export function notesToBlocks(text) {
  const blocks = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const li = /^[-*+]\s+(.*)$/.exec(line);
    if (h) blocks.push({ type: 'h', text: plain(h[1]) });
    else if (li) blocks.push({ type: 'li', text: plain(li[1]) });
    else blocks.push({ type: 'p', text: plain(line) });
  }
  return blocks.filter((b) => b.text);
}
