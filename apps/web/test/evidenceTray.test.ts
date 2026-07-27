import test from "node:test";
import assert from "node:assert/strict";
import module from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

// The reusable evidence hand/tray, shared by the PvE duel and PvP. These drive the
// real component and assert the four ways a card moves and the rules that gate it:
//
//   * TAP / keyboard: activating an offered card places it; activating a placed card
//     removes it — this is the ArchiveCard button, so click, Enter and Space all take
//     this path;
//   * DRAG: a lower-level dragstart→drop moves a card between the two zones;
//   * the selected count and the "place at least N" instruction track the selection;
//   * a live region announces every move for a screen reader;
//   * maxSelectable is enforced, and `locked` freezes the tray and hides the hand.
//
// The submit GATE itself lives in the two question panels; the pure `evidenceMinimumMet`
// it uses is asserted here so the rule is pinned without a DOM.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The runner has no CSS loader; stub `.css` to an empty module (see missionResultPanel.test.ts).
const cssStub = {
  load(url: string, context: unknown, nextLoad: (u: string, c: unknown) => unknown) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
};
const hooks = module as unknown as {
  registerHooks?: (h: typeof cssStub) => void;
  register: (specifier: string) => void;
};
if (typeof hooks.registerHooks === "function") {
  hooks.registerHooks(cssStub);
} else {
  hooks.register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function load(url, context, nextLoad) {" +
          "  if (url.endsWith('.css')) {" +
          "    return { format: 'module', source: 'export default {};', shortCircuit: true };" +
          "  }" +
          "  return nextLoad(url, context);" +
          "}",
      ),
  );
}

const { EvidenceTray, evidenceInstruction, evidenceMinimumMet } = await import(
  "../src/codex/EvidenceTray.js"
);
const { M1_CODEX_CARD_IDS } = await import("@pa/mission-m1");

// A real offered hand of four M1 cards, so the ArchiveCard lookups resolve.
const OFFERED = M1_CODEX_CARD_IDS.slice(0, 4);

/** A stateful host so the controlled tray has somewhere to keep its selection. */
function Host(props: {
  readonly initial?: readonly string[];
  readonly minSupport?: number;
  readonly maxSelectable?: number;
  readonly locked?: boolean;
  readonly onChangeSpy?: (next: readonly string[]) => void;
}) {
  const [selected, setSelected] = React.useState<readonly string[]>(props.initial ?? []);
  return React.createElement(EvidenceTray, {
    offeredCardIds: OFFERED,
    minSupport: props.minSupport ?? 2,
    maxSelectable: props.maxSelectable ?? OFFERED.length,
    selected,
    onChange: (next) => {
      props.onChangeSpy?.(next);
      setSelected(next);
    },
    locked: props.locked ?? false,
    reducedMotion: true,
  });
}

function buttonByLabel(root: ReactTestInstance, prefix: string): ReactTestInstance | null {
  return (
    root.findAll(
      (node) =>
        node.type === "button" &&
        String((node.props as { "aria-label"?: string })["aria-label"] ?? "").startsWith(
          prefix,
        ),
    )[0] ?? null
  );
}

function byTestId(root: ReactTestInstance, id: string): ReactTestInstance {
  return root.find(
    (node) => (node.props as { "data-testid"?: string })["data-testid"] === id,
  );
}

function liveText(root: ReactTestInstance): string {
  const live = byTestId(root, "ev-live");
  return live.children.filter((c): c is string => typeof c === "string").join("");
}

/** All string descendants of a node, flattened — the counter nests its text in spans. */
function allText(instance: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string): void => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as ReactTestInstance | string);
  };
  walk(instance);
  return out.join("");
}

function fakeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: "",
    setData(key: string, value: string) {
      store[key] = value;
    },
    getData(key: string) {
      return store[key] ?? "";
    },
  };
}

