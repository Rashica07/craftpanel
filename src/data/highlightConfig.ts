/**
 * A deliberately small, line-oriented syntax highlighter for the config
 * formats people actually open in the Files tab — YAML, JSON, `.properties`,
 * TOML. Not a real parser: each line is tokenized independently by regex,
 * good enough to make a 200-line `server.properties` or plugin config
 * scannable, without pulling in a full editor library for it. Never
 * throws — a highlighter that chokes on invalid YAML while someone is
 * mid-edit *fixing* invalid YAML would be actively hostile, so anything
 * unrecognized just falls through as plain, unstyled text.
 */

export type Lang = "json" | "yaml" | "properties" | "toml" | "plain";

export function langForFile(rel: string): Lang {
  const ext = (rel.split(".").pop() || "").toLowerCase();
  if (ext === "json" || ext === "mcmeta") return "json";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "properties") return "properties";
  if (ext === "toml") return "toml";
  return "plain";
}

export interface Token {
  text: string;
  cls?: string;
}

const CLS = {
  comment: "text-ink-ghost italic",
  key: "text-accent-soft",
  string: "text-ok",
  number: "text-info",
  keyword: "text-warn-soft",
  section: "text-accent-soft font-semibold",
};

function push(out: Token[], text: string, cls?: string) {
  if (text) out.push({ text, cls });
}

function splitLeading(line: string): [string, string] {
  const t = line.trimStart();
  return [line.slice(0, line.length - t.length), t];
}

/** Index of a `#` that starts a trailing comment — not one inside quotes. */
function unquotedHash(s: string): number {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || s[i - 1] === " ")) {
      return i;
    }
  }
  return -1;
}

function tokenizeScalar(text: string, out: Token[]) {
  const hashIdx = unquotedHash(text);
  const value = hashIdx === -1 ? text : text.slice(0, hashIdx);
  const comment = hashIdx === -1 ? "" : text.slice(hashIdx);
  const trimmed = value.trim();
  if (/^["'].*["']$/.test(trimmed) && trimmed.length >= 2) {
    push(out, value, CLS.string);
  } else if (/^(true|false|null|~|yes|no)$/i.test(trimmed)) {
    push(out, value, CLS.keyword);
  } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    push(out, value, CLS.number);
  } else {
    push(out, value);
  }
  push(out, comment, CLS.comment);
}

function tokenizeProperties(line: string): Token[] {
  const out: Token[] = [];
  const [lead, t] = splitLeading(line);
  push(out, lead);
  if (t.startsWith("#") || t.startsWith("!")) {
    push(out, t, CLS.comment);
    return out;
  }
  const eq = t.search(/[=:]/);
  if (eq === -1) {
    push(out, t);
    return out;
  }
  push(out, t.slice(0, eq), CLS.key);
  push(out, t[eq]);
  push(out, t.slice(eq + 1));
  return out;
}

function tokenizeYaml(line: string): Token[] {
  const out: Token[] = [];
  const [lead, t] = splitLeading(line);
  push(out, lead);
  if (t.startsWith("#")) {
    push(out, t, CLS.comment);
    return out;
  }
  let rest = t;
  if (rest.startsWith("- ")) {
    push(out, "- ");
    rest = rest.slice(2);
  }
  const m = rest.match(/^([A-Za-z0-9_.\-"']+)(\s*:\s*)(.*)$/);
  if (m) {
    push(out, m[1], CLS.key);
    push(out, m[2]);
    tokenizeScalar(m[3], out);
    return out;
  }
  tokenizeScalar(rest, out);
  return out;
}

function tokenizeToml(line: string): Token[] {
  const out: Token[] = [];
  const [lead, t] = splitLeading(line);
  push(out, lead);
  if (t.startsWith("#")) {
    push(out, t, CLS.comment);
    return out;
  }
  if (/^\[.*\]$/.test(t.trim())) {
    push(out, t, CLS.section);
    return out;
  }
  const m = t.match(/^([A-Za-z0-9_.\-"']+)(\s*=\s*)(.*)$/);
  if (m) {
    push(out, m[1], CLS.key);
    push(out, m[2]);
    tokenizeScalar(m[3], out);
    return out;
  }
  push(out, t);
  return out;
}

/** One JSON line at a time — good enough for pretty-printed config, which
 * is what CraftPanel and every plugin actually write. */
function tokenizeJson(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      const str = line.slice(i, j);
      const isKey = /^\s*:/.test(line.slice(j));
      push(out, str, isKey ? CLS.key : CLS.string);
      i = j;
    } else if (line.startsWith("true", i) || line.startsWith("false", i) || line.startsWith("null", i)) {
      const kw = line.startsWith("false", i) ? "false" : line.startsWith("true", i) ? "true" : "null";
      push(out, kw, CLS.keyword);
      i += kw.length;
    } else if (/[0-9-]/.test(c) && /[\s,:[{]|^$/.test(line[i - 1] ?? "")) {
      let j = i;
      while (j < line.length && /[0-9.eE+-]/.test(line[j])) j++;
      push(out, line.slice(i, j), CLS.number);
      i = j;
    } else {
      let j = i + 1;
      // This scan has to stop right before a true/false/null keyword
      // starts, or it swallows the keyword as plain text before the
      // dedicated branch above ever gets a turn at that position — a
      // real bug this had: `"a": true,` never highlighted `true` at
      // all, since the catch-all ran straight past it to the comma.
      while (
        j < line.length &&
        line[j] !== '"' &&
        !/[0-9-]/.test(line[j]) &&
        !line.startsWith("true", j) &&
        !line.startsWith("false", j) &&
        !line.startsWith("null", j)
      )
        j++;
      push(out, line.slice(i, j));
      i = j;
    }
  }
  return out;
}

export function highlightLine(line: string, lang: Lang): Token[] {
  try {
    switch (lang) {
      case "properties":
        return tokenizeProperties(line);
      case "yaml":
        return tokenizeYaml(line);
      case "toml":
        return tokenizeToml(line);
      case "json":
        return tokenizeJson(line);
      default:
        return [{ text: line }];
    }
  } catch {
    return [{ text: line }];
  }
}
