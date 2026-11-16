import type { ProductsListViewModel } from "../../../core";
import { useStore } from "../hooks";
import { Badge, Banner, Empty, ErrorState, Segmented, Skeleton, Thumb } from "../ui";
import { SearchField } from "./SearchField";

export function ProductsList({ vm }: { vm: ProductsListViewModel }) {
  const s = useStore(vm);
  return (
    <div className="stack">
      <SearchField value={s.search} placeholder="Search products, vendors, SKUs" onSearch={(query) => vm.send({ type: "Search", query })} />
      <Segmented
        value={s.filter}
        options={[["all", "All"], ["active", "Active"], ["draft", "Draft"], ["lowStock", "Low stock"]]}
        onChange={(filter) => vm.send({ type: "SetFilter", filter })}
      />
      {s.status === "loading" && <Skeleton />}
      {s.status === "error" && <ErrorState message={s.error} onRetry={() => vm.send({ type: "Refresh" })} />}
      {s.status === "loaded" && (
        <>
          {s.error && <Banner action={<button className="link" onClick={() => vm.send({ type: "Refresh" })}>Retry</button>}>{s.error}</Banner>}
          {s.emptyMessage ? (
            <Empty message={s.emptyMessage} />
          ) : (
            <ul className="list card">
              {s.products.map((p) => (
                <li key={p.id}>
                  <button className="row" onClick={() => vm.send({ type: "OpenProduct", id: p.id })}>
                    <Thumb title={p.title} url={p.imageUrl} />
                    <div className="row-main">
                      <div className="row-title"><b>{p.title}</b></div>
                      <div className={`row-sub ${p.lowStock ? "warn" : ""}`}>{p.inventory}</div>
                      <div className="muted small">{p.vendor}</div>
                    </div>
                    {p.status !== "Active" && <Badge tone={p.status === "Draft" ? "info" : "neutral"}>{p.status}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {s.hasMore && (
            <button className="btn btn-block" disabled={s.loadingMore} onClick={() => vm.send({ type: "LoadMore" })}>
              {s.loadingMore ? "Loading…" : "Load more products"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
