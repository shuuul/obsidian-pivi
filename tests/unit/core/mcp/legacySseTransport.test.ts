const mockSseTransport = jest.fn();

jest.mock(
  "@modelcontextprotocol/sdk/client/sse.js",
  () => ({
    SSEClientTransport: mockSseTransport,
  }),
  { virtual: true },
);

import { createLegacySseTransport } from "../../../../src/pi/mcp/legacySseTransport";

describe("createLegacySseTransport", () => {
  beforeEach(() => {
    mockSseTransport.mockClear();
    mockSseTransport.mockImplementation(function MockTransport(this: unknown) {
      return { start: jest.fn(), close: jest.fn() };
    });
  });

  it("is exported and constructs SSEClientTransport with url and options", () => {
    const url = new URL("https://mcp.example.com/sse");
    const options = { requestInit: { headers: { Authorization: "Bearer x" } } };

    const transport = createLegacySseTransport(url, options);

    expect(mockSseTransport).toHaveBeenCalledWith(url, options);
    expect(transport).toBeDefined();
  });

  it("uses empty options by default", () => {
    createLegacySseTransport(new URL("http://localhost:3001/sse"));

    expect(mockSseTransport).toHaveBeenCalledWith(expect.any(URL), {});
  });
});
