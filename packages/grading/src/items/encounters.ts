// M1's perspective-encounter bank — the SERVER-ONLY half.
//
// These are the rubrics for the two route encounters whose client-safe
// projection lives in @pa/mission-m1's encounters/bank.ts. They are authored
// HERE, in the grading package, for the same reason the duel rubrics live in
// content/m1: this package runs only under node and is never bundled into the
// browser, so a reference answer, a required idea and an accept/reject bank
// cannot leak to a client that would use them to grade itself.
//
// The itemIds and prompts are the join with the client bank, and they must match
// it exactly — the drift test in apps/api asserts every id here has a client
// projection and every `ask` equals the client prompt. Change a prompt in one
// place and the drift test fails until the other agrees.
//
// THE RUBRIC SHAPE IS THE PROJECT'S EXISTING ONE. These compile through the same
// `compilePool` the duel bank does, so the same classifier, the same held-out
// accept/reject eval set, and the same binary `needs` line apply. What is
// different is the JUDGING FRAME, and it is carried in the ideas and the
// reference answer: a correct answer is not the "true fact" but a justification
// the SPEAKER — a Crown constable, or a wage-earning printer's bill-sticker —
// would credit. `needs: 1` over a family of ideas is how multiple valid
// perspectives all pass: any one Crown-credible rationale, or any one honest line
// from the Act's reach to the bill-sticker's livelihood, is enough.

import { compilePool, ItemBank, type AuthoredPool } from "../rubric.js";

const SHAMBLES_WRONG = [
  "gives only a personal opinion that the tax is unfair or tyrannical, rather than a reason a Crown officer would credit",
  "merely refuses, insults, or repeats a protest slogan with no justification",
  "names the wrong tax or a later event (the tea tax, molasses, the Massacre) instead of the war debt or Parliament's authority",
] as const;

const BILLMAN_WRONG = [
  "argues rights or representation in the abstract without connecting the Act to his trade, the printed paper, the presses or his wage",
  "denies that a tax on paper touches the printing his living depends on",
  "names the wrong tax or the wrong goods (tea, molasses, sugar) instead of stamped printed or legal papers",
] as const;

/**
 * A — the market-watch constable, Crown and Parliament. The accepted family is
 * the Crown's own case argued in the player's words: Parliament's sovereign
 * authority (virtual representation) and/or the colonies sharing the debt of a
 * war fought to defend them.
 */
