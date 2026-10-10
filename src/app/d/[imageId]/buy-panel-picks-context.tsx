"use client";

/**
 * The buy panel's open picks, shared with the rest of the image detail page
 * (#278 slice 4). The links to the conversation's other images carry them, so
 * switching the image keeps product, size and colour. Context rather than
 * `useSearchParams`, which does follow the panel's address-bar writes now: the
 * address bar also holds the defaulted product and colour, and these links
 * carry those only once the buyer chose them (a sibling opened from an
 * untouched default takes its own product default and pinned backdrop). Only
 * the panel knows which is which. Without a provider the report is a no-op and
 * the picks read null.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { OpenBuyPanelPicks } from "@/lib/buy-page-picks";

const PicksContext = createContext<OpenBuyPanelPicks>(null);
const noReport = () => {};
const ReportContext = createContext<(picks: OpenBuyPanelPicks) => void>(noReport);

/** Renders one wrapper `div` around its children, carrying `className`, so a
 * page can make the provider its column container instead of nesting one. */
export function BuyPanelPicksProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [picks, setPicks] = useState<OpenBuyPanelPicks>(null);
  return (
    <ReportContext.Provider value={setPicks}>
      <PicksContext.Provider value={picks}>
        <div className={className}>{children}</div>
      </PicksContext.Provider>
    </ReportContext.Provider>
  );
}

export function useOpenBuyPanelPicks(): OpenBuyPanelPicks {
  return useContext(PicksContext);
}

export function useReportBuyPanelPicks(): (picks: OpenBuyPanelPicks) => void {
  return useContext(ReportContext);
}
