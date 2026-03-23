import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignUpForm } from "../SignUpForm";

const mockSignUp = vi.fn();
let mockIsLoading = false;

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    signUp: mockSignUp,
    get isLoading() {
      return mockIsLoading;
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIsLoading = false;
});

describe("SignUpForm rendering", () => {
  test("renders email, password, and confirm password fields", () => {
    render(<SignUpForm />);

    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByLabelText("Confirm Password")).toBeDefined();
  });

  test("renders a submit button with 'Sign Up' text", () => {
    render(<SignUpForm />);

    expect(screen.getByRole("button", { name: "Sign Up" })).toBeDefined();
  });

  test("renders password hint text", () => {
    render(<SignUpForm />);

    expect(screen.getByText("Must be at least 8 characters long")).toBeDefined();
  });

  test("does not show an error initially", () => {
    render(<SignUpForm />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SignUpForm loading state", () => {
  test("disables all inputs and button when isLoading is true", () => {
    mockIsLoading = true;
    render(<SignUpForm />);

    expect(screen.getByLabelText("Email")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Password")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Confirm Password")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  test("shows 'Creating account...' button text when isLoading is true", () => {
    mockIsLoading = true;
    render(<SignUpForm />);

    expect(screen.getByRole("button", { name: "Creating account..." })).toBeDefined();
  });
});

describe("SignUpForm validation", () => {
  test("shows error when passwords do not match", async () => {
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "different123");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeDefined();
    });
  });

  test("does not call signUp when passwords do not match", async () => {
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "different123");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(mockSignUp).not.toHaveBeenCalled();
    });
  });

  test("clears previous error on new submission attempt", async () => {
    render(<SignUpForm />);

    // First submission triggers password mismatch error
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "different123");
    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeDefined();
    });

    // Fix passwords to match and resubmit
    mockSignUp.mockResolvedValueOnce({ success: true });
    await userEvent.clear(screen.getByLabelText("Confirm Password"));
    await userEvent.type(screen.getByLabelText("Confirm Password"), "password123");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(screen.queryByText("Passwords do not match")).toBeNull();
    });
  });
});

describe("SignUpForm submission", () => {
  test("calls signUp with email and password when passwords match", async () => {
    mockSignUp.mockResolvedValueOnce({ success: true });
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "securepass");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "securepass");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith("user@example.com", "securepass");
    });
  });

  test("calls onSuccess when sign up succeeds", async () => {
    mockSignUp.mockResolvedValueOnce({ success: true });
    const onSuccess = vi.fn();
    render(<SignUpForm onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "securepass");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "securepass");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  test("does not call onSuccess when sign up fails", async () => {
    mockSignUp.mockResolvedValueOnce({ success: false, error: "Email already in use" });
    const onSuccess = vi.fn();
    render(<SignUpForm onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "securepass");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "securepass");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  test("displays error message returned from signUp on failure", async () => {
    mockSignUp.mockResolvedValueOnce({ success: false, error: "Email already in use" });
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText("Email"), "taken@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "securepass");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "securepass");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Email already in use")).toBeDefined();
    });
  });

  test("displays fallback error message when signUp fails without error string", async () => {
    mockSignUp.mockResolvedValueOnce({ success: false });
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "securepass");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "securepass");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Failed to sign up")).toBeDefined();
    });
  });

  test("does not call onSuccess when onSuccess prop is not provided", async () => {
    mockSignUp.mockResolvedValueOnce({ success: true });
    // Should not throw when onSuccess is undefined
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "securepass");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "securepass");

    fireEvent.submit(screen.getByRole("button", { name: "Sign Up" }).closest("form")!);

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledOnce();
    });
  });
});