const SHAMBLES_POOL: AuthoredPool = {
  poolId: "BOS.MD01.POOL.ENC_SHAMBLES.v1",
  conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  idPrefix: "BOS.MD01.ENC.SHAMBLES",
  idSuffix: ".v1",
  items: [
    {
      id: "WHY_PAY",
      ask: "Halt there. The war's won, the French are out of Canada, and still London wants its new duties paid. Give me one reason a King's man would credit for Boston to pay them — not a mob's slogan.",
      correct:
        "Britain went deep into debt in the recent war to drive the French from North America and defend the colonies; Parliament, which holds authority over the whole empire, is laying these duties so the colonies help pay that shared cost.",
      ideas: [
        "Parliament holds sovereign authority over the colonies and may lawfully tax them, the colonies being represented virtually even without members elected from Boston",
        "Britain took on a great debt from a war fought to defend the colonies, and the colonies should help pay it down",
        "the colonies benefited from British and imperial defence and should share the cost of the empire's protection",
      ],
      needs: 1,
      wrongIfSays: [...SHAMBLES_WRONG],
      accept: [
        "Because Britain ran up a huge debt beating the French to protect the colonies, and the colonies ought to help pay it off.",
        "Parliament rules the whole empire, so it can tax us the same as anyone, and the late war was fought for our safety.",
        "We got the French pushed out of Canada by the King's army, so it's only fair the colonies pay a share of what that cost.",
      ],
      reject: [
        "Taxes are theft and no free man should ever pay them.",
        "The Sons of Liberty say the tax is tyranny, so it is.",
        "Because of the unfair duty they put on our tea.",
      ],
      note: "The constable will credit any one Crown-side rationale, plausibly stated. He rejects opinion, slogan, and the wrong tax.",
    },
    {
      id: "WHO_DEFENDED",
      ask: "You'll not pass shouting 'no taxes' at me. Who do you think held the frontier while you slept safe in Boston these ten years — and who should help pay for it? Answer plainly.",
      correct:
        "The King's own army and navy held the frontier and won the war that protected the colonies, so it is reasonable that the colonies help pay the debt that war left.",
      ideas: [
        "the British army and Crown defended the colonies and the frontier during the recent war",
        "the colonies should help pay the debt left by the war that protected them",
      ],
      needs: 1,
      wrongIfSays: [...SHAMBLES_WRONG],
      accept: [
        "The King's redcoats and the navy held the frontier, so Boston helping pay the war's bill is only right.",
        "Britain fought and paid for the war that kept us safe from the French, and now the colonies should carry some of that debt.",
        "The army defended us out west, and a debt that big has to be shared — the colonies included.",
      ],
      reject: [
        "The militia did it all themselves and Britain did nothing for us.",
        "Nobody has the right to tax us for anything, ever.",
        "It's really about the stamp on our playing cards being an outrage.",
      ],
      note: "Either the defender fact or the shared-debt clause, credibly given, is enough.",
    },
    {
      id: "BY_WHAT_RIGHT",
      ask: "By what right, then, does Parliament lay a tax on Boston at all? Tell me the King's own answer to that, and I'll let you by.",
      correct:
        "By the sovereign authority of Parliament, which the Crown holds represents and legislates for the whole empire — the colonies included — so that colonists are represented virtually even with no members elected from Boston.",
      ideas: [
        "Parliament holds sovereign legislative authority over the colonies and may tax them, the colonies being represented virtually rather than by members they elect",
      ],
      needs: 1,
      wrongIfSays: [...SHAMBLES_WRONG],
      accept: [
        "By Parliament's authority over the whole empire — it speaks for the colonies too, even if we send no members to it.",
        "The King holds that Parliament represents every subject virtually, so it may lawfully tax Boston like anywhere else.",
        "Because Parliament is sovereign over the colonies and its acts bind us whether we elected anyone to it or not.",
      ],
      reject: [
        "It has no right at all, that's the whole point.",
        "By force, and force is not right.",
        "The right ended when they taxed the tea.",
      ],
      note: "The one required idea is Parliament's sovereign authority / virtual representation, stated as a justification.",
    },
  ],
};

/**
 * B — the printer's bill-sticker, loyal to his wage. Re-cast from the ropewalk's
 * night man when the mandatory beat moved off the ropewalk detour and onto the
 * direct roofline over Hollis Meeting; the pool id, item ids and concept are the
 * durable join and are unchanged. The accepted family connects the Stamp Act's
 * scope, cost or disruption to HIS trade: the printed paper the whole trade is —
 * newspapers, handbills, notices — is exactly what the Act taxes, so a bought
 * stamp on every sheet means fewer runs, fewer bills to paste, dearer paper, and
 * a shrinking wage. A rights lecture that never reaches the presses does not pass.
 */
