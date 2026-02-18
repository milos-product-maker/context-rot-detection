import { describe, it, expect } from "vitest";
import {
  getModelProfile,
  calculateQualityMultiplier,
  estimateRetrievalAccuracy,
  generateHeuristicProfile,
  KNOWN_MODELS,
} from "./degradation-curves.js";

describe("getModelProfile", () => {
  it("returns a known profile for claude-opus-4", () => {
    const profile = getModelProfile("claude-opus-4");
    expect(profile.name).toBe("Claude Opus 4");
    expect(profile.maxTokens).toBe(200_000);
  });

  it("returns fallback profile for unknown models", () => {
    const profile = getModelProfile("llama-4-maverick");
    expect(profile.name).toBe("Unknown Model");
    expect(profile.maxTokens).toBe(128_000);
  });

  it("KNOWN_MODELS contains all profiles except 'other'", () => {
    expect(KNOWN_MODELS).toContain("claude-opus-4");
    expect(KNOWN_MODELS).toContain("gpt-4.1");
    expect(KNOWN_MODELS).toContain("gemini-2.5-pro");
    expect(KNOWN_MODELS).not.toContain("other");
  });
});

describe("calculateQualityMultiplier", () => {
  const opus4 = getModelProfile("claude-opus-4");

  it("returns 1.0 when well below degradation onset", () => {
    expect(calculateQualityMultiplier(5_000, opus4)).toBe(1.0);
    expect(calculateQualityMultiplier(100_000, opus4)).toBe(1.0);
    expect(calculateQualityMultiplier(140_000, opus4)).toBe(1.0);
  });

  it("returns 1.0 at exactly the degradation onset", () => {
    expect(calculateQualityMultiplier(opus4.degradationOnset, opus4)).toBe(1.0);
  });

  it("returns less than 1.0 just above degradation onset", () => {
    const result = calculateQualityMultiplier(opus4.degradationOnset + 1_000, opus4);
    expect(result).toBeLessThan(1.0);
    expect(result).toBeGreaterThan(0.9);
  });

  it("returns 0.2 at maxTokens (floor)", () => {
    expect(calculateQualityMultiplier(opus4.maxTokens, opus4)).toBe(0.2);
  });

  it("returns 0.2 above maxTokens (floor)", () => {
    expect(calculateQualityMultiplier(opus4.maxTokens + 50_000, opus4)).toBe(0.2);
  });

  it("degrades monotonically between onset and maxTokens", () => {
    let prev = 1.0;
    for (
      let tokens = opus4.degradationOnset;
      tokens <= opus4.maxTokens;
      tokens += 5_000
    ) {
      const current = calculateQualityMultiplier(tokens, opus4);
      expect(current).toBeLessThanOrEqual(prev);
      prev = current;
    }
  });
});

describe("estimateRetrievalAccuracy", () => {
  const opus4 = getModelProfile("claude-opus-4");

  it("returns near base accuracy at low token counts", () => {
    const accuracy = estimateRetrievalAccuracy(5_000, opus4);
    expect(accuracy).toBeCloseTo(opus4.baseRetrievalAccuracy, 2);
  });

  it("degrades past the onset threshold", () => {
    const before = estimateRetrievalAccuracy(opus4.degradationOnset, opus4);
    const after = estimateRetrievalAccuracy(opus4.degradationOnset + 20_000, opus4);
    expect(after).toBeLessThan(before);
  });

  it("never returns below 0.1", () => {
    const accuracy = estimateRetrievalAccuracy(opus4.maxTokens + 100_000, opus4);
    expect(accuracy).toBeGreaterThanOrEqual(0.1);
  });

  it("applies middle-loss penalty in the danger zone", () => {
    // At danger zone, there should be a meaningful penalty from middleLossCoefficient
    const atDanger = estimateRetrievalAccuracy(opus4.dangerZone, opus4);
    const qualityMult = calculateQualityMultiplier(opus4.dangerZone, opus4);
    const pureQuality = opus4.baseRetrievalAccuracy * qualityMult;
    // With middle loss, result should be below pure quality * base accuracy
    expect(atDanger).toBeLessThan(pureQuality);
  });
});

describe("generateHeuristicProfile", () => {
  it("generates correct heuristic ratios", () => {
    const profile = generateHeuristicProfile("test/model", 131_072);
    expect(profile.name).toBe("test/model");
    expect(profile.maxTokens).toBe(131_072);
    expect(profile.degradationOnset).toBe(Math.round(131_072 * 0.65));
    expect(profile.dangerZone).toBe(Math.round(131_072 * 0.80));
    expect(profile.middleLossCoefficient).toBe(0.40);
    expect(profile.baseRetrievalAccuracy).toBe(0.90);
  });

  it("works with large context windows (1M+)", () => {
    const profile = generateHeuristicProfile("big/model", 1_000_000);
    expect(profile.maxTokens).toBe(1_000_000);
    expect(profile.degradationOnset).toBe(650_000);
    expect(profile.dangerZone).toBe(800_000);
  });

  it("works with small context windows", () => {
    const profile = generateHeuristicProfile("small/model", 2_048);
    expect(profile.maxTokens).toBe(2_048);
    expect(profile.degradationOnset).toBe(Math.round(2_048 * 0.65));
    expect(profile.dangerZone).toBe(Math.round(2_048 * 0.80));
  });
});
