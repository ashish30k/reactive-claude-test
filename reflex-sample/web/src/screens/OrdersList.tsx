import type { OrdersListViewModel } from "../../../core";
import { useStore } from "../hooks";
import { Badge, Banner, Empty, ErrorState, Segmented, Skeleton, fulfillmentTone, paymentTone } from "../ui";
import { SearchField } from "./SearchField";

export function OrdersList({ vm }: { vm: OrdersListViewModel }) {
  const s = useStore(vm);
  return (
    <div className="stack">
      <SearchField value={s.search} placeholder="Search orders or customers" onSearch={(query) => vm.send({ type: "Search", query })} />
      <Segmented
        value={s.filter}
        options={[["all", "All"], ["unfulfilled", "Unfulfilled"], ["unpaid", "Unpaid"]]}
        onChange={(filter) => vm.send({ type: "SetFilter", filter })}
      />
      {s.status === "loading" && <Skeleton />}
      {s.status === "error" && <ErrorState message={s.error} onRetry={() => vm.send({ type: "Refresh" })} />}
      {s.status === "loaded" && (
        <>
          {s.error && <Banner action={<button className="link" onClick={() => vm.send({ type: "Refresh" })}>Retry</button>}>{s.error}</Banner>}
          {s.refreshing && <div className="refreshing">Refreshing…</div>}
          {s.emptyMessage ? (
            <Empty message={s.emptyMessage} />
          ) : (
            <ul className="list card">
              {s.orders.map((o) => (
                <li key={o.id}>
                  <button className="row" onClick={() => vm.send({ type: "OpenOrder", id: o.id })}>
                    <div className="row-main">
                      <div className="row-title">
                        <b>{o.name}</b>
                        <span className="muted">{o.date}</span>
                      </div>
                      <div className="row-sub">{o.customer}</div>
                      <div className="badges">
                        <Badge tone={paymentTone(o.payment)}>{o.payment}</Badge>
                        <Badge tone={fulfillmentTone(o.fulfillment)}>{o.fulfillment}</Badge>
                      </div>
                    </div>
                    <div className="row-end">{o.total}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {s.hasMore && (
            <button className="btn btn-block" disabled={s.loadingMore} onClick={() => vm.send({ type: "LoadMore" })}>
              {s.loadingMore ? "Loading…" : "Load more orders"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