const BILLMAN_POOL: AuthoredPool = {
  poolId: "BOS.MD01.POOL.ENC_ROPEWALK.v1",
  conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
  idPrefix: "BOS.MD01.ENC.ROPEWALK",
  idSuffix: ".v1",
  items: [
    {
      id: "WHY_CARE",
      ask: "You're the effigy lot, aren't you. Tell me straight, why should a man who pastes bills for his bread care a damn about a stamp on a bit of paper? Make it my business.",
      correct:
        "The stamp falls on the printed paper his whole trade is — the newspapers, handbills and notices — so if the printers must buy a stamp for every sheet they run less, there are fewer bills to paste, and his wage stops.",
      ideas: [
        "the stamp tax falls on the printed paper — newspapers, handbills, notices — that a printer's whole trade is, so it lands directly on the work that pays him",
        "if every sheet must carry a bought stamp the presses print less or stop, so there is less bill-work and his pay shrinks or ends",
      ],
      needs: 1,
      wrongIfSays: [...BILLMAN_WRONG],
      accept: [
        "Because every sheet the printers run now needs a paid stamp, so they print less, and less printing means no bills for me to paste and no wage.",
        "The tax is on printed paper itself, and papers and handbills are my whole living, so it comes straight out of my trade and not somebody else's.",
        "Gum up the presses with a stamp on every sheet and the work you live off, the bills, just dries up.",
      ],
      reject: [
        "Because taxation without representation is tyranny and every Englishman should resist it.",
        "Because it's the principle of the thing, plain and simple.",
        "Because of the duty on molasses that the smugglers all hate.",
      ],
      note: "Any honest line from the Act to his printed-paper trade passes; a rights lecture that never reaches the presses does not.",
    },
    {
      id: "WHAT_STOPS",
      ask: "Say the stamp comes in and the printers won't buy it. What of it stops — here, on this wall, in the sheets I hang? Name me the thing it actually costs me.",
      correct:
        "Without a bought stamp on every sheet no newspaper, handbill or notice is lawful to print, so the printers cut their runs or stop and the bills he pastes stop coming — and every printed and legal paper the town's business runs on costs more, which squeezes the work and the wage.",
      ideas: [
        "without a paid stamp the printed papers, the newspapers and handbills and notices, are not lawful, so the presses cut back or stop and the bill-work stops",
        "the stamp raises the cost of the printed and legal papers the town's business depends on, squeezing the printing, the trade and his wage",
      ],
      needs: 1,
      wrongIfSays: [...BILLMAN_WRONG],
      accept: [
        "The printing stops — no sheet is lawful without a bought stamp, so the presses cut their runs and there are no bills to hang.",
        "Every notice, paper and handbill needs the stamp now, so the cost of printing anything climbs and the work slows.",
        "No stamp, no lawful sheet, no run — the printers just stop until it's sorted and I'm not paid.",
      ],
      reject: [
        "It costs us our liberty, that's what.",
        "Nothing really — it's just Boston being dramatic about a small tax.",
        "It's a tax on your tea and your sugar, that's the cost.",
      ],
      note: "A concrete trade consequence — cut print runs, dearer sheets, no bills to paste — is required.",
    },
    {
      id: "WHOSE_TROUBLE",
      ask: "Deeds and lawyers' writs — that's the merchants' quarrel and the courts', not mine. What has a tax on their paper got to do with the bills I paste and the wage I take home?",
      correct:
        "The stamp is laid on printed paper as much as legal paper — the newspapers, handbills and notices are taxed exactly as the deeds and writs are — so the same Act that hits the lawyers' paper hits the sheets he pastes; the courts' and merchants' paper is the same kind of paper his living is.",
      ideas: [
        "the stamp falls on printed paper, the newspapers and handbills and notices, just as it falls on the legal papers, so a paper tax lands directly on his trade and his wage and not only on the courts and merchants",
      ],
      needs: 1,
      wrongIfSays: [...BILLMAN_WRONG],
      accept: [
        "Because it isn't only the deeds, the newspapers and handbills carry the stamp too, and those printed sheets ARE my trade, so if they stall my paste-work goes nowhere.",
        "The lawyers' writs and the printers' sheets are taxed the same way; a tax on paper is a tax on the very bills I hang.",
        "Printed paper is stamped right alongside the legal paper, so the presses I depend on stop, and no printing means no bills and no wage.",
      ],
      reject: [
        "It's about no taxation without representation — that's why it matters to everyone.",
        "It doesn't, really, that's rather why I'm asking you.",
        "Because the tax they put on tea is unfair to all of us.",
      ],
      note: "The one required idea is that printed paper is stamped alongside the legal paper, so the tax reaches the sheets he pastes and thus his wage.",
    },
  ],
};

export const M1_ENCOUNTER_POOLS: readonly AuthoredPool[] = [
  SHAMBLES_POOL,
  BILLMAN_POOL,
];

let cachedBank: ItemBank | null = null;

/** The compiled M1 encounter bank: two pools, three items each, six items. */
export function m1EncounterBank(): ItemBank {
  cachedBank ??= new ItemBank(M1_ENCOUNTER_POOLS.map(compilePool));
  return cachedBank;
}

/** Test hook. */
export function resetM1EncounterBankCache(): void {
  cachedBank = null;
}
