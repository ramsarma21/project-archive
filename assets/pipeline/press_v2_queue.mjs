// Isolated imported-component queue for press-common-operable-v2.
// No entry may include surrounding scenery or another mechanism component.
export const PRESS_V2_DIRS = {
  concepts: "assets/source/concepts/interior-kit/press-v2",
  raw: "assets/build/interior-kit/press-v2-components",
  optimized: "assets/build/interior-kit-opt/press-v2-components",
};

const SUFFIX =
  " only, centered, full object in frame, three-quarter orthographic product view, " +
  "plain light gray studio background, soft even lighting, no ground shadow, no people, no text, no watermark. " +
  "Historically accurate English common printing press construction used in 1765 colonial Boston. " +
  "Realistic aged oak, elm, iron, wool baize, and parchment as appropriate; muted used colors; " +
  "game asset reference photo. No modern machinery, Victorian styling, fantasy, museum display, room, or scenery.";

export const PRESS_V2_COMPONENTS = [
  {
    key: "press-frame-body",
    node: "Press_Frame",
    targetTris: 14000,
    meshyPoly: 24000,
    prompt:
      "Single static timber frame and body of an English common wooden printing press: two massive upright cheeks on broad feet, " +
      "top cap and cross-rails, waist-height bed rails/table and rear support framing. Deliberately EMPTY mechanism mounting spaces. " +
      "Absolutely no lever/bar, no screw/spindle, no platen, no sliding carriage/coffin, no tympan, and no frisket" + SUFFIX,
  },
  {
    key: "press-lever-bar",
    node: "Press_Lever",
    targetTris: 2500,
    meshyPoly: 7000,
    prompt:
      "Single removable wooden pressman's bar/lever for an eighteenth-century English common press: one long gently tapered round hardwood bar " +
      "with a slightly enlarged hand grip at one end, straight and isolated. No screw, hub, frame, platen, or other press parts" + SUFFIX,
  },
  {
    key: "press-screw-spindle",
    node: "Press_Screw",
    targetTris: 4500,
    meshyPoly: 9000,
    prompt:
      "Single isolated eighteenth-century wooden printing-press screw spindle: stout vertical dark hardwood shaft with clearly carved coarse helical threads, " +
      "a compact square/round bar-hole head near its lower end, and a short smooth neck for attaching the platen. No lever bar, platen, frame, or table" + SUFFIX,
  },
  {
    key: "press-platen-board",
    node: "Press_Platen",
    targetTris: 3000,
    meshyPoly: 7000,
    prompt:
      "Single isolated flat rectangular English common-press platen: thick heavy seasoned hardwood impression board with iron reinforcement at the centered top screw socket, " +
      "broad smooth flat underside, restrained eighteenth-century construction. No screw, lever, carriage, frame, tympan, or paper" + SUFFIX,
  },
  {
    key: "press-carriage-coffin",
    node: "Press_Carriage",
    targetTris: 4500,
    meshyPoly: 10000,
    prompt:
      "Single isolated sliding carriage/coffin bed of an eighteenth-century English common printing press: long shallow rectangular oak tray with low side rails, " +
      "flat stone/type-bed recess and underside runners, viewed pulled out. No press frame, screw, platen, lever, tympan, or frisket" + SUFFIX,
  },
  {
    key: "press-tympan-frame",
    node: "Press_Tympan",
    targetTris: 3500,
    meshyPoly: 8000,
    prompt:
      "Single isolated hinged tympan of an eighteenth-century English common printing press: thin rectangular hardwood frame with taut aged parchment or wool-baize packing surface, " +
      "small historically plausible iron hinge leaves along one short edge and two simple leather retaining tabs. No frisket, carriage, press frame, lever, or screw" + SUFFIX,
  },
  {
    key: "press-frisket-frame",
    node: "Press_Frisket",
    targetTris: 3000,
    meshyPoly: 7000,
    prompt:
      "Single isolated frisket of an eighteenth-century English common printing press: very thin rectangular hardwood frame with an open center and narrow parchment masking margins, " +
      "small iron hinge leaves along one short edge. No tympan, carriage, press frame, platen, lever, or screw" + SUFFIX,
  },
];

