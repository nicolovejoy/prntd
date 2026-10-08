import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUsageList } from "./actions";
import { UsageCard } from "./usage-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HOME } from "@/lib/nav";
import { formatUsd, parseLimit } from "@/lib/admin-usage";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const LIMIT_STEP = 100;

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    redirect("/");
  }

  const limit = parseLimit((await searchParams).limit, DEFAULT_LIMIT, MAX_LIMIT);
  const { rows, totals, listedCount } = await getUsageList(limit);
  const now = new Date();

  const totalRows = [
    { label: "Active users, 7 d", value: String(totals.activeUsers7d) },
    { label: "Generations, 7 d", value: String(totals.generations7d) },
    { label: "Failed, 7 d", value: String(totals.failed7d) },
    { label: "Spend, 7 d", value: formatUsd(totals.spend7d) },
    { label: "Paid orders, 7 d", value: String(totals.paidOrders7d) },
  ];

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <Breadcrumbs
        trail={[HOME, { label: "Admin", href: "/admin" }]}
        current="Usage"
        className="mb-4"
      />
      <h1 className="text-xl font-bold mb-6">Usage</h1>

      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-t border-border mb-8">
        {totalRows.map((t) => (
          <div key={t.label} className="border-b border-border py-3 pr-4">
            <dt className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
              {t.label}
            </dt>
            <dd className="mt-1 text-sm font-mono">{t.value}</dd>
          </div>
        ))}
      </dl>

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No users yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((row) => (
            <UsageCard
              key={row.id}
              row={row}
              now={now}
              href={`/admin/usage/${row.id}`}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-text-muted">
        Showing {rows.length} of {listedCount} users, most recently active
        first.{" "}
        {listedCount > rows.length && limit < MAX_LIMIT && (
          <Link
            href={`/admin/usage?limit=${Math.min(limit + LIMIT_STEP, MAX_LIMIT)}`}
            className="underline underline-offset-[3px] hover:no-underline text-foreground"
          >
            Show {Math.min(LIMIT_STEP, listedCount - rows.length)} more
          </Link>
        )}
      </p>
    </div>
  );
}
