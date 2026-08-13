/**
 * Transcript cleaning.
 *
 * The line these tests defend: fix artefacts of the TRANSCRIPTION, never edit
 * the user's words. Every "improvement" a recogniser tempts you into —
 * capitalising, punctuating, dropping filler — is rewriting what someone said,
 * which is the exact failure the parser's verbatim rule exists to prevent.
 */

import { describe, expect, it } from "vitest";
import { appendTranscript, cleanTranscript, isUsableTranscript } from "@/lib/transcript";

describe("cleanTranscript", () => {
  it("collapses the whitespace engines emit between chunks", () => {
    expect(cleanTranscript("  he said   he'd \n milk  a cow ")).toBe(
      "he said he'd milk a cow",
    );
  });

  it("closes the gap before punctuation left by joining chunks", () => {
    expect(cleanTranscript("wait , really ?")).toBe("wait, really?");
  });

  it("strips invisible characters", () => {
    expect(cleanTranscript("hello​world﻿")).toBe("helloworld");
  });

  it("leaves the words themselves completely alone", () => {
    // No capitalising, no terminal full stop, no filler removal — all of that
    // would be putting words in someone's mouth.
    const spoken = "um so like he just said it wasn't him";
    expect(cleanTranscript(spoken)).toBe(spoken);
  });

  it("preserves casing and contractions exactly", () => {
    expect(cleanTranscript("Jake said he ISN'T going")).toBe("Jake said he ISN'T going");
  });
});

describe("isUsableTranscript", () => {
  it("accepts anything with a letter or digit", () => {
    expect(isUsableTranscript("ok")).toBe(true);
    expect(isUsableTranscript("42")).toBe(true);
  });

  it("rejects empty, whitespace and punctuation-only results", () => {
    // Recognisers emit these for a cough or a door; queueing them would put
    // junk rows in the Inbox for the user to clear out.
    for (const junk of ["", "   ", "\n", ".", " , . ", "​"]) {
      expect(isUsableTranscript(junk)).toBe(false);
    }
  });

  it("accepts non-Latin scripts", () => {
    expect(isUsableTranscript("こんにちは")).toBe(true);
    expect(isUsableTranscript("Привет")).toBe(true);
  });
});

describe("appendTranscript", () => {
  it("seeds an empty box", () => {
    expect(appendTranscript("", "he said what", 2000)).toBe("he said what");
  });

  it("extends existing text with a single space", () => {
    expect(appendTranscript("he said", "what now", 2000)).toBe("he said what now");
  });

  it("accumulates several phrases in order", () => {
    let text = "";
    for (const phrase of ["first bit", "second bit", "third bit"]) {
      text = appendTranscript(text, phrase, 2000);
    }
    expect(text).toBe("first bit second bit third bit");
  });

  it("returns the previous text untouched for an unusable phrase", () => {
    // A cough must not append a stray space to what the user already typed.
    expect(appendTranscript("he said", "   ", 2000)).toBe("he said");
    expect(appendTranscript("he said", ".", 2000)).toBe("he said");
  });

  it("respects the capture length cap", () => {
    expect(appendTranscript("a".repeat(2000), "more words", 2000)).toHaveLength(2000);
  });

  it("never mutates what was already typed", () => {
    const typed = "  Jake said   this  ";
    // The existing text is trimmed at the join, but its interior is the user's
    // own typing and is left as-is.
    expect(appendTranscript(typed, "and then left", 2000)).toBe(
      "Jake said   this and then left",
    );
  });
});
