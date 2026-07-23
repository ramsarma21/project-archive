import { createChapterRegistry } from "@pa/runtime";
import { BOSTON_1765_CHAPTER } from "@pa/chapter-boston";

// The server-side chapter registry: every chapter whose saves this API can
// replay-validate. Server-side replay looks chapters up by save.chapterId;
// an unregistered chapterId is a clean 400 (SAVE_INVALID), never a crash.
export const CHAPTERS = createChapterRegistry([BOSTON_1765_CHAPTER]);
