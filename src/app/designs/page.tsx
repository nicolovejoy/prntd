import { requireRealUser } from "@/lib/require-user";
import { getUserDesignsData } from "@/lib/user-designs";
import { DesignsList } from "./designs-list";

// Server-rendered initial data (#127): the list arrives in the first response
// instead of a client shell + server-action round trip after hydration.
export default async function DesignsPage() {
  const session = await requireRealUser();
  const designs = await getUserDesignsData(session.user.id);
  return <DesignsList initialDesigns={designs} />;
}
