import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";
import { ModuleCheckPanel } from "../src/module/ModuleCheckPanel.js";
import type { ModuleCheck } from "../src/module/moduleFormat.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The mastery check must: withhold Continue until the correct answer, show an
// option's own misconception feedback on a wrong answer, allow revision without
// cost, and on the correct answer reinforce, mark mastered and link feedback for
// a screen reader. A multiple-select adds one rule: the EXACT correct set is
// required — no missing correct choice, no selected distractor — and it is
// never auto-submitted on a click.

const CHECK: ModuleCheck = {
  id: "BOS.TEST.CHECK.v1",
  prompt: "Why did Parliament seek colonial revenue?",
  reinforcement: "The war left the debt; the colonies were told to share the cost.",
  conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  options: [
    { id: "OPT.A", text: "War debt and defence costs.", correct: true, feedback: "Right — debt came first." },
    { id: "OPT.B", text: "The tax caused the debt.", correct: false, feedback: "Reversed: the debt came first." },
    { id: "OPT.C", text: "Goods became Crown property.", correct: false, feedback: "No: nothing was seized." },
  ],
};

const MULTI: ModuleCheck = {
  id: "BOS.TEST.MULTI.v1",
  prompt: "Which are true about the Stamp Act?",
  selection: "multiple",
  reinforcement: "It taxed printed and legal paper and hit printers hardest.",
  options: [
    { id: "OPT.PAPER", text: "It taxed printed and legal paper.", correct: true, feedback: "Yes: printed and legal paper." },
    { id: "OPT.GOODS", text: "It taxed cloth and nails.", correct: false, feedback: "No: ordinary goods stay outside." },
    { id: "OPT.DATE", text: "It began on the first of November.", correct: true, feedback: "Yes: the first of November." },
    { id: "OPT.PRINTERS", text: "It fell hardest on printers.", correct: true, feedback: "Yes: their whole trade is paper." },
    { id: "OPT.LETTER", text: "A handwritten letter needed a stamp.", correct: false, feedback: "No: being paper is not the test." },
  ],
};

function inputs(root: ReactTestInstance, type: "radio" | "checkbox"): ReactTestInstance[] {
  return root.findAll(
    (node) => node.type === "input" && (node.props as { type?: string }).type === type,
  );
}
const radios = (root: ReactTestInstance) => inputs(root, "radio");
const checkboxes = (root: ReactTestInstance) => inputs(root, "checkbox");
function submit(root: ReactTestInstance): ReactTestInstance | null {
  return root.findAll(
    (node) => node.type === "button" && String((node.props as { className?: string }).className).includes("mod-check-submit"),
  )[0] ?? null;
}
function text(root: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as ReactTestInstance | string);
  };
  walk(root);
  return out.join(" ");
}
const choose = (input: ReactTestInstance) => (input.props as { onChange: () => void }).onChange();
const press = (button: ReactTestInstance) => (button.props as { onClick: () => void }).onClick();

test("a wrong answer shows its own feedback, retries, and does not master", () => {
  let mastered = 0;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ModuleCheckPanel, {
        check: CHECK,
        active: true,
        mastered: false,
        reducedMotion: false,
        onMastered: () => {
          mastered += 1;
        },
      }),
    );
  });
  const root = renderer.root;

  // Continue/submit is disabled until an option is chosen.
  assert.equal((submit(root)!.props as { disabled?: boolean }).disabled, true);

  // Choose the wrong option and submit.
  act(() => choose(radios(root)[1]!));
  act(() => press(submit(root)!));

  // The wrong option's misconception feedback is shown; mastery did not fire.
  assert.match(text(root), /Reversed: the debt came first/);
  assert.equal(mastered, 0);
  // Feedback is linked to the option for a screen reader, per option id.
  const feedbackId = `${CHECK.id}-fb-OPT.B`;
  assert.equal((radios(root)[1]!.props as { "aria-describedby"?: string })["aria-describedby"], feedbackId);
  // Retry is offered and inputs stay enabled (the check is not cleared).
  assert.match(text(submit(root)!), /Try again/);
  assert.equal((radios(root)[0]!.props as { disabled?: boolean }).disabled, false);

  // Now answer correctly.
  act(() => choose(radios(root)[0]!));
  act(() => press(submit(root)!));
  assert.equal(mastered, 1, "the correct answer masters the check once");
  assert.match(text(root), /The war left the debt/); // reinforcement shown
  // Inputs are now disabled: the check is settled for this run.
  assert.equal((radios(root)[0]!.props as { disabled?: boolean }).disabled, true);

  act(() => renderer.unmount());
});

