// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock server-only so it doesn't throw in test environment
vi.mock("server-only", () => ({}));

// Mock next/headers
const mockCookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

// Mock next/server
vi.mock("next/server", () => ({
  NextRequest: class NextRequest {
    cookies: { get: (name: string) => { value: string } | undefined };
    constructor(cookies: Record<string, string>) {
      this.cookies = {
        get: (name: string) =>
          cookies[name] ? { value: cookies[name] } : undefined,
      };
    }
  },
}));

import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
  SessionPayload,
} from "@/lib/auth";
import { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  test("sets an httpOnly cookie with a JWT token", async () => {
    await createSession("user-123", "test@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [cookieName, token, options] = mockCookieStore.set.mock.calls[0];

    expect(cookieName).toBe("auth-token");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // valid JWT format
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
    expect(options.sameSite).toBe("lax");
    expect(options.expires).toBeInstanceOf(Date);
  });

  test("sets expiry ~7 days in the future", async () => {
    const before = Date.now();
    await createSession("user-123", "test@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expiresAt = options.expires as Date;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null for an invalid/tampered token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "invalid.token.here" });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    // Create a real token first
    await createSession("user-456", "valid@example.com");
    const [, token] = mockCookieStore.set.mock.calls[0];

    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-456");
    expect(session?.email).toBe("valid@example.com");
  });

  test("returned session contains expiresAt", async () => {
    await createSession("user-789", "expiry@example.com");
    const [, token] = mockCookieStore.set.mock.calls[0];

    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session?.expiresAt).toBeDefined();
  });
});

describe("deleteSession", () => {
  test("deletes the auth-token cookie", async () => {
    await deleteSession();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  test("returns null when request has no cookie", async () => {
    const req = new NextRequest({});
    const session = await verifySession(req as any);
    expect(session).toBeNull();
  });

  test("returns null for an invalid token in request", async () => {
    const req = new NextRequest({ "auth-token": "bad.token.value" });
    const session = await verifySession(req as any);
    expect(session).toBeNull();
  });

  test("returns session payload for a valid token in request", async () => {
    await createSession("user-req", "req@example.com");
    const [, token] = mockCookieStore.set.mock.calls[0];

    const req = new NextRequest({ "auth-token": token });
    const session = await verifySession(req as any);

    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-req");
    expect(session?.email).toBe("req@example.com");
  });
});
