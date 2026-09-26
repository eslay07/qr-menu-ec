import OrderView from '../../ui/order-view';

export default async function OrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OrderView token={token} />;
}
