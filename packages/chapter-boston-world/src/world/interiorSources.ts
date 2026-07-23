export type HistoricalClaimType = "DOCUMENTED" | "REPRESENTATIVE" | "INFERENCE";

export interface HistoricalSource {
  id: string;
  label: string;
  organization: string;
  url: string;
  note: string;
}

export const INTERIOR_SOURCES: Record<string, HistoricalSource> = {
  CW_PRINTER: {
    id: "CW_PRINTER",
    label: "The Printer in Eighteenth-Century Williamsburg",
    organization: "Colonial Williamsburg",
    url: "https://www.gutenberg.org/files/59101/59101-h/59101-h.htm",
    note: "Common presses, composing cases, ink balls, imposing work, and overhead drying.",
  },
  CW_TRADES: {
    id: "CW_TRADES",
    label: "Historic Trades and Skills",
    organization: "Colonial Williamsburg",
    url: "https://www.colonialwilliamsburg.org/discover/historic-area/historic-trades-skills/",
    note: "Period hand tools, apprenticeship, and working-shop organization.",
  },
  NPS_COUNTINGHOUSE: {
    id: "NPS_COUNTINGHOUSE",
    label: "Archaeology of the Derby Counting House",
    organization: "National Park Service, Salem Maritime",
    url: "https://www.nps.gov/sama/learn/historyculture/countinghousehistory.htm",
    note: "Merchant ledgers, correspondence, clerks, simple furniture, and warehouse adjacency.",
  },
  CSM_MERCHANT_DESK: {
    id: "CSM_MERCHANT_DESK",
    label: "The Merchants’ Real Friend and Companion",
    organization: "Colonial Society of Massachusetts",
    url: "https://www.colonialsociety.org/node/3308",
    note: "Counting-house desks, daybooks, pigeonholes, and business record keeping.",
  },
  HARVARD_BOMBE: {
    id: "HARVARD_BOMBE",
    label: "Bombé Secretary Desk, c. 1760",
    organization: "Harvard Art Museums",
    url: "https://harvardartmuseums.org/collections/object/232203",
    note: "Boston merchant storage for ledgers, ship logs, maps, money, and writing tools.",
  },
  NPS_OLD_SOUTH: {
    id: "NPS_OLD_SOUTH",
    label: "Old South Meeting House National Register documentation",
    organization: "National Park Service",
    url: "http://npshistory.com/publications/bost/nr-old-s-meeting-house.pdf",
    note: "Box pews, high pulpit and sounding board, central aisle, and three-sided galleries.",
  },
  BOSTON_OLD_SOUTH: {
    id: "BOSTON_OLD_SOUTH",
    label: "Old South Meeting House Study Report",
    organization: "City of Boston",
    url: "https://www.boston.gov/sites/default/files/file/2025/05/Old%20South%20Meeting%20House%20Study%20Report.pdf",
    note: "1729 room arrangement and documented distinction between original box pews and later slip pews.",
  },
  PAUL_REVERE_HOUSE: {
    id: "PAUL_REVERE_HOUSE",
    label: "Paul Revere House interpretive panels",
    organization: "Paul Revere Memorial Association",
    url: "https://www.paulreverehouse.org/wp-content/uploads/2023/10/PRMA-HousePanelsforWeb_1010.pdf",
    note: "Multifunctional Boston rooms, bare floors, storage, textiles, and household work.",
  },
  NPS_REVERE_HFR: {
    id: "NPS_REVERE_HFR",
    label: "Paul Revere House Historic Furnishings Report",
    organization: "National Park Service",
    url: "https://npshistory.com/publications/bost/hfr-paul-revere-house.pdf",
    note: "Open shelves, efficient hearth clearances, storage, and limits of museum-style staging.",
  },
  BUNCH_OF_GRAPES: {
    id: "BUNCH_OF_GRAPES",
    label: "The Old Bunch of Grapes Tavern",
    organization: "Contemporary-inventory historical synthesis",
    url: "https://www.theatlantic.com/magazine/archive/1889/12/the-old-bunch-of-grapes-tavern/633529/",
    note: "Representative Boston tavern hall, taproom, tables, benches, shelves, and service rooms.",
  },
  CUSTOMS_CONTEXT: {
    id: "CUSTOMS_CONTEXT",
    label: "Day 1 Custom House source and setting ledger",
    organization: "Project Archive historical content",
    url: "docs/chapters/boston-1765/Day-1.md",
    note: "Public posting, Crown revenue policy, clerks, counters, ledgers, and official notices.",
  },
};

