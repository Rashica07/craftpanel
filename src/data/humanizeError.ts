/**
 * Turns whatever the Rust backend (or the JS runtime, or Tauri's IPC layer)
 * threw into something a 14-year-old can act on.
 *
 * Most Rust error strings in this codebase are *already* written in plain
 * English (see properties.rs, provision.rs, etc. — "No Java runtime found on
 * PATH…", "No file given."). This module's job is narrower than it sounds:
 *
 *   1. Recognise the handful of error shapes that are genuinely technical —
 *      OS error codes, network/DNS failures, a bare Rust `Err(...)` debug
 *      dump, a stack trace — and give THOSE a friendly headline + one
 *      concrete next step, with the raw text still available on request.
 *   2. Leave everything else alone. If the backend already wrote a clear
 *      sentence, re-wrapping it as "Something went wrong" would make the UI
 *      *worse*, not better — so the fallback path passes it straight
 *      through as the title, with no "show details" disclosure, unless it
 *      actually looks technical by the heuristics below.
 *
 * Nothing is ever discarded: `detail` always carries the original text, the
 * UI (`ErrorBanner`) just decides whether to lead with it or hide it behind
 * one click.
 */

export interface FriendlyError {
  /** Stable category id — "java", "port", "generic", "plain", etc. Lets a
   * caller (like ErrorBanner) attach a real fix for a known category
   * instead of just guessing from the title text. */
  id: string;
  /** One clear sentence, no jargon. What to show first. */
  title: string;
  /** Optional second sentence: what to actually do about it. */
  hint?: string;
  /** The original text, lightly cleaned. Always present. */
  detail: string;
  /** Whether `detail` is worth hiding behind a "show details" toggle. */
  technical: boolean;
  icon: string;
}

interface Rule {
  id: string;
  test: RegExp;
  title: string;
  hint?: string;
  icon: string;
}

// Ordered — first match wins. Broad categories first, specific ones after.
const RULES: Rule[] = [
  {
    id: "java",
    test: /no java runtime found|failed to launch java|java.*(not found|not recognized)/i,
    title: "This computer doesn't have Java set up",
    hint: "CraftPanel needs a Java runtime to start Minecraft. Install a JDK (Temurin 17 or 21 both work), or point CraftPanel at one in Settings → Default Java.",
    icon: "download",
  },
  {
    id: "buildtools-java",
    test: /requires java versions between/i,
    title: "This Spigot version needs an older Java",
    hint: "Old Minecraft versions were built against whatever Java was current back then. CraftPanel already looked for one installed on this machine and didn't find it — install a matching JDK (Adoptium/Temurin publishes archived builds for every version) and try again. No path to paste in — it's picked up automatically.",
    icon: "download",
  },
  {
    id: "buildtools-no-version",
    test: /no build data for/i,
    title: "Spigot doesn't have that exact version",
    hint: "Some Minecraft point releases were client-only patches with no separate server build. Try the version just below it in the picker instead.",
    icon: "alert",
  },
  {
    id: "buildtools",
    test: /buildtools (failed|didn't finish)/i,
    title: "Spigot couldn't be compiled",
    hint: "BuildTools needs a full JDK (not just a JRE) and a solid internet connection — it downloads and builds Minecraft's own source. Check \"Show technical details\" below for exactly where it stopped.",
    icon: "alert-octagon",
  },
  {
    id: "port",
    test: /address already in use|port.*(in use|already bound)|os error 4?8\b|os error 98\b|os error 1004[89]\b/i,
    title: "Something else is already using this port",
    hint: "Stop whatever's using it, or give this server a different port in Settings → Advanced.",
    icon: "alert-octagon",
  },
  {
    id: "permission",
    test: /permission denied|access is denied|os error 13\b|access denied/i,
    title: "CraftPanel doesn't have permission to do that",
    hint: "Check the folder isn't read-only or locked by another program — a cloud-sync tool or antivirus holding a file open is a common cause.",
    icon: "lock",
  },
  {
    id: "notfound",
    test: /no such file or directory|os error 2\b|the system cannot find the (file|path)/i,
    title: "Couldn't find that file",
    hint: "It may have been moved, renamed, or deleted outside CraftPanel.",
    icon: "folder-open",
  },
  {
    id: "disk",
    test: /no space left on device|not enough space|disk full|there is not enough space/i,
    title: "This drive is out of space",
    hint: "Free up some room and try again.",
    icon: "hard-drive",
  },
  {
    id: "db",
    test: /database is locked|database is busy/i,
    title: "CraftPanel's database is busy",
    hint: "Close any other CraftPanel window and try again in a moment.",
    icon: "clock",
  },
  {
    id: "network",
    test: /dns error|could not resolve host|network is unreachable|connection refused|timed out|request timeout|modrinth request failed/i,
    title: "Couldn't reach the internet",
    hint: "Check your connection — downloading versions, browsing mods, and the tunnel all need it.",
    icon: "wifi",
  },
  {
    id: "json",
    test: /expected value|eof while parsing|invalid json|unexpected end of json|bad JSON/i,
    title: "Got a reply the app didn't expect",
    hint: "Usually temporary — try again in a moment.",
    icon: "alert",
  },
];

/** OS errno / Win32 codes stripped from strings that already matched a rule. */
const OS_ERROR = /\s*\(os error \d+\)/gi;

/** Heuristics for "this looks like a raw exception, not prose". */
function looksTechnical(s: string): boolean {
  return (
    /os error \d+/i.test(s) ||
    /^\s*(Err|Error|Ok)\(/.test(s) ||
    /panicked at/i.test(s) ||
    /\bat \S+:\d+:\d+\b/.test(s) ||
    /\b[a-z_]+::[a-z_]+::[a-z_]+/.test(s) || // rust:: module paths, 2+ deep
    s.split("\n").length > 2 ||
    s.length > 180
  );
}

function clean(s: string): string {
  return s
    .replace(/^(uncaught\s*)?error:?\s*/i, "")
    .replace(/^invoke error:?\s*/i, "")
    .trim();
}

export function humanizeError(raw: unknown): FriendlyError {
  const text = clean(
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw),
  );

  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return {
        id: rule.id,
        title: rule.title,
        hint: rule.hint,
        icon: rule.icon,
        detail: text.replace(OS_ERROR, "").trim() || text,
        technical: true,
      };
    }
  }

  if (looksTechnical(text)) {
    return {
      id: "generic",
      title: "Something went wrong",
      icon: "alert-octagon",
      detail: text,
      technical: true,
    };
  }

  // already plain English (most Rust error strings in this app are) — pass
  // it straight through as the headline, nothing to hide
  return {
    id: "plain",
    title: text || "Something went wrong",
    icon: "alert-octagon",
    detail: text,
    technical: false,
  };
}
