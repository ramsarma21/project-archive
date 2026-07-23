// Thin worker entry: the ONE place the web app registers its chapter
// package(s) with the headless runtime worker. The runtime imported here has
// no React/DOM dependency; this file (and the whole app) is the disposable
// presentation layer.
import { startRuntimeWorker } from "@pa/runtime/worker";
import { createChapterRegistry, BOSTON_1765_CHAPTER } from "@pa/runtime";

startRuntimeWorker(createChapterRegistry([BOSTON_1765_CHAPTER]));
