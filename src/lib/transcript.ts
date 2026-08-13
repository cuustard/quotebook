/**
 * Cleaning speech-recognition output before it reaches the capture box.
 *
 * ─────────────────────── Where the line is drawn ───────────────────────
 * A SAVED capture is verbatim and never mutated — it is the provenance record
 * the whole pipeline is checked against. This module runs strictly EARLIER
 * than that: it tidies what the recogniser produced on its way into the text
 * box, where the user can still see and edit it before saving.
 *
 * So the rule here is: remove artefacts of the TRANSCRIPTION, never edit the
 * user's words. Collapsing the double spaces an engine emits between phrases
 * is fixing the machine's output. "Improving" grammar, capitalising sentences
 * or stripping filler words would be rewriting what someone said — which is
 * exactly what the parser's verbatim rule exists to prevent further down the
 * pipeline, and it would be no better done here.
 */

/** Zero-width and bidi marks some engines emit; invisible, so pure noise. */
const INVISIBLES = /[​-‍⁠﻿]/g;

/**
 * Normalise one recognised phrase.
 *
 * Deliberately conservative: whitespace, invisibles, and the space that would
 * otherwise appear before punctuation when phrases are concatenated. Nothing
 * else.
 */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(INVISIBLES, "")
    // Recognisers emit "\n" and runs of spaces between result chunks; a
    // capture is a line of speech, so collapse them to single spaces.
    .replace(/\s+/g, " ")
    // " ." / " ," — an artefact of joining chunks, never something spoken.
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

/**
 * Is this phrase worth queueing at all?
 *
 * Recognisers emit empty and punctuation-only results (a cough, a door) and
 * queueing those would put junk rows in the Inbox for the user to clear out.
 * Requires at least one letter or digit.
 */
export function isUsableTranscript(raw: string): boolean {
  return /[\p{L}\p{N}]/u.test(cleanTranscript(raw));
}

/**
 * Append a recognised phrase to what is already in the box.
 *
 * Dictation extends rather than replaces, so a phrase can follow typed text
 * and several phrases accumulate. Returns the previous text unchanged when the
 * phrase is unusable, so a stray noise cannot append a stray space.
 */
export function appendTranscript(
  previous: string,
  phrase: string,
  maxLength: number,
): string {
  if (!isUsableTranscript(phrase)) return previous;
  const cleaned = cleanTranscript(phrase);
  const base = previous.trim();
  const joined = base ? `${base} ${cleaned}` : cleaned;
  return joined.slice(0, maxLength);
}
