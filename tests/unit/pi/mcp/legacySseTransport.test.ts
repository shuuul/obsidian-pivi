import { createLegacySseTransport } from "@pivi/pivi-agent-core/mcp/legacySseTransport";

describe("createLegacySseTransport", () => {
  it("is exported and constructs an SSE transport with url and options", () => {
    const url = new URL("https://mcp.example.com/sse");
    const options = { requestInit: { headers: { Authorization: "Bearer x" } } };

    const transport = createLegacySseTransport(url, options);

    expect(typeof transport.start).toBe("function");
    expect(typeof transport.close).toBe("function");
  });

  it("uses empty options by default", () => {
    const transport = createLegacySseTransport(new URL("http://localhost:3001/sse"));

    expect(typeof transport.start).toBe("function");
    expect(typeof transport.close).toBe("function");
  });
});
