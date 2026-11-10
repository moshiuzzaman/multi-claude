'use strict';
// Writing CLAUDE_CONFIG_DIR into the user's own VS Code settings.
//
// The Claude Code extension watches `claudeCode.environmentVariables` and
// refreshes its hosts in place when CLAUDE_CONFIG_DIR changes, so switching
// account is a settings edit rather than a new window.
//
// settings.json is JSONC: it carries comments and trailing commas, so it must
// never be parsed — a tolerant parser would be this project's first runtime
// dependency, and the packaged build ships no node_modules. Instead the
// setting lives inside comment markers and is replaced as a whole block, which
// bounds the edit exactly without parsing anything.

const OVERRIDE_KEY = 'claudeCode.environmentVariables';
const BEGIN = '// >>> multi-claude: managed block — do not edit by hand';
const END = '// <<< multi-claude';

/** The block's extent in `text`, or null when it is not there. */
function findBlock(text) {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return null;
  const end = text.indexOf(END, begin);
  if (end === -1) return null;
  return { start: begin, end: end + END.length };
}

/** The block itself, indented for a top-level key; the caller indents line one. */
function blockText(ccDir, nl) {
  return [
    BEGIN,
    '// Points Claude Code at the account Multi-Claude last switched to.',
    `"${OVERRIDE_KEY}": [`,
    `  { "name": "CLAUDE_CONFIG_DIR", "value": ${JSON.stringify(ccDir)} }`,
    '],',
    END
  ].join(nl + '  ');
}

/** The config dir currently in the managed block, or null. */
function readManaged(text) {
  const s = String(text ?? '');
  const at = findBlock(s);
  if (!at) return null;
  const m = /"value"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(s.slice(at.start, at.end));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * Does the key appear outside our block?
 *
 * Any occurrence counts, including one inside a comment: without a parser we
 * cannot tell the difference, and the conservative answer refuses to write
 * rather than risk overriding a setting the user made deliberately.
 */
function hasForeignKey(text) {
  const s = String(text ?? '');
  const at = findBlock(s);
  const outside = at ? s.slice(0, at.start) + s.slice(at.end) : s;
  return outside.includes(OVERRIDE_KEY);
}

/** The file text with the managed block inserted or replaced. */
function writeManaged(text, ccDir) {
  const s = String(text ?? '');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const block = blockText(ccDir, nl);

  const at = findBlock(s);
  if (at) return s.slice(0, at.start) + block + s.slice(at.end);

  const open = s.indexOf('{');
  if (open === -1) return `{${nl}  ${block}${nl}}${nl}`;
  const rest = s.slice(open + 1);
  // END is a line comment, so whatever follows it on its line would be
  // commented out — with `{}` that would be the closing brace.
  const sep = /^[ \t]*\r?\n/.test(rest) ? '' : nl;
  return `${s.slice(0, open + 1)}${nl}  ${block}${sep}${rest}`;
}

module.exports = { OVERRIDE_KEY, BEGIN, END, readManaged, hasForeignKey, writeManaged };
