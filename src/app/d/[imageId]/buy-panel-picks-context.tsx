"use client";

/**
 * The buy panel's open picks, shared with the rest of the image detail page
 * (#278 slice 4). The links to the conversation's other images carry them, so
 * switching the image keeps product, size and colour. Context rather than the
 * address bar: the panel's replaceState is not seen by Next's router, so
 * useSearchParams would not follow it. Without a provider the report is a
 * no-op and the picks read null.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { OpenBuyPanelPicks } from "@/lib/buy-page-picks";

const PicksContext = createContext<OpenBuyPanelPicks>(null);
const noReport = () => {};
const ReportContext = createContext<(picks: OpenBuyPanelPicks) => void>(noReport);

export function BuyPanelPicksProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<OpenBuyPanelPicks>(null);
  return (
    <ReportContext.Provider value={setPicks}>
      <PicksContext.Provider value={picks}>{children}</PicksContext.Provider>
    </ReportContext.Provider>
  );
}

export function useOpenBuyPanelPicks(): OpenBuyPanelPicks {
  return useContext(PicksContext);
}

export function useReportBuyPanelPicks(): (picks: OpenBuyPanelPicks) => void {
  return useContext(ReportContext);
}
