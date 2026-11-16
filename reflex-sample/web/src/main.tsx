import { createRoot } from "react-dom/client";
import { AppRoot } from "../../core";
import { MockShop } from "../../host/mock-shop/MockShop";
import { App } from "./App";

// The web host: pick the platform implementations, build the core, render views.
// Swap MockShop for a transport that calls your backend to go live.
const shop = new MockShop({ latency: [250, 700] });
const app = new AppRoot({
  transport: shop,
  clock: { now: () => new Date() },
  logger: { log: (level, msg) => console[level === "debug" ? "log" : level](msg) },
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: "en-US",
});

// Handy for poking around from DevTools: reflex.app.perform("selectTab", {tab:"orders"})
Object.assign(window, { reflex: { app, shop } });

createRoot(document.getElementById("root")!).render(<App app={app} shop={shop} />);
