import { useEffect, useReducer, useState } from "react";
import {
  HomeViewModel,
  OrderDetailViewModel,
  OrdersListViewModel,
  ProductDetailViewModel,
  ProductsListViewModel,
  TABS,
  type AnyViewModel,
  type AppRoot,
  type Tab,
} from "../../core";
import type { MockShop } from "../../host/mock-shop/MockShop";
import { useStore } from "./hooks";
import { Home } from "./screens/Home";
import { OrdersList } from "./screens/OrdersList";
import { OrderDetail } from "./screens/OrderDetail";
import { ProductsList } from "./screens/ProductsList";
import { ProductDetail } from "./screens/ProductDetail";

const TAB_META: Record<Tab, { label: string; icon: string; title: string }> = {
  home: { label: "Home", icon: "⌂", title: "Home" },
  orders: { label: "Orders", icon: "▤", title: "Orders" },
  products: { label: "Products", icon: "◈", title: "Products" },
};

const TITLES: Record<string, string> = { OrderDetail: "Order", ProductDetail: "Product" };

/** Maps the top-of-stack ViewModel to its view. Views are disposable; state lives in the VM. */
function Screen({ vm }: { vm: AnyViewModel }) {
  if (vm instanceof HomeViewModel) return <Home vm={vm} />;
  if (vm instanceof OrdersListViewModel) return <OrdersList vm={vm} />;
  if (vm instanceof OrderDetailViewModel) return <OrderDetail vm={vm} />;
  if (vm instanceof ProductsListViewModel) return <ProductsList vm={vm} />;
  if (vm instanceof ProductDetailViewModel) return <ProductDetail vm={vm} />;
  return <p>Unknown screen {vm.name}</p>;
}

export function App({ app, shop }: { app: AppRoot; shop: MockShop }) {
  const nav = useStore(app);
  const stack = app.stack(nav.tab);
  const top = stack[stack.length - 1]!;

  return (
    <div className="layout">
      <div className="phone">
        <header className="topbar">
          {stack.length > 1 ? (
            <button className="back" onClick={() => app.goBack()} aria-label="Back">‹</button>
          ) : (
            <span className="back-spacer" />
          )}
          <h1>{TITLES[top.name] ?? TAB_META[nav.tab].title}</h1>
          <span className="back-spacer" />
        </header>
        <main className="screen" key={`${nav.tab}:${stack.length}:${top.name}`}>
          <Screen vm={top} />
        </main>
        <nav className="tabbar">
          {TABS.map((t) => (
            <button key={t} className={t === nav.tab ? "on" : ""} onClick={() => (t === nav.tab && stack.length > 1 ? app.open(`shop://${t}`) : app.selectTab(t))}>
              <span className="tab-icon">{TAB_META[t].icon}</span>
              {TAB_META[t].label}
            </button>
          ))}
        </nav>
      </div>
      <Inspector app={app} shop={shop} vm={top} />
    </div>
  );
}

/**
 * Shows the exact JSON contract an agent/CLI/test sees for the visible
 * screen, and lets you drive the app through it. Same calls, same results.
 */
function Inspector({ app, shop, vm }: { app: AppRoot; shop: MockShop; vm: AnyViewModel }) {
  useStore(vm);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => shop.subscribe(rerender), [shop]);
  const node = app.node();
  const [result, setResult] = useState<string | null>(null);
  const [payloads, setPayloads] = useState<Record<string, string>>({});

  const run = (name: string, template: string) => {
    try {
      const payload = JSON.parse(payloads[name] ?? template);
      app.perform(name, payload);
      setResult(`✓ do ${name} ${JSON.stringify(payload)}`);
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e instanceof SyntaxError ? "BAD_JSON" : "ERROR");
      setResult(`✗ ${code}: ${(e as Error).message}`);
    }
  };

  return (
    <aside className="inspector">
      <h2>Reflex inspector</h2>
      <p className="muted small">
        The JSON a CLI, agent or test gets from <code>ls</code> for the visible screen. The buttons below call
        <code> app.perform()</code>, the same entry point the host uses for <code>do</code>.
      </p>

      <h3>Actions</h3>
      <ul className="actions">
        {node.actions.map((a) => {
          const template = a.payload ? JSON.stringify(Object.fromEntries(Object.entries(a.payload).map(([k, t]) => [k, t === "int" ? 1 : t === "boolean" ? true : t.includes("|") ? t.split("|")[0] : ""]))) : "{}";
          return (
            <li key={a.name} className={a.enabled ? "" : "disabled"}>
              <button disabled={!a.enabled} onClick={() => run(a.name, template)}>{a.name}</button>
              {a.payload && (
                <input
                  spellCheck={false}
                  value={payloads[a.name] ?? template}
                  onChange={(e) => setPayloads({ ...payloads, [a.name]: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ul>
      {result && <pre className={`result ${result.startsWith("✗") ? "bad" : ""}`}>{result}</pre>}

      <h3>State <span className="muted small">({node.name})</span></h3>
      <pre className="json">{JSON.stringify(node.state, null, 2)}</pre>

      <h3>Network <span className="muted small">(mock Admin API)</span></h3>
      <div className="toggles">
        <label><input type="checkbox" checked={shop.offline} onChange={(e) => ((shop.offline = e.target.checked), rerender())} /> Offline</label>
        <button className="btn btn-small" onClick={() => ((shop.failNext = true), rerender())} disabled={shop.failNext}>
          {shop.failNext ? "Next request will fail" : "Fail next request"}
        </button>
      </div>
      <ol className="netlog">
        {shop.log.slice(-10).reverse().map((r, i) => (
          <li key={shop.log.length - i} className={r.ok ? "" : "bad"}>
            <code>{r.operationName}</code>
            <span className="muted small">{r.variables ? JSON.stringify(r.variables).slice(0, 70) : ""}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
