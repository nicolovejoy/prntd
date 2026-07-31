import { requireRealUser } from "@/lib/require-user";
import { getUserOrdersData } from "@/lib/user-orders";
import { OrdersList } from "./orders-list";

// Server-rendered initial data (#127): the list arrives in the first response
// instead of a client shell + server-action round trip after hydration.
export default async function OrdersPage() {
  const session = await requireRealUser();
  const orders = await getUserOrdersData(session.user.id);
  return <OrdersList orders={orders} />;
}
