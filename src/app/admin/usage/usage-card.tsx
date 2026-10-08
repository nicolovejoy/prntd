import Link from "next/link";
import {
  formatLastActive,
  formatUsd,
  type UsageUserRow,
} from "@/lib/admin-usage";
import { formatDisplayDate } from "@/lib/display-time-zone";

const LABEL =
  "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";

function stats(row: UsageUserRow): { label: string; value: string }[] {
  const g = row.generations;
  const out = [
    { label: "Generations today · 7 d · all", value: `${g.today} · ${g.week} · ${g.total}` },
    { label: "Generate · edit", value: `${g.generateTotal} · ${g.editTotal}` },
    { label: "Failed or cancelled, 7 d", value: String(row.failedWeek) },
    { label: "Spend", value: formatUsd(row.spend) },
    { label: "Conversations", value: String(row.conversations) },
    { label: "Chat messages, 7 d", value: String(row.chatWeek) },
    {
      label: "Published",
      value:
        row.hidden > 0
          ? `${row.published} · ${row.hidden} hidden`
          : String(row.published),
    },
    {
      label: "Paid orders · revenue",
      value: `${row.paidOrders} · ${formatUsd(row.revenue)}`,
    },
  ];
  if (row.cartLines > 0) {
    out.push({ label: "Open cart lines", value: String(row.cartLines) });
  }
  out.push({ label: "Last IP", value: row.ip ?? "—" });
  return out;
}

/**
 * One user's usage card. Server component: with `href` the whole card is a
 * link (the list); without it the card is the detail page's header.
 */
export function UsageCard({
  row,
  now,
  href,
}: {
  row: UsageUserRow;
  now: Date;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold break-all">{row.label}</h2>
        <span className={LABEL}>{row.kind}</span>
      </div>
      <p className={`${LABEL} mt-1`}>
        First seen {formatDisplayDate(row.createdAt)} · Last active{" "}
        {formatLastActive(row.lastActiveAt, now)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4">
        {stats(row).map((s) => (
          <div key={s.label} className="border-t border-border py-2">
            <dt className={LABEL}>{s.label}</dt>
            <dd className="mt-1 text-sm font-mono break-all">{s.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );

  const classes = "block border border-border bg-surface p-4";
  if (href) {
    return (
      <Link
        href={href}
        data-testid="usage-card"
        data-user-id={row.id}
        className={`${classes} hover:border-border-hover`}
      >
        {body}
      </Link>
    );
  }
  return (
    <div data-testid="usage-card" data-user-id={row.id} className={classes}>
      {body}
    </div>
  );
}
