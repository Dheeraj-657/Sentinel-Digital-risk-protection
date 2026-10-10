import { describe, expect, it } from "vitest";
import { guessScanType } from "./scan-input";

describe("guessScanType", () => {
  it.each([
    ["https://acme-help.example/login", "WEBSITE"],
    ["acme-help.example/login", "WEBSITE"],
    ["acme-help.example", "DOMAIN"],
    ["@acme_support", "PROFILE"],
    ["instagram:acme_support", "PROFILE"],
    ["https://www.instagram.com/acme_support", "PROFILE"],
    ["https://x.com/acme", "PROFILE"],
    ["com.acme.wallet", "APP"],
    ["https://play.google.com/store/apps/details?id=com.acme.app", "APP"],
  ])("%s → %s", (input, type) => {
    expect(guessScanType(input)).toBe(type);
  });
});
