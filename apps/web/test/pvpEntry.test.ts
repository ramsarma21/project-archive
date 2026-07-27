// The shipped game reaches PvP.
//
// PvP has been a real page at /src/pvp/pvp.html and never reachable from the game
// the player actually loads: `main.tsx` installed the mission duel but not the
// arena, `App.tsx` had no PvP view, and the hub had no door to one. So a build
// could ship with the whole mode dark and every unit test green, because every
// test drove the standalone entry.
//
// Two things are checked. First, that installing the arena makes `PvpArena` a
// VIEW rather than the empty-registry curtain — the same property the mission
// duel's install test asserts, and the reason `main.tsx` must call it before the
// app mounts. Second, that the production entry, the App shell and the hub are
// actually wired to reach it: the arena install, the `pvp` view mounting
// `PvpScreen` with an exit back to the hub, and the hub's keyboard-reachable
// button. Those three modules pull in `.css` and three.js and cannot be imported
// under `node --test` (there is no jsdom and no css loader here — see
// pvpInputWiring.test.ts), so the wiring is read off the source, which is exactly
// where a regression would land: a deleted line, not a changed behaviour.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { clearPvpArenaView, pvpArenaMode, pvpArenaView } from "../src/pvp/arenaPort.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(HERE, "..", "src", rel), "utf8");

// ---- the registration ------------------------------------------------------

test("installing the PvP arena makes the arena surface a view", async () => {
  clearPvpArenaView();
  assert.equal(pvpArenaView(), null, "nothing is registered before the install");
  assert.equal(pvpArenaMode(false), "PENDING", "an empty registry draws the curtain");

  const { installPvpArena } = await import("../src/pvp/installPvpArena.js");
  installPvpArena();

  const view = pvpArenaView();
  assert.ok(view, "the install registered a view");
  assert.equal(pvpArenaMode(pvpArenaView() !== null), "VIEW");
});

test("installing the PvP arena twice keeps one registration", async () => {
  const { installPvpArena } = await import("../src/pvp/installPvpArena.js");
  installPvpArena();
  const first = pvpArenaView();
  installPvpArena();
  assert.equal(pvpArenaView(), first, "a second install does not replace the first");
});

// ---- the production entry installs the arena -------------------------------

test("the production main entry installs the arena before mounting", () => {
  const main = src("main.tsx");
  // Imported from the directory that owns it, exactly as the mission duel is.
  assert.match(main, /installPvpArena\s*}?\s*from\s*["']\.\/pvp\/installPvpArena\.js["']/);
  // Called, not merely imported, and before createRoot renders the app — so a
  // match reaching its arena finds a view rather than the empty-registry curtain.
  const installedAt = main.indexOf("installPvpArena()");
  const mountedAt = main.indexOf("createRoot(");
  assert.ok(installedAt >= 0, "installPvpArena() is called");
  assert.ok(mountedAt >= 0, "the app is mounted");
  assert.ok(installedAt < mountedAt, "the arena is installed before the app mounts");
});

// ---- App can navigate to PvP -----------------------------------------------

test("App has a pvp view that mounts PvpScreen with an exit back to the hub", () => {
  const app = src("App.tsx");
  assert.match(app, /import\s*{\s*PvpScreen\s*}\s*from\s*["']\.\/pvp\/index\.js["']/);
  // A representable pvp view, so entering it is a state transition and not a URL.
  assert.match(app, /name:\s*"pvp"/);
  // The view mounts the screen and hands it an exit that returns to the hub with
  // the same profile it was opened from.
  assert.match(app, /<PvpScreen[\s\S]*?onExit=\{[\s\S]*?name:\s*"hub"/);
  // Reduced motion is carried through, as the brief requires.
  assert.match(app, /<PvpScreen[\s\S]*?reducedMotion=/);
});

// ---- the hub is the door ----------------------------------------------------

test("the hub has a keyboard-reachable duelling-ground entry", () => {
  const hub = src("pages/hub/Hub.tsx");
  // A prop the App wires to the pvp transition, not a hard-coded route.
  assert.match(hub, /onEnterDuellingGround/);
  // A real <button> (keyboard- and screen-reader-reachable), not a div, and it is
  // wired to the entry callback.
  assert.match(
    hub,
    /<button[^>]*onClick=\{props\.onEnterDuellingGround\}[\s\S]*?Duelling ground/,
  );
  // And the App passes that callback in, opening the pvp view.
  const app = src("App.tsx");
  assert.match(app, /onEnterDuellingGround=\{[\s\S]*?name:\s*"pvp"/);
});
