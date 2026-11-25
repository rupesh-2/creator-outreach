import { describe, expect, it } from "vitest";
import { countryOf, detectLanguage, inferRegion, inTargetRegion } from "./region";

describe("countryOf", () => {
  it.each([
    ["Manhattan, New York", "US"],
    ["Jupiter, Florida", "US"],
    ["Austin, TX", "US"],
    ["Melbourne, Victoria, Australia", "AU"],
    ["Melbourne, Florida", "US"],
    ["Victoria, British Columbia", "CA"],
    ["Calgary Alberta, Canada", "CA"],
    ["Bondi Beach, Sydney", "AU"],
    ["Bandung", "ID"],
    ["Istanbul, Turkey", "TR"],
    ["Parda Bcn", "ES"],
    ["Music Rhythm K", null],
    ["おすすめ", null],
  ])("%s → %s", (text, cc) => expect(countryOf(text)).toBe(cc));
});

describe("inferRegion", () => {
  it("uses repeated post location tags", () => {
    const r = inferRegion({ locations: Array(9).fill("Manhattan, New York") });
    expect(r.country).toBe("US");
    expect(r.evidence).toContain("Manhattan, New York");
  });
  it("uses flags and places in the bio", () => {
    expect(inferRegion({ bio: "Sydney based PT 🇦🇺 | meal prep" }).country).toBe("AU");
  });
  it("uses TikTok per-video country codes", () => {
    expect(inferRegion({ countryCodes: ["AU", "AU", "AU"] }).country).toBe("AU");
  });
  it("returns unknown when signals conflict or are weak", () => {
    expect(inferRegion({ locations: ["Tampa, Florida", "Toronto"] }).country).toBeNull();
    expect(inferRegion({ bio: "fitness coach" }).country).toBeNull();
  });
});

describe("detectLanguage", () => {
  it("detects English captions", () => {
    expect(detectLanguage(["Here is my high protein meal prep for the week, all you need is chicken and rice. Save this for later and tag a friend who loves to cook."])).toBe("en");
  });
  it("detects non-English captions", () => {
    expect(detectLanguage(["Gerak sambil rebahan untuk pemula, terima kasih atas kunjungan anda, spill produk di keranjang kuning ya kak semoga bermanfaat"])).toBe("other");
    expect(detectLanguage(["Nutriólogo y entrenador, programas personalizados de nutrición y entrenamiento para alcanzar tus metas con disciplina"])).toBe("other");
  });
  it("returns null when there's too little text", () => expect(detectLanguage(["gym 💪"])).toBeNull());
});

describe("inTargetRegion", () => {
  const targets = ["US", "AU"];
  it("allows matching countries and English-speaking unknowns", () => {
    expect(inTargetRegion({ country: "AU" }, targets)).toBe(true);
    expect(inTargetRegion({ country: null, language: "en" }, targets)).toBe(true);
  });
  it("excludes other countries and non-English unknowns", () => {
    expect(inTargetRegion({ country: "ID", language: "other" }, targets)).toBe(false);
    expect(inTargetRegion({ country: "CA", language: "en" }, targets)).toBe(false);
    expect(inTargetRegion({ country: null, language: "other" }, targets)).toBe(false);
    expect(inTargetRegion({ country: null, language: null }, targets)).toBe(false);
  });
  it("allows everyone when no targets are set", () => expect(inTargetRegion({ country: "ID" }, [])).toBe(true));
});
