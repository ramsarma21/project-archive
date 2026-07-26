import type { ReactNode } from "react";

/**
 * The System's panel frame: translucent cyan glass, sharp corner brackets, a
 * scanline wash and an edge glow. Extends the existing `.system-window`
 * language (styles.css) into a reusable hub container.
 *
 * `delay` staggers the entry animation; CSS suppresses it under
 * `.pa-reduced-motion`.
 */
export function SystemPanel(props: {
  children: ReactNode;
  kicker?: string;
  title?: string;
  /** Right-aligned header slot: a count, a rank chip, a status word. */
  meta?: ReactNode;
  /** Entry animation direction. */
  from?: "left" | "right" | "up";
  /** Seconds of entry delay, for staggered reveals. */
  delay?: number;
  className?: string;
}) {
  const classes = [
    "hub-panel",
    `hub-panel-from-${props.from ?? "up"}`,
    props.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={classes}
      style={{ ["--hub-delay" as string]: `${props.delay ?? 0}s` }}
    >
      <span className="hub-panel-scan" aria-hidden="true" />
      <span className="hub-panel-corner tl" aria-hidden="true" />
      <span className="hub-panel-corner tr" aria-hidden="true" />
      <span className="hub-panel-corner bl" aria-hidden="true" />
      <span className="hub-panel-corner br" aria-hidden="true" />
      {(props.kicker || props.title || props.meta) && (
        <header className="hub-panel-head">
          <div className="hub-panel-head-copy">
            {props.kicker && <span className="hub-panel-kicker">{props.kicker}</span>}
            {props.title && <h2 className="hub-panel-title">{props.title}</h2>}
          </div>
          {props.meta && <div className="hub-panel-meta">{props.meta}</div>}
        </header>
      )}
      <div className="hub-panel-body">{props.children}</div>
    </section>
  );
}
