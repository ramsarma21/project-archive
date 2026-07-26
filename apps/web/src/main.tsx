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
import "./styles.css";

installBostonChapter();
installMissionDuel();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
