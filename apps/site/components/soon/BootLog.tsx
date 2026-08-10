"use client";

/**
 * genesis.log — a typewriter boot sequence for the incubation page. Types
 * line by line, colorizes the verdict tokens once a line completes, then
 * holds a blinking cursor on "standing by". Starts as the boot veil lifts
 * (the veil now plays on every load). Reduced motion prints the whole log.
 */
import { useEffect, useState } from "react";
import { VEIL_OUT_MS } from "../Intro";

interface LogLine {
  text: string;
  /** rendered once the line is fully typed */
  done?: React.ReactNode;
}

const LINES: LogLine[] = [
  { text: "$ quants --genesis", done: <span className="text-faint">$ quants --genesis</span> },
  { text: "inoculating dish ............ ok", done: <>inoculating dish <Dots /> <Ok /></> },
  { text: "sequencing genomes .......... 9/9", done: <>sequencing genomes <Dots /> <b className="font-medium text-ink">9/9</b></> },
  { text: "arming fitness function ..... ok", done: <>arming fitness function <Dots /> <Ok /></> },
  { text: "arming death switch ......... ok", done: <>arming death switch <Dots /> <Ok /></> },
  { text: "sealing treasury ............ paper", done: <>sealing treasury <Dots /> <span className="hl">paper</span></> },
  { text: "locking public feeds ........ sealed", done: <>locking public feeds <Dots /> <span className="text-amber">sealed</span></> },
  {
    text: "status: incubating — the leaderboard opens soon",
    done: <span className="hl">status: incubating — the leaderboard opens soon</span>,
  },
];

function Dots() {
  return <span className="text-faint">............ </span>;
}

function Ok() {
  return <span className="text-up">ok</span>;
}

export function BootLog() {
  const [line, setLine] = useState(0); // lines fully typed
  const [chars, setChars] = useState(0); // chars typed in current line
  const [started, setStarted] = useState(false);

  // start typing just as the boot veil lifts
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLine(LINES.length);
      setStarted(true);
      return;
    }
    const t = setTimeout(() => setStarted(true), VEIL_OUT_MS + 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!started || line >= LINES.length) return;
    const current = LINES[line].text;
    if (chars < current.length) {
      const t = setTimeout(() => setChars((c) => c + 1), 13);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setLine((l) => l + 1);
      setChars(0);
    }, 210);
    return () => clearTimeout(t);
  }, [started, line, chars]);

  const typingDone = line >= LINES.length;

  return (
    <div className="border border-rule bg-paper">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="kicker kicker-flat">genesis.log</span>
        <span className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-dim">
          <span className="blink inline-block h-[6px] w-[6px] bg-accent" />
          rec
        </span>
      </div>
      <div className="min-h-[248px] px-4 py-4 font-mono text-[12.5px] leading-[1.95] text-dim">
        {LINES.slice(0, line).map((l, i) => (
          <div key={i} className="whitespace-nowrap">{l.done ?? l.text}</div>
        ))}
        {!typingDone && started && line < LINES.length ? (
          <div className="whitespace-nowrap text-ink">
            {LINES[line].text.slice(0, chars)}
            <span className="blink text-accent">▌</span>
          </div>
        ) : null}
        {typingDone ? (
          <div className="whitespace-nowrap text-ink">
            <span className="text-faint">$</span> <span className="blink text-accent">▌</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
