import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PvpScreen } from "./PvpScreen.js";
import { installPvpArena } from "./installPvpArena.js";
import "../styles.css";

// A page of its own, at /src/pvp/pvp.html.
//
// PvP is reached this way rather than through App.tsx for one practical reason:
// TWO SESSIONS. The duel needs two different accounts, one browser keeps one cookie
// jar, and the second account therefore lives in a private/incognito window. A
// standalone URL is a thing you can paste into that window; a state transition
// inside the app is not.
//
// It is a real page, not a harness. There is no stand-in opponent, no injected
// verdict and no simulated fight anywhere in this directory — every number comes
// from the API. The hub can mount `PvpScreen` directly whenever its owner wants to,
// and nothing here has to change when it does.
//
//   ?reduced=1   reduced motion.

// Before the app mounts, exactly as main.tsx installs the mission's duel view. A hub
// that mounts `PvpScreen` itself makes the same call in its own entry point; without
// it `PvpArena` consults an empty registry and says so instead of drawing.
installPvpArena();

const params = new URLSearchParams(window.location.search);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PvpScreen reducedMotion={params.get("reduced") === "1"} />
  </StrictMode>,
);
