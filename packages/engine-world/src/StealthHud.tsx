// Stealth/chase HUD subscriber (DOM overlay above the Canvas), built on the
// stealthStore external-store pattern like QuestMarkerHud. Renders the live
// M1/M2 gauges: the watcher suspicion bar with 35%/70% tells, the heat chip,
// the camera-relative nearest-watcher chevron, and the chase stamina bar with
// the exhausted-jog message. Hidden entirely while nothing is relevant
// (CLEAR + calm + no chase); `dev` additionally mounts the data-* mirror node
// for tests and QA inspection.

import { useSyncExternalStore } from "react";
import type { StealthStore } from "./stealthStore.js";

export function StealthHud(props: {
  store: StealthStore;
  dev?: boolean;
  highContrast?: boolean;
  reducedMotion?: boolean;
}) {
  const snap = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
    props.store.getSnapshot,
  );

  const resourceVisible = snap.chaseActive || snap.timedDash;
  const watcherVisible =
    snap.suspicion > 0 || snap.heat !== "calm" || snap.nearestWatcherDir !== null;
  const visible = resourceVisible || watcherVisible;
  if (!visible && !props.dev) return null;

  return (
    <div
      className={`stealth-hud${props.highContrast ? " is-high-contrast" : ""}${props.reducedMotion ? " is-reduced-motion" : ""}${visible ? "" : " is-dev-hidden"}`}
      data-stealth-stamina={snap.stamina.toFixed(3)}
      data-stealth-suspicion={snap.suspicion.toFixed(3)}
      data-stealth-detection={snap.detectionState}
      data-stealth-heat={snap.heat}
      data-stealth-standing={snap.standing}
      data-stealth-chase={String(snap.chaseActive)}
      data-stealth-timed-dash={String(snap.timedDash)}
      data-stealth-chase-state={snap.chaseState}
      data-stealth-watcher-dir={
        snap.nearestWatcherDir === null ? "" : snap.nearestWatcherDir.toFixed(4)
      }
    >
      {visible && (
        <>
          {watcherVisible && (
            <section className="watcher-gauge" aria-label="Watcher awareness">
              <div className="watcher-heading">
                <strong>WATCH</strong>
                <span>
                  {snap.detectionState === "CLEAR"
                    ? "QUIET"
                    : snap.detectionState === "WARY"
                      ? "NOTICED"
                      : snap.detectionState === "ALERTED"
                        ? "CHALLENGE"
                        : "STOPPED"}
                </span>
              </div>
              <div
                className="suspicion-track"
                role="meter"
                aria-label="Watcher suspicion"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(snap.suspicion * 100)}
                aria-valuetext={
                  snap.detectionState === "CLEAR"
                    ? "Watcher attention is low"
                    : snap.detectionState === "WARY"
                      ? "A watcher has noticed you"
                      : snap.detectionState === "ALERTED"
                        ? "A watcher is approaching"
                        : "A watcher has stopped you"
                }
              >
                <div style={{ width: `${snap.suspicion * 100}%` }} />
                <i className="tell tell-wary" aria-hidden="true" />
                <i className="tell tell-alerted" aria-hidden="true" />
              </div>
              <div className="watcher-meta">
                <span className={`heat-chip heat-${snap.heat}`}>
                  Heat: {snap.heat.toUpperCase()}
                </span>
                {snap.nearestWatcherDir !== null && (
                  <span className="watcher-direction">
                    <i
                      aria-hidden="true"
                      style={{
                        transform: `rotate(${snap.nearestWatcherDir}rad)`,
                      }}
                    >
                      ➜
                    </i>
                    nearest watcher
                  </span>
                )}
              </div>
            </section>
          )}
          {resourceVisible && (
          <section className="stamina-gauge" aria-label="Chase stamina">
            <div className="stamina-heading">
              <strong>STAMINA</strong>
              <span>{snap.stamina <= 0 ? "EXHAUSTED — JOG" : `${Math.round(snap.stamina * 100)}%`}</span>
            </div>
            <div
              className="stamina-track"
              role="meter"
              aria-label="Stamina"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(snap.stamina * 100)}
              aria-valuetext={
                snap.stamina <= 0
                  ? "Empty. Sprint is limited to a jog."
                  : `${Math.round(snap.stamina * 100)} percent`
              }
            >
              <div style={{ width: `${snap.stamina * 100}%` }} />
            </div>
            <small>
              Hold Shift to sprint · walk to recover · F traversal costs stamina
            </small>
          </section>
          )}
          {snap.confirmResolve && (
            <button
              type="button"
              className="chase-confirm"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("pa:chase-confirm"))
              }
            >
              Confirm chase outcome
            </button>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {snap.announcement}
          </p>
        </>
      )}
    </div>
  );
}
