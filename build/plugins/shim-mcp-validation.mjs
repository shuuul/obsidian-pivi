/**
 * The MCP SDK defaults to AJV, whose runtime schema compiler uses new Function.
 * Replace that internal provider with the SDK's supported no-codegen validator.
 */
export const shimMcpValidation = {
  name: 'shim-mcp-validation',
  setup(build) {
    build.onLoad({ filter: /@modelcontextprotocol\/sdk\/dist\/(?:esm|cjs)\/validation\/ajv-provider\.js$/ }, () => ({
      contents: [
        "export { CfWorkerJsonSchemaValidator as AjvJsonSchemaValidator }",
        "  from '@modelcontextprotocol/sdk/validation/cfworker';",
      ].join('\n'),
      loader: 'js',
    }));
  },
};
