import { describe, it, expect } from "vitest";
import { clampMaxPages } from "../src/clamp.js";

describe("clampMaxPages", () => {
  it("defaults to 50 when undefined", () => {
    expect(clampMaxPages(undefined)).toBe(50);
  });
  it("floors to a positive integer", () => {
    expect(clampMaxPages(12.9)).toBe(12);
  });
  it("rejects non-positive / NaN to the default", () => {
    expect(clampMaxPages(0)).toBe(50);
    expect(clampMaxPages(-5)).toBe(50);
    expect(clampMaxPages(NaN)).toBe(50);
  });
  it("caps at the hard maximum of 200", () => {
    expect(clampMaxPages(10000)).toBe(200);
  });
});
