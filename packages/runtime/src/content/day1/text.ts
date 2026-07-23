// Verbatim player-facing strings from docs/archive/2026-07/Localhost-Text-Slice-Spec.md §34 and docs/chapters/boston-1765/Day-1.md.
// No em dashes anywhere in in-fiction text (hard rule). Design prose is never shown.

export const TEXT = {
  b0: {
    identity: "IDENTITY SYNCHRONIZED\nBoston, 14 August 1765\nCover: runner for Mercer's Press",
    context:
      "CONTEXT\nThe war with France ended in 1763.\nBritain is deeply in debt.\nParliament is turning to the colonies for revenue.",
    source:
      'SOURCE\n"Towards further defraying the expenses of defending, protecting, and securing the British colonies and plantations in America."',
    assignment: "ASSIGNMENT\nReport to Abigail Mercer, print shop owner.",
  },
  arrival:
    "Heat. Cart wheels. Ink and paper through an open window.\nA hanging sign reads MERCER'S PRESS.",
  shopInside:
    "Inside, the press knocks against the floorboards.\nAbigail is already reaching for the next sheet.",
  enterLines: {
    KNOCK: "Door's open. In.",
    WALK_IN: "You the new runner? Good, catch.",
    LOOK_FIRST: "If you're here for work, come in.",
  },
  stampCompareBody:
    "The legal proof and the shop's plain form use the same words.\nThe new proof carries the space for the Crown's paid stamp.",
  stampFieldTag:
    "Stamp Act: an internal tax on printed and legal paper. Takes effect 1 Nov 1765.",
  assignErrands:
    "Four stops. Rider goes at the bell, don't miss him. Street's already ugly.",
  streetSources: {
    officialNotice:
      "OFFICIAL STAMP NOTICE\nDuties on newspapers and legal papers, to be in force the First of November.",
    freshBroadside:
      "FRESH BROADSIDE\nNo tax laid upon us but by our own consent, given by ourselves or by the men we choose to speak for us.\nWe have chosen no man to sit in their Parliament, yet they tax us still.",
    lateCrowdBroadside: "LATE CROWD BROADSIDE\nNo tax laid on us but by our own consent.",
  },
  thomas: {
    scene: "Thomas is pulling good cloth away from the front of his counting-house.",
    putThere: "Put the circular there.",
    learningLine: "It's not the shilling. It's the not being asked.",
    askFollowUp: "Trouble's already here. Question is who pays for it.",
    begOff: "Fine. Go. Bell won't wait for either of us.",
  },
  pike: {
    scene: "Pike lays the proof beside a deed and a court writ.",
    paperLine:
      "A tax on paper. On the very paper the law's written on. How's a man supposed to do business?",
    warLine: "London had a war to pay for. Guess who they sent the bill to.",
    reprint: "That one's on me. I'll run you a fresh copy.",
    ownIt: "That's my rush, sorry. It'll still serve.",
    brushOff: "Whole street's slammed today. It reads fine.",
    sortSetup:
      "Come November these all need the stamp, or they're worthless. Sort me the ones that'll need it.",
    sortComplete: "There. That's the work.",
  },
  clarke: {
    scene: "Clarke stands in his shop doorway as people move toward the square.",
    liberty: "Liberty, they call it.",
    challenge: "Hold a moment. What's that you're carrying?",
    calmCover: "Overruns for the rider.",
    curt: "None of your business.",
    hearOut: "What do you make of the crowd?",
    view: "This liberty is just mobs and broken windows. The Crown feeds this town.",
  },
  customHouse: {
    scene:
      "The Custom House hall smells of damp wool and ledger ink.\nThe Crown's arms hang above the clerks' counter.",
    proclamation:
      "REVENUE PROCLAMATION\nFor defraying the expenses of defending and securing the colonies, such duties and taxes are laid.",
    plainPostComplete:
      "The notice sits square on the board. A clerk pushes Abigail's subscription across the counter.",
    policyPostComplete:
      "The notice sits under Parliament's revenue column. A clerk pushes Abigail's subscription across the counter.",
  },
  customs: {
    officer1: "Hold. What's in the bag?",
    officer2:
      "Come November, printed sheets will need the Crown's stamp. Let's see what you're carrying.",
  },
  rider: {
    scene: "The rider is tying down the last bundle. The bell is close.",
    quickComplete: "The bundle changes hands before the next passer turns.",
    waitComplete: "The street opens for one breath. You pass the bundle through the gap.",
    missed: "The hitching place is empty. The handbills are still with you.",
  },
  crowd: {
    scene: "The great elm is surrounded. An effigy turns above the crowd.",
    archiveRedirect: "The crowd's gathering, let's go check it out.",
    organizer1: "Andrew Oliver! The Crown's man for the stamps!",
    organizer2: "To Fort Hill!",
    banner: "We were never asked. No stamp, no tax, but by our own consent.",
    handbillLane:
      "One of today's handbills is still folded in your coat. The words you set in type this morning.\nThe crowd opens a lane toward the effigy, and papers are already going up on it.",
    handbillPinned:
      "Your handbill hangs on the effigy with the rest. Words you printed, in the middle of all of it.",
    libertyTreeTag:
      "Liberty Tree: the elm where the crowd hung the effigy of Andrew Oliver, the stamp distributor.",
    eventNarration:
      "The men at the tree lower the effigy.\nThe crowd turns together and carries it toward Fort Hill.\nThe event is organized, aimed at the stamp distributor, and already beyond anything the runner can start or stop.",
    eventNarration2:
      "On Kilby Street they pull down a small building the crowd says is Oliver's stamp office.\nIts timbers feed the bonfire on Fort Hill. The effigy is beheaded and burned.\nLater, stones sound against the windows of Oliver's own house.",
    eventAftermath:
      "By morning the word is already moving: Andrew Oliver will resign the stamp post.\nNobody in this crowd waited for permission. Somebody planned every step of it.",
  },
  shopsClosed:
    "That's it. Light's gone, shops are shuttering. Whatever's not done is done.",
  archiveSynthesis:
    "Cost, the paper, the war to pay for it. But something's got them angrier than a fee. Hold that.",
  return: {
    allComplete:
      "All of it. The rider, Pike, the Custom House, the notice posted. You ran it clean. You'll do.",
    riderOnly: "The rider left without the bundle. That was needed.",
    pikeOnly: "Pike never got his proof. That was paid work.",
    thomasOnly: "Thomas never got the circular. He was waiting.",
    customHouseOnly: "The notice never reached the Custom House.",
    multiple: "More than one stop went unfinished. I needed the whole run.",
  },
  deficit: {
    policySource:
      "The war had left Britain with heavier debt. Parliament sought revenue from the colonies.",
    policyLine: "London came out of the war owing money. Parliament meant the colonies to help pay.",
    stampSource:
      "Court deeds, writs, and printed newspapers require paid stamped paper. A private handwritten letter and a wooden tool do not.",
    stampLine: "My fee pays for ink and labor. The Crown's stamp is a tax laid on the covered paper.",
    repSource:
      "No tax should be laid without consent given by the people or by representatives they elect.",
    repLine: "Boston elects nobody to Parliament. That's the voice the broadside says is missing.",
    policyRetrySource:
      "The cost of defending the colonies followed the war. Parliament looked to colonial revenue.",
    stampRetrySource:
      "Covered printed and legal papers require the paid stamp beginning the First of November.",
    repRetrySource:
      "The colony has its own elected assembly, but sends no elected member to Parliament.",
  },
  headline: {
    frame: "You saw what happened at the elm. So set it. What's tomorrow's front page?",
    causeFrame:
      "Good. Now the line under it. A good story says why, not just what happened. Why did London lay this on us in the first place?",
    evidenceFrame:
      "Now pin the proof beside it, so no one calls us liars. Which of these is the sort of document the Crown's stamp has to go on?",
    finalPull: "You lock the type, ink it, lay down the sheet, and pull.",
    finalPage:
      "TAXED WITHOUT A VOICE\nBy order of Parliament, to raise revenue after the war.\nSource: a court deed.",
  },
  abigailEnd:
    "Don't file that away in a drawer. Take it to the town board yourself, let the street read what it did today. Then rest. Be here early.",
  streetEnding: {
    scene:
      "The street holds the last of the light.\nThe town crier is already at the board, filling his lungs.",
    posted:
      "Your page hangs square on the town board, paste still wet.\nPeople slow as they pass. One reads the headline aloud to another.",
    passerby: "That's the plain truth of it, and about time someone set it in type.",
  },
  dayRecordHeader: "Day one, printed, posted, and shouted down the street. You held together better than most first days.",
  ambient: {
    PRINTER_PAPER: { speaker: "NARRATOR", text: 'Printer: "Paper costs enough before Parliament puts its mark on it."' },
    MERCHANT_NOTICE: { speaker: "NARRATOR", text: 'Merchant: "Another notice. Always another notice."' },
    DOCK_WAR_BILL: { speaker: "NARRATOR", text: 'Dock worker: "London fights the war, then sends us the bill."' },
    SHOPKEEPER_CROWD: { speaker: "NARRATOR", text: 'Shopkeeper: "Shutters first. Arguments after."' },
    OLIVER_RUMOR: { speaker: "NARRATOR", text: 'Passerby: "They\'ve got Oliver hanging from the elm, or something made to look like him."' },
    BELL_WARNING: { speaker: "NARRATOR", text: 'Carter: "Bell\'s close. Finish what you\'re carrying."' },
  },
  clockWarnings: {
    FIRST: "Morning's getting on. Keep moving.",
    SECOND: "Half the day's spent. The bell won't wait.",
    FINAL: "Light's going. Whatever's left, decide now.",
  },
} as const;
