/**
 * Production transport: the real Shopify Admin GraphQL API.
 *
 * Handles what real apps must handle:
 *   - auth header (X-Shopify-Access-Token)
 *   - cost-based rate limiting: retries THROTTLED responses with backoff,
 *     using the server's reported restore rate when available
 *   - 5xx / connection errors -> NetworkError (the UI shows "offline, retry")
 *   - GraphQL `errors` -> GraphQLError
 *
 * NOTE: browsers can't call the Admin API directly (CORS + the token must
 * stay secret). In an embedded app this runs on your backend; here it's used
 * by the CLI/host (`npm run cli -- --live`).
 */
import { GraphQLError, NetworkError, type GraphQLRequest, type GraphQLTransport } from "../core/foundation/platform";

export interface ShopifyAdminTransportOptions {
  shopDomain: string; // my-store.myshopify.com
  accessToken: string; // shpat_...
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface GraphQLResponse {
  data?: unknown;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { requestedQueryCost: number; throttleStatus: { currentlyAvailable: number; restoreRate: number } } };
}

export class ShopifyAdminTransport implements GraphQLTransport {
  readonly endpoint: string;
  #opts: Required<Omit<ShopifyAdminTransportOptions, "shopDomain" | "apiVersion">>;

  constructor(opts: ShopifyAdminTransportOptions) {
    this.endpoint = `https://${opts.shopDomain}/admin/api/${opts.apiVersion ?? "2025-10"}/graphql.json`;
    this.#opts = {
      accessToken: opts.accessToken,
      fetchImpl: opts.fetchImpl ?? fetch,
      maxRetries: opts.maxRetries ?? 3,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  async execute<T>(req: GraphQLRequest): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#opts.fetchImpl(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.#opts.accessToken },
          body: JSON.stringify({ query: req.query, variables: req.variables, operationName: req.operationName }),
        });
      } catch (e) {
        throw new NetworkError(String(e));
      }

      if (res.status === 401 || res.status === 403) throw new GraphQLError("Invalid or expired access token");
      if (res.status >= 500 || res.status === 429) {
        if (attempt < this.#opts.maxRetries) {
          await this.#opts.sleep(500 * 2 ** attempt);
          continue;
        }
        throw new NetworkError(`Shopify responded ${res.status}`);
      }

      const body = (await res.json()) as GraphQLResponse;
      const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < this.#opts.maxRetries) {
        const cost = body.extensions?.cost;
        const wait = cost
          ? Math.ceil(((cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable) / cost.throttleStatus.restoreRate) * 1000)
          : 1000 * 2 ** attempt;
        await this.#opts.sleep(Math.max(wait, 250));
        continue;
      }
      if (body.errors?.length) throw new GraphQLError(body.errors.map((e) => e.message).join("; "));
      return body.data as T;
    }
  }
}