test("an already-mastered check renders settled and needs no re-answer", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ModuleCheckPanel, {
        check: CHECK,
        active: false,
        mastered: true,
        reducedMotion: false,
        onMastered: () => {},
      }),
    );
  });
  const root = renderer.root;
  // Reinforcement is shown and there is no submit button to re-answer.
  assert.match(text(root), /The war left the debt/);
  assert.equal(submit(root), null);
  assert.equal((radios(root)[0]!.props as { disabled?: boolean }).disabled, true);
  act(() => renderer.unmount());
});

// ---------------------------------------------------------------------------
// Multiple-select
// ---------------------------------------------------------------------------

test("a multiple-select renders checkboxes, an instruction, and does not auto-submit", () => {
  let mastered = 0;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ModuleCheckPanel, {
        check: MULTI,
        active: true,
        mastered: false,
        reducedMotion: false,
        onMastered: () => {
          mastered += 1;
        },
      }),
    );
  });
  const root = renderer.root;

  // Checkboxes, not radios, and the "select all that apply" instruction.
  assert.equal(checkboxes(root).length, 5);
  assert.equal(radios(root).length, 0);
  assert.match(text(root), /Select all that apply/i);

  // Choosing an option only stages it: no feedback yet, no mastery, submit stays.
  act(() => choose(checkboxes(root)[0]!));
  assert.equal(mastered, 0, "a click never auto-submits");
  assert.doesNotMatch(text(root), /Yes: printed and legal paper/); // feedback not revealed
  assert.equal((submit(root)!.props as { disabled?: boolean }).disabled, false);

  act(() => renderer.unmount());
});

test("a partial correct set is refused; an extra distractor is refused; the exact set is accepted once", () => {
  let mastered = 0;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ModuleCheckPanel, {
        check: MULTI,
        active: true,
        mastered: false,
        reducedMotion: false,
        onMastered: () => {
          mastered += 1;
        },
      }),
    );
  });
  const root = renderer.root;
  const box = (id: string) =>
    checkboxes(root).find((node) => (node.props as { value?: string }).value === id)!;

  // Partial: only two of the three correct choices. Refused, and it nudges.
  act(() => choose(box("OPT.PAPER")));
  act(() => choose(box("OPT.DATE")));
  act(() => press(submit(root)!));
  assert.equal(mastered, 0, "a missing correct choice is not mastery");
  assert.match(text(root), /still\s+unchecked/i);

  // Add the last correct AND a distractor: the distractor's feedback shows and
  // it is refused. The learner may revise without cost.
  act(() => choose(box("OPT.PRINTERS")));
  act(() => choose(box("OPT.GOODS")));
  act(() => press(submit(root)!));
  assert.equal(mastered, 0, "a selected distractor is not mastery");
  assert.match(text(root), /ordinary goods stay outside/i);

  // Drop the distractor: now the exact correct set. Accepted, once.
  act(() => choose(box("OPT.GOODS")));
  act(() => press(submit(root)!));
  assert.equal(mastered, 1, "the exact correct set masters the check exactly once");
  assert.match(text(root), /hit printers hardest/); // reinforcement
  assert.equal((checkboxes(root)[0]!.props as { disabled?: boolean }).disabled, true);

  act(() => renderer.unmount());
});
