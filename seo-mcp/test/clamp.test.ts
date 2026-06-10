import { describe, it, expect } from "vitest";
import { clampMaxPages, MAX_PAGES_DEFAULT, MAX_PAGES_HARD_CAP } from "../src/clamp.js";

describe("clampMaxPages", () => {
  it("defaults when undefined", () => {
    expect(clampMaxPages(undefined)).toBe(MAX_PAGES_DEFAULT);
  });
  it("floors to a positive integer", () => {
    expect(clampMaxPages(12.9)).toBe(12);
  });
  it("rejects non-positive / NaN to the default", () => {
    expect(clampMaxPages(0)).toBe(MAX_PAGES_DEFAULT);
    expect(clampMaxPages(-5)).toBe(MAX_PAGES_DEFAULT);
    expect(clampMaxPages(NaN)).toBe(MAX_PAGES_DEFAULT);
  });
  it("caps at the hard maximum", () => {
    expect(clampMaxPages(MAX_PAGES_HARD_CAP * 50)).toBe(MAX_PAGES_HARD_CAP);
  });
});
