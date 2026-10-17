// Turns the model's reply into a small, closed set of blocks the pane can draw.
//
// The model is asked for plain prose, bullets, inline code and bold, and nothing
// else. It will sometimes do something else anyway. Rather than render markdown
// (which would put headings, tables and links on screen) or trust the reply,
// this reads only the subset the pane knows how to draw and drops the markers it
// does not: a heading's leading hashes, an unmatched backtick, a stray asterisk.
// What is left is printed literally, so no marker ever reaches the reader.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string };

export type Block =
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "bullets"; items: Inline[][] };

const HEADING = /^#{1,6}\s+/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
// Inline code first so a backtick pair wins over bold inside it, then bold.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*/g;

// Strip the markers that were not part of a recognised span. A lone backtick or
// asterisk is a formatting character the model left behind, so it is removed
// rather than shown.
function sanitize(text: string): string {
  return text.replace(/[`*]/g, "");
}

function parseInline(line: string): Inline[] {
  const spans: Inline[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) {
      const text = sanitize(line.slice(last, index));
      if (text.length > 0) spans.push({ kind: "text", text });
    }
    if (match[1] !== undefined) {
      spans.push({ kind: "code", text: match[1] });
    } else if (match[2] !== undefined) {
      spans.push({ kind: "bold", text: sanitize(match[2]) });
    }
    last = index + match[0].length;
  }
  if (last < line.length) {
    const text = sanitize(line.slice(last));
    if (text.length > 0) spans.push({ kind: "text", text });
  }
  return spans;
}

export function parseExplanation(reply: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[] = [];
  let bullets: Inline[][] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", spans: paragraph });
      paragraph = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = [];
    }
  };

  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.replace(HEADING, "").trim();
    if (line.length === 0) {
      flushParagraph();
      flushBullets();
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      flushBullets();
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      flushParagraph();
      bullets.push(parseInline(bullet[1]));
      continue;
    }
    flushBullets();
    const spans = parseInline(line);
    if (spans.length > 0) paragraph.push(...spans);
  }
  flushParagraph();
  flushBullets();
  return blocks;
}
