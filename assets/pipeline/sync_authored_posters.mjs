#!/usr/bin/env node
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, "assets/source/concepts/posters");
const destination = resolve(root, "apps/web/public/world/posters");
const files = [
  "poster-revenue-proclamation.png",
  "poster-stamp-schedule.png",
  "poster-nonimportation.png",
  "poster-no-consent.png",
  "poster-town-meeting.png",
  "poster-wharfage.png",
  "poster-liberty-tree.png",
  "sign-printer.png",
  "sign-tavern-grapes.png",
  "sign-baker-sheaf.png",
  "sign-chandler-anchor.png",
  "sign-watchhouse.png",
  "coinpaper-card.png",
];

mkdirSync(destination, { recursive: true });
for (const file of files) {
  copyFileSync(resolve(source, file), resolve(destination, file));
}
console.log(JSON.stringify({ synced: files.length, destination }));

