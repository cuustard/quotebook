"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Minimal shape of the Web Speech API we rely on. Typed here rather than
 * pulled from lib.dom because the API is still vendor-prefixed in most
 * browsers and is not in the standard TypeScript DOM types.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  /** False where the browser has no Web Speech API (Firefox, most of Linux). */
  supported: boolean;
  listening: boolean;
  /** Live partial text while speaking; "" once the phrase is finalised. */
  interim: string;
  start: () => void;
  stop: () => void;
}

/**
 * Voice dictation for a text field, via the browser's own speech recognition.
 *
 * Deliberately native rather than the app's AI parser: this is a keyboard
 * substitute for getting words into the box, it costs nothing, needs no
 * network round trip of the user's speech to us, and works before the capture
 * has been saved. The AI path still runs later, on the saved text.
 *
 * `supported` is false wherever the API is missing, so callers can hide the
 * affordance rather than offer a button that does nothing — the API is absent
 * in Firefox and much of Linux, which is too common to treat as an edge case.
 *
 * Finalised phrases are handed to `onFinal` and appended by the caller;
 * `interim` is exposed separately so a partial phrase can be shown without
 * being committed to the field.
 */
export function useSpeechDictation(onFinal: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  /**
   * Whether the browser has the API. Read through `useSyncExternalStore`
   * rather than an effect: `window` does not exist during the prerender, and
   * this is the primitive that lets a browser-only fact be read with an
   * explicit server value (`false`) instead of a post-mount state write. The
   * subscribe callback is a no-op because the answer cannot change for the
   * life of the document.
   */
  const supported = useSyncExternalStore(
    () => () => {},
    () => getConstructor() !== null,
    () => false,
  );

  // Held in a ref so restarting recognition never captures a stale callback.
  // Written in an effect, not during render — a render-phase ref write is not
  // safe under concurrent rendering, where a render can be discarded.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  useEffect(() => {
    return () => {
      recognition.current?.abort();
      recognition.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) return;

    // A fresh instance per session: reusing one after `stop()` is unreliable
    // across browsers.
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let finalText = "";
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else pending += text;
      }
      setInterim(pending);
      if (finalText.trim()) onFinalRef.current(finalText.trim());
    };
    // Any error ends the session rather than leaving a mic that looks live.
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognition.current = rec;
    rec.start();
    setListening(true);
  }, []);

  return { supported, listening, interim, start, stop };
}
