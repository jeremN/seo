import { describe, it, expect } from "vitest";
import { parseAllowlist, isAllowed } from "../src/auth.js";

describe("allowlist", () => {
  it("parses a comma/space separated var into lowercased logins", () => {
    expect(parseAllowlist("jeremN, Alice ")).toEqual(["jeremn", "alice"]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
  it("isAllowed is case-insensitive and exact", () => {
    const list = parseAllowlist("jeremN");
    expect(isAllowed("JeremN", list)).toBe(true);
    expect(isAllowed("jeremn", list)).toBe(true);
    expect(isAllowed("mallory", list)).toBe(false);
  });
  it("an empty allowlist denies everyone (fail closed)", () => {
    expect(isAllowed("anyone", [])).toBe(false);
  });
});
