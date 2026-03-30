import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// Common interface that both native and WASM tree-sitter provide
export interface SyntaxNode {
  type: string;
  text: string;
  children: SyntaxNode[];
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childForFieldName(name: string): SyntaxNode | null;
}

export interface Tree {
  rootNode: SyntaxNode;
}

interface ParserBackend {
  parse(source: string, isTsx: boolean): Tree;
}

// ---------------------------------------------------------------------------
// Native backend (tree-sitter + tree-sitter-typescript)
// Faster, requires native compilation. Available when cloned + npm install.
// ---------------------------------------------------------------------------

function tryNativeBackend(): ParserBackend | null {
  try {
    const require = createRequire(import.meta.url);
    const Parser = require("tree-sitter");
    const TypeScript = require("tree-sitter-typescript");

    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);

    const tsxParser = new Parser();
    tsxParser.setLanguage(TypeScript.tsx);

    return {
      parse(source: string, isTsx: boolean): Tree {
        const parser = isTsx ? tsxParser : tsParser;
        return parser.parse(source) as Tree;
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WASM backend (web-tree-sitter)
// Slower, but zero native deps. Always available.
// ---------------------------------------------------------------------------

async function initWasmBackend(): Promise<ParserBackend> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const wasmDir = path.resolve(__dirname, "../../wasm");

  const WebTreeSitter = (await import("web-tree-sitter")).default;
  await WebTreeSitter.init();

  const tsLang = await WebTreeSitter.Language.load(
    path.join(wasmDir, "tree-sitter-typescript.wasm"),
  );
  const tsxLang = await WebTreeSitter.Language.load(
    path.join(wasmDir, "tree-sitter-tsx.wasm"),
  );

  const tsParser = new WebTreeSitter();
  tsParser.setLanguage(tsLang);

  const tsxParser = new WebTreeSitter();
  tsxParser.setLanguage(tsxLang);

  return {
    parse(source: string, isTsx: boolean): Tree {
      const parser = isTsx ? tsxParser : tsParser;
      const tree = parser.parse(source);
      // web-tree-sitter and native tree-sitter have compatible but separately typed APIs
      return tree as unknown as Tree;
    },
  };
}

// ---------------------------------------------------------------------------
// Exported parse — lazy init, native first with WASM fallback
// ---------------------------------------------------------------------------

let backend: ParserBackend | null = null;
let backendInit: Promise<ParserBackend> | null = null;
let backendType: "native" | "wasm" | null = null;

async function getBackend(): Promise<ParserBackend> {
  if (backend) return backend;

  if (!backendInit) {
    backendInit = (async () => {
      const native = tryNativeBackend();
      if (native) {
        backendType = "native";
        backend = native;
        return native;
      }

      const wasm = await initWasmBackend();
      backendType = "wasm";
      backend = wasm;
      return wasm;
    })();
  }

  return backendInit;
}

export async function parse(source: string, isTsx: boolean): Promise<Tree> {
  const b = await getBackend();
  return b.parse(source, isTsx);
}

export function getBackendType(): "native" | "wasm" | null {
  return backendType;
}
