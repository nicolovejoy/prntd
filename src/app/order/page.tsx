/**
 * /order is retired (docs/preview-order-collapse-plan.md §7 slice 2): the
 * combined purchase screen lives on /preview. This redirect keeps in-flight
 * Stripe cancel URLs working — sessions created before the deploy point here
 * and live ~24h. Params carry over so the restored /preview shows the same
 * selection.
 */
import { redirect } from "next/navigation";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const params = await searchParams;
  const usp = new URLSearchParams();
  for (const key of ["id", "product", "size", "color", "back"]) {
    const value = params[key];
    if (typeof value === "string" && value) usp.set(key, value);
  }
  const qs = usp.toString();
  redirect(qs ? `/preview?${qs}` : "/preview");
}
