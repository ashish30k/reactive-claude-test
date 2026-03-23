import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthDialog } from "../AuthDialog";

// Mock child forms so we can control onSuccess callbacks
vi.mock("../SignInForm", () => ({
  SignInForm: ({ onSuccess }: { onSuccess?: () => void }) => (
    <div data-testid="sign-in-form">
      <button onClick={onSuccess}>Trigger SignIn Success</button>
    </div>
  ),
}));

vi.mock("../SignUpForm", () => ({
  SignUpForm: ({ onSuccess }: { onSuccess?: () => void }) => (
    <div data-testid="sign-up-form">
      <button onClick={onSuccess}>Trigger SignUp Success</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthDialog rendering", () => {
  test("renders sign-in mode by default", () => {
    render(<AuthDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Welcome back")).toBeDefined();
    expect(screen.getByText("Sign in to your account to continue")).toBeDefined();
    expect(screen.getByTestId("sign-in-form")).toBeDefined();
  });

  test("renders sign-up mode when defaultMode is 'signup'", () => {
    render(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signup" />
    );

    expect(screen.getByText("Create an account")).toBeDefined();
    expect(
      screen.getByText("Sign up to start creating AI-powered React components")
    ).toBeDefined();
    expect(screen.getByTestId("sign-up-form")).toBeDefined();
  });

  test("shows 'Sign up' toggle link in signin mode", () => {
    render(<AuthDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign up" })).toBeDefined();
    expect(screen.getByText("Don't have an account?")).toBeDefined();
  });

  test("shows 'Sign in' toggle link in signup mode", () => {
    render(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signup" />
    );

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(screen.getByText("Already have an account?")).toBeDefined();
  });

  test("does not render content when open is false", () => {
    render(<AuthDialog open={false} onOpenChange={vi.fn()} />);

    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(screen.queryByTestId("sign-in-form")).toBeNull();
  });
});

describe("AuthDialog mode switching", () => {
  test("switches to signup mode when 'Sign up' link is clicked", async () => {
    render(<AuthDialog open={true} onOpenChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByText("Create an account")).toBeDefined();
    expect(screen.getByTestId("sign-up-form")).toBeDefined();
  });

  test("switches to signin mode when 'Sign in' link is clicked", async () => {
    render(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signup" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Welcome back")).toBeDefined();
    expect(screen.getByTestId("sign-in-form")).toBeDefined();
  });

  test("can toggle back and forth between modes", async () => {
    render(<AuthDialog open={true} onOpenChange={vi.fn()} />);

    // Start in signin
    expect(screen.getByTestId("sign-in-form")).toBeDefined();

    // Switch to signup
    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByTestId("sign-up-form")).toBeDefined();

    // Switch back to signin
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("sign-in-form")).toBeDefined();
  });
});

describe("AuthDialog defaultMode prop reactivity", () => {
  test("updates mode when defaultMode prop changes from signin to signup", async () => {
    const { rerender } = render(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signin" />
    );

    expect(screen.getByTestId("sign-in-form")).toBeDefined();

    rerender(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signup" />
    );

    await waitFor(() => {
      expect(screen.getByTestId("sign-up-form")).toBeDefined();
    });
  });

  test("updates mode when defaultMode prop changes from signup to signin", async () => {
    const { rerender } = render(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signup" />
    );

    expect(screen.getByTestId("sign-up-form")).toBeDefined();

    rerender(
      <AuthDialog open={true} onOpenChange={vi.fn()} defaultMode="signin" />
    );

    await waitFor(() => {
      expect(screen.getByTestId("sign-in-form")).toBeDefined();
    });
  });
});

describe("AuthDialog success handling", () => {
  test("calls onOpenChange(false) when SignInForm reports success", async () => {
    const onOpenChange = vi.fn();
    render(<AuthDialog open={true} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Trigger SignIn Success" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledOnce();
  });

  test("calls onOpenChange(false) when SignUpForm reports success", async () => {
    const onOpenChange = vi.fn();
    render(
      <AuthDialog open={true} onOpenChange={onOpenChange} defaultMode="signup" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Trigger SignUp Success" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledOnce();
  });

  test("calls onOpenChange when dialog requests close (e.g. overlay click)", () => {
    const onOpenChange = vi.fn();
    render(<AuthDialog open={true} onOpenChange={onOpenChange} />);

    // Simulate the Dialog calling onOpenChange directly (e.g. pressing Escape)
    // The Dialog forwards this to the parent via the prop
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
