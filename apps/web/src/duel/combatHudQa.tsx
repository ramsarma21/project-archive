import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CombatHud } from "./CombatHud.js";
import { ammoReadout } from "./combatHudModel.js";
import { duelControls } from "./duelInput.js";
import "../styles.css";

// Harness for INSPECTING the combat HUD in states the live duel produces only rarely or
// unpredictably — a landed hit's flash, a critical health bar, a spent magazine — and
// for checking legibility over a bright sky as well as a dark scene. Not shipped and
// not routed. It mounts the REAL `CombatHud` with the real imported GLBs; only the
// numbers are injected, exactly as the duel would hand them in.
//
//   ?health=n ?max=n            player health / max (default 200/200)
//   ?ammo=n ?mag=n              current / magazine (default 14/14; 0/0 = pre-answer)
//   ?enemy=n ?enemyMax=n        opponent health / max (default 200/200)
//   ?enemyHit=n                 after a beat, drop the enemy to this to fire the marker
//   ?round=n ?clock=n           round ordinal / engagement seconds
//   ?withdrawn=1                the answering-beat withdrawal
//   ?tab=1                      show the controls legend as if Tab were held
//   ?bg=bright|dark|sky         backdrop to test contrast against
//   ?reduced=1                  reduced motion

const params = new URLSearchParams(window.location.search);
const num = (key: string, fallback: number): number => {
  const raw = params.get(key);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const BG: Record<string, string> = {
  bright:
    "linear-gradient(180deg, #dbe8f2 0%, #b9cbd8 45%, #9fae99 60%, #8a7a5e 100%)",
  sky: "linear-gradient(180deg, #eaf1f6 0%, #cfd9df 40%, #b7b39a 70%, #6f5f45 100%)",
  dark: "radial-gradient(120% 90% at 50% 40%, #16283a, #05080d)",
};

function Harness() {
  const enemyStart = num("enemy", 200);
  const enemyHit = params.get("enemyHit");
  const [enemyHealth, setEnemyHealth] = useState(enemyStart);
  const [playerHealth, setPlayerHealth] = useState(num("health", 200));
  useEffect(() => {
    // Capture hooks, so QA can fire the hit marker and the health-bar animation AFTER
    // the GLBs have painted, then screenshot the chip mid-drain.
    (window as unknown as { __hudSetEnemy?: (v: number) => void }).__hudSetEnemy = setEnemyHealth;
    (window as unknown as { __hudSetPlayer?: (v: number) => void }).__hudSetPlayer = setPlayerHealth;
    if (enemyHit === null) return undefined;
    const target = Number(enemyHit);
    if (!Number.isFinite(target)) return undefined;
    const timer = setTimeout(() => setEnemyHealth(target), 450);
    return () => clearTimeout(timer);
  }, [enemyHit]);

  const bg = BG[params.get("bg") ?? "dark"] ?? BG.dark;
  const reduced = params.get("reduced") === "1";

  return (
    <div style={{ position: "fixed", inset: 0, background: bg }}>
      <CombatHud
        self={{
          name: "You",
          weaponLabel: "Flintlock",
          glbKey: "playerboy-rigged",
          health: playerHealth,
          maxHealth: num("max", 200),
          ammo: ammoReadout(num("ammo", 14), num("mag", 14)),
        }}
        enemy={{
          name: "The King's officer",
          health: enemyHealth,
          maxHealth: num("enemyMax", 200),
        }}
        round={num("round", 1)}
        clockSeconds={params.has("clock") ? num("clock", 20) : null}
        clockUrgent={num("clock", 20) <= 5}
        withdrawn={params.get("withdrawn") === "1"}
        showReticle
        controls={{ items: duelControls(0), held: params.get("tab") === "1" }}
        reducedMotion={reduced}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
