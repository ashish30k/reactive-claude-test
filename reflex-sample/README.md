# Shop Admin: a Reflex architecture sample

A small but realistic **Shopify-style merchant admin** (dashboard, orders, fulfillment, products, inventory). It is built to show how **Reflex** works.

> **What is Reflex?** It is the architecture Shopify Engineering described in 2026 for the rebuilt Shopify mobile app ([Reflex: an architecture for building mobile apps with agents](https://shopify.engineering/reflex)). Every part of the app except the views lives in a **headless core**. Each screen's ViewModel exposes its **state and actions as a JSON contract**, and a **CLI** can read and drive that contract. So agents and tests can build, test and use the app **without rendering any UI**.
>
> Shopify has **not** released Reflex as a library. Their apps are native Swift and Kotlin. This repo is an independent TypeScript version of the *pattern*, so you can run it, read it and change it in one place. The names follow the public descriptions (State / Action / Message / `update`, `ls` / `do` / `tree`, NDJSON v1, fixtures keyed by `operationName`).

---

## Run it

```bash
cd reflex-sample
npm install

npm run web      # http://localhost:5173: phone UI + live "Reflex inspector"
npm run cli      # drive the same app from your terminal (in-memory mock shop)
npm test         # 39 tests: behavior journeys, protocol, architecture rules (~1s)
```

Other entry points:

```bash
npm run cli -- --fixture Orders.browse            # replay recorded API responses
npm run cli -- --url shop://orders/1046           # start on a deep link
SHOPIFY_SHOP=my-dev-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_... npm run cli -- --live   # your real store
npm run host                                      # raw NDJSON over stdio (for agents / other languages)
npm run fixtures:record [-- --live]               # re-record fixtures
```

---

## The idea in one picture

```
                ┌────────────────────────── core/ (no UI imports, enforced by a test) ───────────────────────────┐
                │                                                                                                 │
  user taps ──► │  view.send(Action) ──► update(state, action) ──► new State ──► subscribers re-render            │
  CLI `do`  ──► │                              │                                                                  │
  test `do` ──► │                              └─► effects ──► AdminApi ──► GraphQLTransport (port) ──┐           │
                │                                     ▲                                               │           │
                │                                     └──────── Message (result) ◄────────────────────┘           │
                │                                                                                                 │
                │  AppRoot: tabs + StackNavigator per tab, deep links, "lent" actions (goBack/selectTab/openURL)  │
                └─────────────────────────────────────────────────────────────────────────────────────────────────┘
                         ▲                         ▲                          ▲
        web/ (React views, dumb)        cli/ + host/ (NDJSON)        tests/ (same protocol)
        MockShop transport              Fixture / Mock / Shopify     FixtureTransport, no network
```

## Concepts → where to find them

| Reflex concept | What it means | In this repo |
|---|---|---|
| **Headless core** | All logic, navigation and formatting. No views, no DOM. | `core/`; `tests/unit/architecture.test.ts` fails if anything in `core/` imports React, Node or the DOM |
| **ViewModel contract** | `State` (what the user sees), `Action` (what the user can do), `Message` (async results), `update()` (the only place state changes) | `core/foundation/reflex.ts` |
| **Effects** | `update` stays pure: it *returns* async work, and the Runtime runs it and feeds the result back as a Message | `Next.effects`, `core/foundation/runtime.ts` |
| **Every action, always listed** | A node lists all actions every time, each marked `enabled: true/false`. The mapped type makes the compiler reject a missing one | `protected readonly actions = {...}` in each ViewModel |
| **JSON contract (node)** | `{ name, state, actions }`. State keys starting with `_` (cursors, ids) stay internal | `ViewModel.node()`, `AppRoot.node()` |
| **Lent actions** | Things you can do on any screen without the screen owning them. camelCase, vs PascalCase for a screen's own actions | `goBack`, `selectTab`, `openURL` in `core/app/AppRoot.ts` |
| **Navigation in core** | Views never push screens. Each tab has its own stack. Deep links rebuild a stack | `core/foundation/navigator.ts`, `parseDeepLink()` |
| **Ports / DI** | Everything external is an interface passed in through the constructor | `core/foundation/platform.ts` (`GraphQLTransport`, `Clock`, `Logger`) |
| **Host + protocol** | NDJSON v1: `session.create`, `ls`, `do`, `tree`, `session.close`. Error codes `ACTION_NOT_AVAILABLE`, `INVALID_PAYLOAD`, `UNKNOWN_SESSION`, `FIXTURE_NOT_FOUND`. Events `ready`, `fixture_miss`, `network_violation`, `log`, `crash` | `host/ReflexHost.ts`, `host/main.ts` |
| **Settling** | `do` returns only after every effect it started has finished, so tests never sleep or poll | `Runtime.idle()` |
| **Fixtures** | Recorded GraphQL responses keyed by `operationName`, loaded as `Domain.scenario`. A later fixture replaces earlier entries for the same operation. A miss fails the test | `host/fixture-transport.ts`, `fixtures/` |
| **Behavior tests** | "given …, the merchant …". They only see name, state and actions | `tests/behavior/*.test.ts`, `tests/sdk/reflex.ts` |
| **Dumb views** | They read state and call `vm.send(action)`. Nothing else | `web/src/screens/*.tsx` |

## A session in the CLI

```text
$ npm run cli
▣ Home
state:
  { "status": "loaded", "shopName": "Maple & Pine Goods", "todaySales": "$649.25",
    "todayOrders": 5, "ordersToFulfill": 9, "lowStockProducts": 4, ... }
actions:
  ✓ Refresh
  ✓ ViewOrdersToFulfill
  ✓ ViewLowStock
  ✗ goBack
  ✓ selectTab {"tab":"home|orders|products"}
  ✓ openURL {"url":"string"}
reflex› ViewOrdersToFulfill
reflex› OpenOrder {"id":"gid://shopify/Order/1046"}
reflex› StartFulfillment
reflex› SetTrackingNumber {"value":"1Z999AA10123456784"}
reflex› ConfirmFulfillment          # toast "#1046 fulfilled", list + dashboard update
reflex› ConfirmFulfillment          # sheet is closed now, so:
ACTION_NOT_AVAILABLE: ConfirmFulfillment is not available right now
```

The web app's **inspector panel** shows the same JSON live next to the phone. Its buttons call `app.perform()`, the same entry point the CLI uses. Toggle **Offline** or **Fail next request** to see error, retry and rollback behavior.

## What makes it "real life"

- **Real Shopify Admin GraphQL documents** (API version `2025-10`): `orders` and `products` with search syntax and cursor pagination, `ordersCount`, `fulfillmentCreate` on fulfillment orders, `inventoryAdjustQuantities`, `productUpdate`, and `userErrors` handling. See `core/services/admin-api.ts`.
- **Production transport** (`host/shopify-transport.ts`): access-token auth. It handles cost-based `THROTTLED` responses by waiting until the query budget refills, retries 5xx/429 with backoff, and maps failures to errors the UI can show.
- **Loading, empty, error and refreshing states** on every screen. The first load shows a full-screen error. A failed refresh keeps the old data and shows a banner.
- **Stale-response protection**: change the filter while a page is loading and the old response is dropped (`_requestId`).
- **Optimistic inventory edits** that roll back if the save fails, and keep working with several saves in flight.
- **Cross-screen consistency** through an app event bus. Fulfil an order and the "Unfulfilled" list drops it and the dashboard count goes down, with no full reload.
- **Validation before the network call**: UPS and USPS tracking number formats, inventory can't go below 0, action payloads are checked against a schema.
- **The shop's time zone** for "Today at 3:15 PM" and for the "today's sales" query.
- **Lazy tabs**: a tab loads data only the first time you open it. **Deep links** (`shop://orders/1046`) build the stack underneath, and those screens load when you go back to them.

## Testing approach

```ts
it("given an unfulfilled order, the merchant can fulfill it with tracking and the rest of the app updates", async () => {
  const app = await launch(["Orders.fulfill"]);
  await app.do("ViewOrdersToFulfill");
  await app.do("OpenOrder", { id: "gid://shopify/Order/1046" });
  await app.do("StartFulfillment");
  await app.do("SetTrackingNumber", { value: "1z999aa10123456784" });
  await app.do("ConfirmFulfillment");

  expect(app.state().toast).toBe("#1046 fulfilled");
  await app.do("goBack");
  expect(app.state().orders).toHaveLength(8);
});
```

- Tests run on Node in about 1 second. No browser, no simulator, no sleeps.
- `launch(["Orders.fulfill", "Orders.alreadyFulfilled"])` **layers** fixtures. The second file replaces only `FulfillOrder`, so the same journey now hits a server-side `userError`.
- After each test the SDK fails it on any `fixture_miss`, `crash` or attempted real network call.
- `tests/unit/protocol.test.ts` starts the real stdio host process and talks raw NDJSON to it, the way an agent written in any language would.

**Fixture rules:**
- Entries may carry `variables`, and a request is only answered by an entry whose variables match. This sample adds that so one recorded file can serve every page and filter.
- Matching entries are used in order, and the last one repeats.
- Each recorded fixture comes from a scripted journey in `tools/record-fixtures.ts`, run against the deterministic mock shop. Use `--live` to record from a dev store instead.

## Add a screen (the workflow)

1. Write `core/features/<area>/<Name>ViewModel.ts`: State, Action, Message, `actions`, `update`, `onStart`.
2. Add a `Route` and a case in `AppRoot.#make`. Add a deep link if it needs one.
3. Write the API method and GraphQL document in `admin-api.ts`. Add a resolver to `MockShop` named `op<OperationName>`.
4. Add a journey to `tools/record-fixtures.ts` and run `npm run fixtures:record`.
5. Write the behavior test. **At this point the feature is done and tested, and nothing has been rendered.**
6. Last, write the view in `web/src/screens/` and map it in `App.tsx`. It only reads state and calls `send`.

## Going to production

- **Embedded Shopify app**: run the core in the browser and give it a `GraphQLTransport` that calls *your backend*, which holds the Admin token. Browsers can't call the Admin API directly, because of CORS and because the token must stay secret. Use App Bridge session tokens to authenticate the iframe with your backend. Shopify's React Router app template does this wiring for you.
- **Mobile**: this is what Shopify does. Write the core in Swift and in Kotlin, keep the same contract, and run one behavior test suite against both.
- **React Native**: the core above runs unchanged. Only the views change.

## Layout

```
core/          headless app: foundation/ (contract, runtime, ports, navigation), services/ (Admin API), features/, app/AppRoot
host/          ReflexHost (NDJSON), transports: fixtures, MockShop (in-memory store), Shopify Admin API
cli/           interactive terminal client
web/           React views + inspector (Vite)
fixtures/      recorded and handwritten API responses, Domain/scenario.json
tests/         behavior/ journeys, unit/ (architecture, protocol, logic), sdk/
tools/         fixture recorder
```