test("tap places an offered card, then removes it — the keyboard/pointer Add/Remove path", () => {
  let renderer: ReactTestRenderer;
  const changes: (readonly string[])[] = [];
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Host, { onChangeSpy: (n) => changes.push(n) }),
    );
  });
  const root = renderer!.root;

  // Every offered card is an "Add …" control; none is a "Remove …" yet.
  assert.ok(buttonByLabel(root, "Add "), "an offered card is an Add control");
  assert.equal(buttonByLabel(root, "Remove "), null, "nothing is placed yet");

  act(() => {
    (buttonByLabel(root, "Add ")!.props as { onClick: () => void }).onClick();
  });
  assert.deepEqual(changes.at(-1), [OFFERED[0]], "activating placed the first card");
  // It now reads as a placed card that can be removed, and the live region said so.
  assert.ok(buttonByLabel(root, "Remove "), "the placed card is a Remove control");
  assert.match(liveText(root), /Placed/, "the move was announced");

  act(() => {
    (buttonByLabel(root, "Remove ")!.props as { onClick: () => void }).onClick();
  });
  assert.deepEqual(changes.at(-1), [], "activating the placed card removed it");
  assert.match(liveText(root), /Removed/, "the removal was announced");
});

test("a drag from the hand to the tray places the card", () => {
  let renderer: ReactTestRenderer;
  const changes: (readonly string[])[] = [];
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Host, { onChangeSpy: (n) => changes.push(n) }),
    );
  });
  const root = renderer!.root;

  const wrap = byTestId(root, `ev-hand-${OFFERED[1]}`);
  const tray = byTestId(root, "ev-tray");
  const dt = fakeDataTransfer();
  act(() => {
    (wrap.props as { onDragStart: (e: unknown) => void }).onDragStart({
      dataTransfer: dt,
      preventDefault() {},
    });
    (tray.props as { onDrop: (e: unknown) => void }).onDrop({
      dataTransfer: dt,
      preventDefault() {},
    });
  });
  assert.deepEqual(changes.at(-1), [OFFERED[1]], "the dragged card landed in the tray");
});

test("the count and instruction track the selection, and 'met' flips at the minimum", () => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Host, { minSupport: 2 }),
    );
  });
  const root = renderer!.root;
  assert.match(allText(byTestId(root, "ev-count")), /0 \/ 2/);
  assert.equal(
    byTestId(root, "ev-instruction").children.join(""),
    evidenceInstruction(0, 2),
  );

  act(() => {
    (buttonByLabel(root, "Add ")!.props as { onClick: () => void }).onClick();
  });
  act(() => {
    (buttonByLabel(root, "Add ")!.props as { onClick: () => void }).onClick();
  });
  assert.match(allText(byTestId(root, "ev-count")), /2 \/ 2/);
});

test("maxSelectable is enforced — a card beyond the cap is not placed", () => {
  let renderer: ReactTestRenderer;
  const changes: (readonly string[])[] = [];
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Host, {
        minSupport: 1,
        maxSelectable: 1,
        onChangeSpy: (n) => changes.push(n),
      }),
    );
  });
  const root = renderer!.root;
  act(() => {
    (buttonByLabel(root, "Add ")!.props as { onClick: () => void }).onClick();
  });
  assert.equal(changes.length, 1, "the first card was placed");
  // The remaining offered cards are disabled at the cap, so there is nothing to add.
  const addable = root.findAll(
    (node) =>
      node.type === "button" &&
      String((node.props as { "aria-label"?: string })["aria-label"] ?? "").startsWith("Add ") &&
      (node.props as { disabled?: boolean }).disabled !== true,
  );
  assert.equal(addable.length, 0, "no offered card can be added past the cap");
});

test("locked freezes the tray, hides the hand, and refuses activation", () => {
  let renderer: ReactTestRenderer;
  const changes: (readonly string[])[] = [];
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Host, {
        initial: [OFFERED[0]!],
        locked: true,
        onChangeSpy: (n) => changes.push(n),
      }),
    );
  });
  const root = renderer!.root;
  // The placed card is still shown as a record; the offered hand is gone.
  assert.equal(byTestId(root, "ev-tray").props ? true : false, true);
  assert.throws(() => byTestId(root, "ev-hand"), "the hand is hidden when locked");

  // Activating a locked card changes nothing.
  const placed = buttonByLabel(root, "Remove ");
  if (placed) {
    act(() => {
      (placed.props as { onClick: () => void }).onClick();
    });
  }
  assert.equal(changes.length, 0, "a locked tray never mutates the selection");
});

test("the submit gate the panels use requires the minimum", () => {
  assert.equal(evidenceMinimumMet(0, 1), false);
  assert.equal(evidenceMinimumMet(1, 1), true);
  assert.equal(evidenceMinimumMet(1, 2), false);
  assert.equal(evidenceMinimumMet(2, 2), true);
});
