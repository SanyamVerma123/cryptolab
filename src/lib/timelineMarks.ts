/**
 * timelineMarks.ts — Native Vela Timeline Marks Integration
 *
 * Implements `/vela/user/timeline-marks`:
 * 1. Defines Groups on `chart.marks`:
 *    - 'news'      → "News & Catalysts"
 *    - 'economic'  → "Macro & Economic"
 *    - 'releases'  → "Protocol & Network"
 *    - 'trades'    → "Journal Trades"
 * 2. Curates Symbol Catalysts & Milestones (BTC, ETH, SOL, NVDA, AAPL, etc.)
 * 3. Dynamically syncs Journal trades onto the chart lane as interactive pins with detail popups.
 */

import type { TimelineMark, MarkGroup } from "@luxalgo/vela";
import { getJournalEntries, JournalEntry } from "./journalState";

export const TIMELINE_GROUPS: MarkGroup[] = [
  { id: "news", label: "News & Catalysts", visible: true },
  { id: "economic", label: "Macro & Economic", visible: true },
  { id: "releases", label: "Protocol & Network", visible: true },
  { id: "trades", label: "Journal Trades", visible: true },
];

/** Predefined market milestones and catalysts */
function getSymbolCatalysts(rawSymbol: string): TimelineMark[] {
  const sym = (rawSymbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isBtc = sym.includes("BTC");
  const isEth = sym.includes("ETH");
  const isSol = sym.includes("SOL");
  const isNvda = sym.includes("NVDA");
  const isAapl = sym.includes("AAPL");
  const isTsla = sym.includes("TSLA");

  const marks: TimelineMark[] = [];

  // Universal Macro / Economic Events
  marks.push(
    {
      id: "macro-fomc-sep-2024",
      time: Date.UTC(2024, 8, 18, 18, 0),
      title: "FOMC Rate Cut (50 bps)",
      group: "economic",
      glyph: { shape: "diamond", color: "#2962ff", letter: "F" },
      tooltip: "Federal Reserve pivots — cuts rates by 50 bps",
      content: {
        panel: {
          items: [
            { type: "field", label: "Event", value: "Federal Open Market Committee" },
            { type: "field", label: "Action", value: "Rate Cut -50 bps (4.75% - 5.00%)" },
            { type: "field", label: "Significance", value: "First US interest rate reduction since March 2020" },
            { type: "text", text: "Fed Chair Powell highlighted confidence in inflation moving sustainably toward 2%." },
          ],
        },
      },
    },
    {
      id: "macro-fomc-nov-2024",
      time: Date.UTC(2024, 10, 7, 19, 0),
      title: "FOMC Rate Cut (25 bps)",
      group: "economic",
      glyph: { shape: "diamond", color: "#2962ff", letter: "F" },
      tooltip: "FOMC cuts target rate by 25 bps to 4.50%-4.75%",
      content: {
        panel: {
          items: [
            { type: "field", label: "Event", value: "FOMC Policy Decision" },
            { type: "field", label: "Action", value: "Rate Cut -25 bps" },
            { type: "field", label: "Target Range", value: "4.50% - 4.75%" },
            { type: "text", text: "Labor market conditions eased modestly while inflation progressed towards target." },
          ],
        },
      },
    },
    {
      id: "macro-fomc-dec-2024",
      time: Date.UTC(2024, 11, 18, 19, 0),
      title: "FOMC Rate Decision (25 bps Cut)",
      group: "economic",
      glyph: { shape: "diamond", color: "#2962ff", letter: "F" },
      tooltip: "FOMC lowers rate target by 25 bps to 4.25%-4.50%",
      content: {
        panel: {
          items: [
            { type: "field", label: "Policy", value: "Year-End Rate Reduction" },
            { type: "field", label: "New Rate", value: "4.25% - 4.50%" },
            { type: "text", text: "Summary of Economic Projections updated with gradual trajectory for 2025." },
          ],
        },
      },
    },
    {
      id: "macro-cpi-oct-2024",
      time: Date.UTC(2024, 10, 13, 13, 30),
      title: "US CPI Release (2.6% YoY)",
      group: "economic",
      glyph: { shape: "circle", color: "#f57c00", letter: "C" },
      tooltip: "October CPI: 2.6% YoY (in line with forecast)",
      content: {
        panel: {
          items: [
            { type: "field", label: "Headline CPI", value: "2.6% YoY (Prev: 2.4%)" },
            { type: "field", label: "Core CPI", value: "3.3% YoY (Matches estimate)" },
            { type: "field", label: "Impact", value: "Solidified market expectations of December Fed cut" },
          ],
        },
      },
    }
  );

  // Bitcoin Specific Milestones
  if (isBtc || (!isEth && !isSol && !isNvda && !isAapl && !isTsla)) {
    marks.push(
      {
        id: "btc-etf-approval",
        time: Date.UTC(2024, 0, 10, 21, 30),
        title: "Spot Bitcoin ETF Approved",
        group: "news",
        glyph: { shape: "circle", color: "#f7931a", letter: "E" },
        tooltip: "SEC approves 11 spot Bitcoin ETFs",
        content: {
          panel: {
            items: [
              { type: "field", label: "Milestone", value: "Spot Bitcoin ETF Historic Approval" },
              { type: "field", label: "Issuers", value: "BlackRock (IBIT), Fidelity (FBTC), Ark, Bitwise, etc." },
              { type: "field", label: "Day 1 Volume", value: "$4.6 Billion USD" },
              { type: "text", text: "Historic transition marking widespread institutional capital access to spot Bitcoin." },
            ],
          },
        },
      },
      {
        id: "btc-4th-halving",
        time: Date.UTC(2024, 3, 20, 0, 9),
        title: "Bitcoin 4th Halving (Block 840,000)",
        group: "releases",
        glyph: { shape: "square", color: "#f7931a", letter: "H" },
        tooltip: "Mining subsidy halved from 6.25 BTC to 3.125 BTC",
        content: {
          panel: {
            items: [
              { type: "field", label: "Event", value: "Bitcoin Halving #4" },
              { type: "field", label: "Block Height", value: "840,000" },
              { type: "field", label: "Subsidy", value: "Cut to 3.125 BTC / block" },
              { type: "field", label: "Daily Issuance", value: "Reduced from ~900 BTC to ~450 BTC" },
              { type: "text", text: "Historic programmatic supply reduction, followed by record runes transaction fees." },
            ],
          },
        },
      },
      {
        id: "btc-trump-nashville",
        time: Date.UTC(2024, 6, 27, 19, 0),
        title: "Bitcoin Conference Keynote",
        group: "news",
        glyph: { shape: "circle", color: "#e91e63", letter: "N" },
        tooltip: "Strategic National Bitcoin Reserve announced",
        content: {
          panel: {
            items: [
              { type: "field", label: "Catalyst", value: "Nashville Bitcoin 2024 Keynote" },
              { type: "field", label: "Proposal", value: "US Strategic National Bitcoin Stockpile" },
              { type: "text", text: "Pledged never to sell government-held Bitcoin and replace SEC leadership." },
            ],
          },
        },
      },
      {
        id: "btc-100k-rally",
        time: Date.UTC(2024, 10, 22, 14, 0),
        title: "BTC Breaches $99,000 Highs",
        group: "news",
        glyph: { shape: "pin", color: "#00c853", letter: "★" },
        tooltip: "Record inflow velocity into spot crypto ETFs",
        content: {
          panel: {
            items: [
              { type: "field", label: "Market Structure", value: "All-Time High Discovery" },
              { type: "field", label: "High Print", value: "$99,800+" },
              { type: "field", label: "ETF Cumulative Flows", value: "Exceeded $30 Billion" },
            ],
          },
        },
      }
    );
  }

  // Ethereum Specific Milestones
  if (isEth) {
    marks.push(
      {
        id: "eth-dencun-upgrade",
        time: Date.UTC(2024, 2, 13, 13, 55),
        title: "Ethereum Dencun Upgrade (EIP-4844)",
        group: "releases",
        glyph: { shape: "square", color: "#627eea", letter: "D" },
        tooltip: "Proto-Danksharding & Blob transactions live on mainnet",
        content: {
          panel: {
            items: [
              { type: "field", label: "Hard Fork", value: "Dencun (Cancun-Deneb)" },
              { type: "field", label: "Key EIP", value: "EIP-4844 Proto-Danksharding" },
              { type: "field", label: "L2 Gas Fees", value: "Reduced by 90%+ across Arbitrum, Base, Optimism" },
              { type: "text", text: "Enables blob-carrying transactions, dramatically lowering Layer-2 data availability costs." },
            ],
          },
        },
      },
      {
        id: "eth-etf-approved",
        time: Date.UTC(2024, 4, 23, 21, 30),
        title: "Spot Ethereum ETF Approval",
        group: "news",
        glyph: { shape: "circle", color: "#627eea", letter: "E" },
        tooltip: "SEC approves 19b-4 filings for Spot Ether ETFs",
        content: {
          panel: {
            items: [
              { type: "field", label: "Regulatory", value: "SEC approves omnibus 19b-4 rule changes" },
              { type: "field", label: "Significance", value: "Affirms spot Ethereum commodity treatment under US law" },
            ],
          },
        },
      },
      {
        id: "eth-etf-live",
        time: Date.UTC(2024, 6, 23, 13, 30),
        title: "Spot Ether ETFs Begin Trading",
        group: "news",
        glyph: { shape: "pin", color: "#00c853", letter: "★" },
        tooltip: "Trading starts across US exchanges (ETHA, FETH, ETHE)",
        content: {
          panel: {
            items: [
              { type: "field", label: "Launch", value: "US Spot Ether ETFs Live" },
              { type: "field", label: "First Day Volume", value: "$1.08 Billion" },
            ],
          },
        },
      }
    );
  }

  // Solana Specific Milestones
  if (isSol) {
    marks.push(
      {
        id: "sol-etf-filing",
        time: Date.UTC(2024, 5, 27, 14, 0),
        title: "First US Spot Solana ETF Filed",
        group: "news",
        glyph: { shape: "circle", color: "#14f195", letter: "S" },
        tooltip: "VanEck files first US Spot Solana ETF (S-1)",
        content: {
          panel: {
            items: [
              { type: "field", label: "Filing", value: "VanEck Solana Trust" },
              { type: "field", label: "Subsequent", value: "21Shares files second SOL ETF shortly after" },
            ],
          },
        },
      },
      {
        id: "sol-firedancer-testnet",
        time: Date.UTC(2024, 8, 20, 15, 0),
        title: "Frankendancer Live on Mainnet",
        group: "releases",
        glyph: { shape: "square", color: "#9945ff", letter: "F" },
        tooltip: "Jump Crypto Firedancer validator client deployed",
        content: {
          panel: {
            items: [
              { type: "field", label: "Validator", value: "Frankendancer (Firedancer C++ core)" },
              { type: "field", label: "Target TPS", value: "Up to 1,000,000 TPS under benchmark" },
              { type: "field", label: "Client Diversity", value: "Second independent full validator client" },
            ],
          },
        },
      }
    );
  }

  // Equities: NVIDIA
  if (isNvda) {
    marks.push(
      {
        id: "nvda-split-2024",
        time: Date.UTC(2024, 5, 7, 20, 0),
        title: "NVDA 10-for-1 Stock Split",
        group: "releases",
        glyph: { shape: "circle", color: "#76b900", letter: "S" },
        tooltip: "10-for-1 forward stock split effective",
        content: {
          panel: {
            items: [
              { type: "field", label: "Corporate Action", value: "10-for-1 Forward Split" },
              { type: "field", label: "Split Price", value: "~$120 (from $1,200 pre-split)" },
            ],
          },
        },
      },
      {
        id: "nvda-q3-earnings",
        time: Date.UTC(2024, 10, 20, 21, 0),
        title: "NVIDIA Q3 FY25 Earnings Beat",
        group: "news",
        glyph: { shape: "diamond", color: "#76b900", letter: "E" },
        tooltip: "Revenue $35.1B (+94% YoY), Net Income $19.3B",
        content: {
          panel: {
            items: [
              { type: "field", label: "Revenue", value: "$35.1B vs $33.1B est" },
              { type: "field", label: "EPS", value: "$0.81 vs $0.75 est" },
              { type: "field", label: "Data Center", value: "$30.8B (+112% YoY)" },
            ],
          },
        },
      }
    );
  }

  return marks;
}

/** Convert journal entries into interactive timeline marks */
function getJournalMarks(rawSymbol: string): TimelineMark[] {
  const allEntries = getJournalEntries();
  const cleanSym = (rawSymbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Match trades that belong to this symbol or its base
  const matching = allEntries.filter((e) => {
    const entrySym = (e.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleanSym || !entrySym) return true;
    return (
      cleanSym.includes(entrySym) ||
      entrySym.includes(cleanSym) ||
      (cleanSym.startsWith("BTC") && entrySym.startsWith("BTC")) ||
      (cleanSym.startsWith("ETH") && entrySym.startsWith("ETH")) ||
      (cleanSym.startsWith("SOL") && entrySym.startsWith("SOL"))
    );
  });

  return matching.map((entry) => {
    const isWin = (entry.pnl ?? 0) >= 0;
    const color = isWin ? "#089981" : "#f23645";
    const sideLetter = entry.side === "LONG" ? "L" : "S";
    const sign = isWin ? "+" : "";
    const pnlFormatted = `${sign}$${(entry.pnl ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const pctFormatted = `${sign}${(entry.pnlPercent ?? 0).toFixed(2)}%`;

    const panelItems: any[] = [
      { type: "field", label: "Trade", value: `${entry.side} ${entry.symbol} (${entry.amount})` },
      { type: "field", label: "Outcome", value: `${isWin ? "🟢 Win" : "🔴 Loss"} ${pnlFormatted} (${pctFormatted})` },
      { type: "field", label: "Entry Price", value: `$${(entry.entryPrice ?? 0).toLocaleString()}` },
      { type: "field", label: "Exit Price", value: `$${(entry.exitPrice ?? 0).toLocaleString()}` },
    ];

    if (entry.duration) {
      panelItems.push({ type: "field", label: "Duration", value: entry.duration });
    }
    if (entry.strategy) {
      panelItems.push({ type: "field", label: "Strategy", value: entry.strategy });
    }
    if (entry.tags && entry.tags.length > 0) {
      panelItems.push({ type: "field", label: "Tags", value: entry.tags.join(", ") });
    }
    if (entry.mae != null) {
      panelItems.push({ type: "field", label: "MAE (Max Adverse)", value: `$${entry.mae}` });
    }
    if (entry.mfe != null) {
      panelItems.push({ type: "field", label: "MFE (Max Favorable)", value: `$${entry.mfe}` });
    }
    if (entry.notes) {
      panelItems.push({ type: "text", text: entry.notes });
    }

    panelItems.push({
      type: "button",
      label: "Open Full Journal Dashboard",
      primary: true,
      close: true,
      run: () => {
        window.dispatchEvent(
          new CustomEvent("tradepro:open-journal-full", {
            detail: { entryId: entry.id },
          })
        );
      },
    });

    return {
      id: `trade-${entry.id}`,
      time: entry.timestamp || new Date(entry.date).getTime(),
      title: `${entry.side} ${entry.symbol} • ${pnlFormatted}`,
      group: "trades",
      glyph: {
        shape: "pin",
        color,
        letter: sideLetter,
      },
      tooltip: `${entry.side} @ $${entry.entryPrice} → $${entry.exitPrice} | ${pnlFormatted} (${pctFormatted})`,
      content: {
        panel: {
          items: panelItems,
        },
      },
    };
  });
}

/**
 * Seed all timeline marks (Milestones + News + Macro + Trades) into chart.marks
 */
export function seedTimelineMarks(chart: any, currentSymbol: string): void {
  if (!chart?.marks) {
    return;
  }

  try {
    // 1. Define groups so chart settings Events tab shows checkboxes
    for (const grp of TIMELINE_GROUPS) {
      try {
        chart.marks.defineGroup(grp);
      } catch (err) {
        // Continue if group already defined
      }
    }

    // 2. Curate catalysts + live journal marks
    const catalysts = getSymbolCatalysts(currentSymbol);
    const tradeMarks = getJournalMarks(currentSymbol);
    const allMarks = [...catalysts, ...tradeMarks];

    // 3. Atomically replace the marks for this symbol
    chart.marks.set(allMarks);
    console.info(`[timeline-marks] seeded ${allMarks.length} marks for ${currentSymbol}`);
  } catch (err) {
    console.warn("[timeline-marks] failed to seed marks:", err);
  }
}
