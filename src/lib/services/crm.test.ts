import { describe, expect, it } from "vitest";
import { addressOf, isPublicUrl } from "./crm";

describe("unsubscribe link target", () => {
  it("treats local dev URLs as not public", () => {
    for (const u of ["http://localhost:3000", "http://127.0.0.1:3000/", "http://[::1]:3000", "https://localhost"]) expect(isPublicUrl(u)).toBe(false);
  });
  it("treats deployed URLs as public", () => {
    for (const u of ["https://creator-outreach.vercel.app", "https://outreach.bhandarirupesh.com.np", "https://localhost-tools.example.com"])
      expect(isPublicUrl(u)).toBe(true);
  });
  it("extracts the address from a From header", () => {
    expect(addressOf("Rupesh <rupesh@bhandarirupesh.com.np>")).toBe("rupesh@bhandarirupesh.com.np");
    expect(addressOf(" rupesh@bhandarirupesh.com.np ")).toBe("rupesh@bhandarirupesh.com.np");
  });
});
