import { describe, expect, it } from "vitest";
import { validateConfigObjectWithPlugins } from "./config.js";

describe("easy mode config validation", () => {
  it("applies Easy Mode restrictions from the explicit validation env", () => {
    const result = validateConfigObjectWithPlugins(
      {
        channels: {
          discord: {
            token: "nope",
          },
        },
      },
      {
        env: {
          OPENCLAW_PRODUCT_MODE: "easy-mode-mac",
        },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "channels.discord" })]),
    );
  });
});
