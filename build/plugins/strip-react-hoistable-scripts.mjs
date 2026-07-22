import { readFile } from 'fs/promises';

const PREINIT_CREATION_BLOCK =
  /\(\(src = assign\(\{ src: src, async: !0(?:, type: "module")? \}, options\)\),[\s\S]*?ownerDocument\.head\.appendChild\(resource\)\)/g;

const ACQUIRE_SCRIPT_BLOCK =
  /[\w$]+ = [\w$]+\.createElement\("script"\);[\s\S]*?return \(resource\.instance = [\w$]+\);/;

const SCRIPT_CREATION = /createElement\(["']script["']\)/g;

/**
 * React 19's client bundle includes hoistable-script helpers that call
 * createElement("script"). Pivi never uses preinit or React <script> resources,
 * so remove those creation paths at build time for Obsidian community review.
 */
export const stripReactHoistableScripts = {
  name: 'strip-react-hoistable-scripts',
  setup(build) {
    build.onLoad(
      { filter: /[\\/]react-dom[\\/].*react-dom-client\.(production|development)\.js$/ },
      async (args) => {
        let src = await readFile(args.path, 'utf8');
        const scriptCreations = src.match(SCRIPT_CREATION) ?? [];

        if (scriptCreations.length !== 3) {
          throw new Error(
            `strip-react-hoistable-scripts: expected 3 createElement("script") sites in ${args.path}, found ${scriptCreations.length}`,
          );
        }

        src = src.replace(PREINIT_CREATION_BLOCK, '(resource = null)');
        src = src.replace(ACQUIRE_SCRIPT_BLOCK, 'return null;');

        if (SCRIPT_CREATION.test(src)) {
          throw new Error(
            `strip-react-hoistable-scripts: remaining createElement("script") in ${args.path}`,
          );
        }

        return { contents: src, loader: 'js' };
      },
    );
  },
};
