/**
 * Social read-path sanitization (B4). Anything an agent reads from X is UNTRUSTED input —
 * it can reach the reply composer (voice) but must never steer the trade gate. The structural
 * scoping lives in the callers (no code path passes social text into gate inputs); this layer
 * makes the text itself inert: capped, control-stripped, delimiter-safe.
 */

/** Max chars of social text an agent ever sees. */
export const SOCIAL_TEXT_CAP = 280;

/**
 * Make one piece of social text safe to show an agent:
 * - strip control chars, zero-width chars, and bidirectional overrides (invisible instruction
 *   smuggling and display spoofing)
 * - collapse whitespace
 * - neutralize the bracket delimiters the prompt wrapper uses, so content can't break out
 *   of its data frame
 * - hard-cap the length
 */
export function sanitizeSocialText(raw: string): string {
  let s = raw;
  // control chars (except space handled by collapse), zero-width chars, bidi controls
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, " ");
  // delimiter neutralization — the read-path wraps context in [ ] frames
  s = s.replace(/[[\]]/g, "'");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, SOCIAL_TEXT_CAP);
}

/** Wrap sanitized text in the data frame the composer/prompt uses. */
export function frameSocialText(sanitized: string): string {
  return `[social context, untrusted: "${sanitized}"]`;
}
