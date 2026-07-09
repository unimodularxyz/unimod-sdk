import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { explainError, messageForError } from "../../src/errors.js";

describe("errors", () => {
  it("messageForError knows the catalog and falls back gracefully", () => {
    expect(messageForError("UnhealthyPosition")).toMatch(/undercollateralized/);
    expect(messageForError("NotInCatalog")).toBe("Transaction reverted (NotInCatalog).");
    expect(messageForError(undefined)).toBe("Transaction failed.");
  });

  it("explainError decodes a bare custom-error selector to its name + message", () => {
    const selector = toFunctionSelector("HealthyPosition()" as never);
    const msg = explainError(new Error(`execution reverted with reason: ${selector}`));
    expect(msg).toMatch(/^HealthyPosition:/);
    expect(msg).toMatch(/can't be liquidated/);
  });

  it("explainError keeps ordinary errors readable", () => {
    expect(explainError(new Error("boom"))).toContain("boom");
    expect(explainError("plain string")).toContain("plain string");
  });
});
