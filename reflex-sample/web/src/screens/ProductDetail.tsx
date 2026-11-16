import { PRODUCT_STATUSES, type ProductDetailViewModel } from "../../../core";
import { useStore } from "../hooks";
import { Banner, Card, ErrorState, Skeleton, Thumb, Toast } from "../ui";

const STATUS_LABEL = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" } as const;

export function ProductDetail({ vm }: { vm: ProductDetailViewModel }) {
  const s = useStore(vm);
  if (s.status === "loading") return <Skeleton rows={5} />;
  if (s.status === "error" || !s.product) return <ErrorState message={s.error} onRetry={() => vm.send({ type: "Refresh" })} />;
  const p = s.product;

  return (
    <div className="stack">
      {s.error && <Banner>{s.error}</Banner>}
      <div className="product-head">
        <Thumb title={p.title} url={p.imageUrl} />
        <div>
          <h2>{p.title}</h2>
          <p className="muted">{p.vendor} · {p.productType}</p>
        </div>
      </div>

      <Card title="Status">
        <select
          className="select-block"
          value={p.status}
          disabled={s.savingStatus}
          onChange={(e) => vm.send({ type: "SetStatus", status: e.target.value as (typeof PRODUCT_STATUSES)[number] })}
        >
          {PRODUCT_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
        </select>
        {s.savingStatus && <p className="muted small">Saving…</p>}
      </Card>

      <Card title="Inventory" actions={<span className="muted small">{p.location}</span>}>
        <p className="muted small">{p.inventory} across all variants</p>
        <ul className="variants">
          {s.variants.map((v) => (
            <li key={v.id}>
              <div>
                <div>{v.title === "Default Title" ? "Default" : v.title}</div>
                <div className="muted small">{[v.sku && `SKU ${v.sku}`, v.price].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="stepper">
                <button aria-label="Remove one" onClick={() => vm.send({ type: "AdjustInventory", variantId: v.id, delta: -1 })}>−</button>
                <span className={`qty ${v.saving ? "saving" : ""} ${v.available <= 0 ? "warn" : ""}`}>{v.available}</span>
                <button aria-label="Add one" onClick={() => vm.send({ type: "AdjustInventory", variantId: v.id, delta: 1 })}>+</button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Toast message={s.toast} onDismiss={() => vm.send({ type: "DismissToast" })} />
    </div>
  );
}
