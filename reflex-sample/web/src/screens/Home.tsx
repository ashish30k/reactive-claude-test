import type { HomeViewModel } from "../../../core";
import { useStore } from "../hooks";
import { Banner, Card, ErrorState, Skeleton } from "../ui";

export function Home({ vm }: { vm: HomeViewModel }) {
  const s = useStore(vm);
  if (s.status === "loading") return <Skeleton rows={4} />;
  if (s.status === "error") return <ErrorState message={s.error} onRetry={() => vm.send({ type: "Refresh" })} />;

  return (
    <div className="stack">
      {s.error && <Banner action={<button className="link" onClick={() => vm.send({ type: "Refresh" })}>Retry</button>}>{s.error}</Banner>}
      <div className="greeting">
        <p className="muted">Good to see you</p>
        <h2>{s.shopName}</h2>
      </div>
      <Card
        title="Today"
        actions={
          <button className="link" disabled={s.refreshing} onClick={() => vm.send({ type: "Refresh" })}>
            {s.refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      >
        <div className="metrics">
          <div>
            <div className="metric-value">{s.todaySales}</div>
            <div className="muted">Total sales</div>
          </div>
          <div>
            <div className="metric-value">{s.todayOrders}</div>
            <div className="muted">Orders</div>
          </div>
        </div>
      </Card>
      <Card title="Things to do">
        <button className="todo" disabled={!s.ordersToFulfill} onClick={() => vm.send({ type: "ViewOrdersToFulfill" })}>
          <span className="todo-icon">📦</span>
          <span className="todo-text">
            {s.ordersToFulfill ? <><b>{s.ordersToFulfill} orders</b> to fulfill</> : "No orders to fulfill"}
          </span>
          {!!s.ordersToFulfill && <span className="chev">›</span>}
        </button>
        <button className="todo" disabled={!s.lowStockProducts} onClick={() => vm.send({ type: "ViewLowStock" })}>
          <span className="todo-icon">📉</span>
          <span className="todo-text">
            {s.lowStockProducts ? <><b>{s.lowStockProducts} products</b> low on stock</> : "Stock levels look healthy"}
          </span>
          {!!s.lowStockProducts && <span className="chev">›</span>}
        </button>
      </Card>
    </div>
  );
}
