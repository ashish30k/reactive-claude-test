import { CARRIERS, type OrderDetailViewModel } from "../../../core";
import { useStore } from "../hooks";
import { Badge, Banner, Card, ErrorState, Skeleton, Toast, fulfillmentTone, paymentTone } from "../ui";

export function OrderDetail({ vm }: { vm: OrderDetailViewModel }) {
  const s = useStore(vm);
  if (s.status === "loading") return <Skeleton rows={6} />;
  if (s.status === "error" || !s.order) return <ErrorState message={s.error} onRetry={() => vm.send({ type: "Refresh" })} />;
  const o = s.order;
  const sheet = s.fulfillSheet;

  return (
    <div className="stack">
      {s.error && <Banner>{s.error}</Banner>}
      <div className="detail-head">
        <h2>{o.name}</h2>
        <div className="badges">
          <Badge tone={paymentTone(o.payment)}>{o.payment}</Badge>
          <Badge tone={fulfillmentTone(o.fulfillment)}>{o.fulfillment}</Badge>
        </div>
        <p className="muted">{o.date}</p>
      </div>

      <Card title={`${o.fulfillment} (${o.itemCount})`}>
        <ul className="items">
          {o.items.map((li, i) => (
            <li key={i}>
              <div>
                <div>{li.title}</div>
                <div className="muted small">{[li.variant, li.sku && `SKU ${li.sku}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="muted">{li.unitPrice} × {li.quantity}</div>
              <div>{li.lineTotal}</div>
            </li>
          ))}
        </ul>
        {o.tracking.length > 0 && <p className="tracking">🚚 {o.tracking.join(", ")}</p>}
        {s.canFulfill && (
          <button className="btn btn-primary btn-block" onClick={() => vm.send({ type: "StartFulfillment" })}>
            Fulfill items
          </button>
        )}
      </Card>

      <Card title={o.payment === "Paid" ? "Paid" : "Payment"}>
        <dl className="totals">
          <dt>Subtotal</dt><dd>{o.subtotal}</dd>
          <dt>Shipping</dt><dd>{o.shipping}</dd>
          <dt>Tax</dt><dd>{o.tax}</dd>
          <dt><b>Total</b></dt><dd><b>{o.total}</b></dd>
        </dl>
      </Card>

      <Card title="Customer">
        <p><b>{o.customer}</b></p>
        {o.email && <p className="link-like">{o.email}</p>}
        {o.shippingAddress.length > 0 && (
          <>
            <h4 className="muted small">Shipping address</h4>
            <address>{o.shippingAddress.map((l, i) => <div key={i}>{l}</div>)}</address>
          </>
        )}
        {o.note && <p className="note">📝 {o.note}</p>}
      </Card>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => !sheet.submitting && vm.send({ type: "CancelFulfillment" })}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Fulfill {o.name}</h3>
            <label className="field">
              <span>Shipping carrier</span>
              <select value={sheet.carrier} disabled={sheet.submitting} onChange={(e) => vm.send({ type: "SetCarrier", carrier: e.target.value as (typeof CARRIERS)[number] })}>
                {CARRIERS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Tracking number</span>
              <input
                value={sheet.trackingNumber}
                disabled={sheet.submitting}
                placeholder="Optional"
                onChange={(e) => vm.send({ type: "SetTrackingNumber", value: e.target.value })}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={sheet.notifyCustomer} disabled={sheet.submitting} onChange={(e) => vm.send({ type: "SetNotifyCustomer", value: e.target.checked })} />
              Send shipment details to the customer now
            </label>
            {sheet.error && <Banner>{sheet.error}</Banner>}
            <div className="sheet-actions">
              <button className="btn" disabled={sheet.submitting} onClick={() => vm.send({ type: "CancelFulfillment" })}>Cancel</button>
              <button className="btn btn-primary" disabled={sheet.submitting} onClick={() => vm.send({ type: "ConfirmFulfillment" })}>
                {sheet.submitting ? "Fulfilling…" : `Fulfill ${o.itemCount} item${o.itemCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast message={s.toast} onDismiss={() => vm.send({ type: "DismissToast" })} />
    </div>
  );
}
