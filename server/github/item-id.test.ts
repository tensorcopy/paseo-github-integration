import { describe, expect, it } from "vitest";
import { decodeItemId, encodeItemId } from "./item-id";

describe("item identity", () => {
  it("round-trips a host and GraphQL node id", () => {
    const encoded = encodeItemId("ghe.example.com", "PR_kwDOExample");
    expect(decodeItemId(encoded)).toEqual({
      hostname: "ghe.example.com",
      nodeId: "PR_kwDOExample",
    });
  });

  it("rejects pre-multi-host ids", () => {
    expect(() => decodeItemId("PR_kwDOExample")).toThrow("Refresh the dashboard");
  });
});
