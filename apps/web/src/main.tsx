import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
// Registers every built mission in the chapter. Import for effect and before
// the app mounts, so the hub never renders a Deploy button for a mission the
// registry has not heard of.
import { installBostonChapter } from "./chapter/bostonChapter.js";
// Installs the duel view with the mission container's registry. Same reason and
// same timing: a mission that reaches its duel must find one waiting, and the
// container holds a registry rather than an import so the registration lives with
// the duel instead of here.
import { installMissionDuel } from "./duel/installDuel.js";
// Installs the PvP arena renderer with the arena port's registry. Same reason and
// same timing as the mission duel: a match that reaches its live arena must find a
// view waiting, and the registration lives with the thing being registered rather
// than as an import here. Without it `PvpArena` consults an empty registry and says
// so instead of drawing a stand-in fight.
import { installPvpArena } from "./pvp/installPvpArena.js";
import { consumeDevSessionFragment, consumeFreshTabFlag } from "./devSession.js";
import "./styles.css";

// Before anything talks to the API, in this exact order:
//  1. a tab opened as "Player 2" drops any copied per-tab local identity so it starts
//     as its own player. A normal tab is untouched.
//  2. a tab returning from a (non-production) Google callback binds the tab-scoped
//     handle the callback delivered in the URL fragment and scrubs it from history,
//     so this tab resolves as its OWN Google account rather than the shared cookie.
// The fragment is applied AFTER the fresh-tab clear, so a just-completed sign-in in a
// Player 2 tab wins over the one-shot clear rather than being wiped by it.
consumeFreshTabFlag();
consumeDevSessionFragment();

installBostonChapter();
installMissionDuel();
installPvpArena();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
