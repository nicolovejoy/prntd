import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRecentAppErrors } from "../actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export default async function AdminErrorsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    redirect("/");
  }

  const errors = await getRecentAppErrors(50);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <Breadcrumbs
        trail={breadcrumbTrail("/admin/errors")}
        current="Errors"
        className="mb-4"
      />
      <h1 className="text-xl font-bold mb-6">Runtime errors</h1>

      {errors.length === 0 ? (
        <p className="text-text-muted">No errors recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b text-text-faint text-xs uppercase">
              <tr>
                <th className="py-3 pr-4">Time</th>
                <th className="py-3 pr-4">Digest</th>
                <th className="py-3 pr-4">Message</th>
                <th className="py-3 pr-4">Path</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {errors.map((e) => (
                <tr key={e.id} className="align-top hover:bg-surface-raised">
                  <td className="py-3 pr-4 text-xs text-text-muted whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">{e.digest ?? "—"}</td>
                  <td className="py-3 pr-4 text-xs">
                    {e.message}
                    {e.context?.routeType && (
                      <span className="text-text-faint ml-2">
                        {e.context.routeType}
                        {e.context.routePath ? ` · ${e.context.routePath}` : ""}
                      </span>
                    )}
                    {e.stack && (
                      <details className="mt-1">
                        <summary className="text-text-faint cursor-pointer">
                          Stack
                        </summary>
                        <pre className="mt-1 p-2 bg-surface rounded text-[10px] whitespace-pre-wrap break-all">
                          {e.stack}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-text-muted">
                    {e.method ? `${e.method} ` : ""}
                    {e.path ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
