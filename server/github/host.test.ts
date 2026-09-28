import { describe, expect, it } from "vitest";
import { parseGithubAccounts } from "./host";

describe("parseGithubAccounts", () => {
  it("returns the active successful account for every authenticated host", () => {
    expect(
      parseGithubAccounts({
        hosts: {
          "ghe.example.com": [
            { state: "success", active: true, login: "octocat-enterprise" },
            { state: "success", active: false, login: "other" },
          ],
          "github.com": [{ state: "success", active: true, login: "octocat" }],
          "broken.example": [{ state: "failed", active: true, login: "broken" }],
        },
      }),
    ).toEqual([
      { hostname: "ghe.example.com", login: "octocat-enterprise" },
      { hostname: "github.com", login: "octocat" },
    ]);
  });
});
