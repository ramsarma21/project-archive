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
// the SPEAKER — a Crown constable, or a wage-earning dockhand — would credit.
// `needs: 1` over a family of ideas is how multiple valid perspectives all pass:
// any one Crown-credible rationale, or any one honest line from the Act to the
// ropewalk's livelihood, is enough.

import { compilePool, ItemBank, type AuthoredPool } from "../rubric.js";

const SHAMBLES_WRONG = [
  "gives only a personal opinion that the tax is unfair or tyrannical, rather than a reason a Crown officer would credit",
  "merely refuses, insults, or repeats a protest slogan with no justification",
  "names the wrong tax or a later event (the tea tax, molasses, the Massacre) instead of the war debt or Parliament's authority",
] as const;

const ROPEWALK_WRONG = [
  "argues rights or representation in the abstract without connecting the Act to his trade, wages, clearances or contracts",
  "denies that the stamped paper affects the port's work at all",
  "names the wrong tax or the wrong goods (tea, molasses, sugar) instead of stamped legal, printed or shipping papers",
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
 * B — the ropewalk's night man, loyal to his wage. The accepted family connects
 * the Stamp Act's scope, cost or disruption to HIS trade: clearances, bills of
 * lading, contracts, printed and legal papers, cargo, prices, wages.
 */
const ROPEWALK_POOL: AuthoredPool = {
  poolId: "BOS.MD01.POOL.ENC_ROPEWALK.v1",
  conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
  idPrefix: "BOS.MD01.ENC.ROPEWALK",
  idSuffix: ".v1",
  items: [
    {
      id: "WHY_CARE",
      ask: "You're the effigy lot, aren't you. Tell me straight, why should a man who lays rope for a living care a damn about a stamp on a bit of paper? Make it my business.",
      correct:
        "The stamp falls on the ship's clearances, bills of lading and contracts the whole port runs on, so if that paper is refused the cargoes cannot clear, the ships do not sail, the rope is not ordered, and his wage stops.",
      ideas: [
        "the stamp tax falls on the ship's papers, clearances, contracts and bills a working port runs on, so it disrupts the trade that pays his wage",
        "if the stamped paper is refused or dearer, cargoes cannot legally clear and the work and the pay stop or shrink",
      ],
      needs: 1,
      wrongIfSays: [...ROPEWALK_WRONG],
      accept: [
        "Because no stamped clearance means the ships can't sail legal, and no ships means no rope orders and no wage for you.",
        "It taxes the papers every cargo needs, so it slows the whole port down and that's your work drying up.",
        "Every contract and cargo bill has to carry that stamp now — gum up the papers and you gum up the trade you live off.",
      ],
      reject: [
        "Because taxation without representation is tyranny and every Englishman should resist it.",
        "Because it's the principle of the thing, plain and simple.",
        "Because of the duty on molasses that the smugglers all hate.",
      ],
      note: "Any honest line from the Act to his livelihood passes; a rights lecture that never reaches the docks does not.",
    },
    {
      id: "WHAT_STOPS",
      ask: "Say the stamp comes in and I don't buy it. What of it stops — here, in this walk, on these ships? Name me the thing it actually costs me.",
      correct:
        "Without the stamp a ship's clearance and bills of lading are not legal, so the cargo cannot clear the customs house and the shipping halts — and every contract and paper the wharf's business runs on costs more, which squeezes the work and the wage.",
      ideas: [
        "without the stamp a ship's clearance papers and bills of lading are not legal, so cargo cannot clear the customs house and shipping halts",
        "the stamp raises the cost of the legal and printed papers the port's business depends on, squeezing contracts, prices and wages",
      ],
      needs: 1,
      wrongIfSays: [...ROPEWALK_WRONG],
      accept: [
        "The clearances stop — a ship can't leave the customs house without stamped papers, so the cargo sits and nobody's paid.",
        "Your contracts and cargo papers all need the stamp, so the price of doing any business here climbs and the work slows.",
        "No stamp, no legal bill of lading, no sailing — the whole wharf just stops until it's sorted.",
      ],
      reject: [
        "It costs us our liberty, that's what.",
        "Nothing really — it's just Boston being dramatic about a small tax.",
        "It's a tax on your tea and your sugar, that's the cost.",
      ],
      note: "A concrete trade consequence — halted clearances, dearer papers, stalled cargo — is required.",
    },
    {
      id: "WHOSE_TROUBLE",
      ask: "Papers and pamphlets — that's the merchants' quarrel and the lawyers', not mine. What has any of that got to do with the rope I sell and the wage I take home?",
      correct:
        "The stamped papers ARE the port's business — the clearances, bills of lading and contracts a cargo cannot move without — so a tax on those papers stalls the shipping that orders his rope and pays his wage; the merchants' and lawyers' paper is the same paper the wharf runs on.",
      ideas: [
        "the stamp on legal, printed and commercial papers is exactly what the port's shipping and contracts run on, so a paper tax lands directly on his trade and his wage",
      ],
      needs: 1,
      wrongIfSays: [...ROPEWALK_WRONG],
      accept: [
        "Because those papers ARE your trade — clearances, contracts and cargo bills all carry the stamp, and if they're stalled your rope goes nowhere and neither does your pay.",
        "The lawyers' papers and the shipping papers are the same paper the wharf runs on; tax them and the work you do dries up.",
        "Merchants can't move a cargo without stamped papers, and no cargo means no orders for rope and no wage coming home.",
      ],
      reject: [
        "It's about no taxation without representation — that's why it matters to everyone.",
        "It doesn't, really, that's rather why I'm asking you.",
        "Because the tax they put on tea is unfair to all of us.",
      ],
      note: "The one required idea is that the taxed papers are the port's own working papers, so the tax reaches his wage.",
    },
  ],
};

export const M1_ENCOUNTER_POOLS: readonly AuthoredPool[] = [
  SHAMBLES_POOL,
  ROPEWALK_POOL,
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
