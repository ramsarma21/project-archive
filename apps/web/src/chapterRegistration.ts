import { BOSTON_1765_CHAPTER } from "@pa/chapter-boston";
import { BOSTON_1765_WORLD } from "@pa/chapter-boston-world";

if (BOSTON_1765_CHAPTER.chapterId !== BOSTON_1765_WORLD.chapterId) {
  throw new Error(
    `chapter/world registration mismatch: ${BOSTON_1765_CHAPTER.chapterId} != ${BOSTON_1765_WORLD.chapterId}`,
  );
}

export const BOSTON_1765_REGISTRATION = {
  runtime: BOSTON_1765_CHAPTER,
  world: BOSTON_1765_WORLD,
} as const;
