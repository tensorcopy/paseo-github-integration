import { describe, expect, it } from "vitest";
import { tokenHostname } from "./images";

describe("tokenHostname", () => {
  it("sends the github.com token to the githubusercontent CDNs", () => {
    // gh is never logged in to a CDN hostname, so asking it for one would
    // fail and take the image with it.
    expect(tokenHostname("private-user-images.githubusercontent.com")).toBe("github.com");
    expect(tokenHostname("raw.githubusercontent.com")).toBe("github.com");
  });

  it("keeps every other host's token on that host", () => {
    expect(tokenHostname("github.com")).toBe("github.com");
    expect(tokenHostname("ghe.example.com")).toBe("ghe.example.com");
  });
});
