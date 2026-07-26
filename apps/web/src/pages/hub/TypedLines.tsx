import { useEffect, useRef, useState } from "react";

const CHARS_PER_SECOND = 42;
const LINE_GAP_MS = 340;

/**
 * The System addresses the player one line at a time, typing with authority.
 * Under reduced motion every line is present immediately (CSS drops the caret
 * and the fade), so no information is gated behind an animation.
 */
export function TypedLines(props: {
  lines: readonly string[];
  reducedMotion: boolean;
  /** Seconds before the first character. */
  startDelay?: number;
  /** Extra class on the wrapper, for styling the speech in context. */
  className?: string;
}) {
  const { lines, reducedMotion } = props;
  const [visibleLines, setVisibleLines] = useState(() =>
    reducedMotion ? lines.length : 0,
  );
  const [partial, setPartial] = useState("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];

    if (reducedMotion) {
      setVisibleLines(lines.length);
      setPartial("");
      return;
    }

    setVisibleLines(0);
    setPartial("");

    let elapsed = (props.startDelay ?? 0) * 1000;
    lines.forEach((line, lineIndex) => {
      for (let index = 1; index <= line.length; index++) {
        const at = elapsed + (index / CHARS_PER_SECOND) * 1000;
        timers.current.push(
          window.setTimeout(() => setPartial(line.slice(0, index)), at),
        );
      }
      elapsed += (line.length / CHARS_PER_SECOND) * 1000;
      timers.current.push(
        window.setTimeout(() => {
          setVisibleLines(lineIndex + 1);
          setPartial("");
        }, elapsed),
      );
      elapsed += LINE_GAP_MS;
    });

    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, [lines, reducedMotion, props.startDelay]);

  const typingLine = visibleLines < lines.length ? partial : "";

  return (
    <div
      className={`hub-system-speech${props.className ? ` ${props.className}` : ""}`}
      aria-live="polite"
    >
      {lines.slice(0, visibleLines).map((line, index) => (
        <p key={index} className="hub-system-line">
          {line}
        </p>
      ))}
      {visibleLines < lines.length && (
        <p className="hub-system-line is-typing">
          {typingLine}
          <span className="hub-caret" aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
