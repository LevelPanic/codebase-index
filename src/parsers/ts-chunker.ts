import type Parser from "tree-sitter";
import { parse } from "./tree-sitter.js";

export interface RawChunk {
  exportName: string;
  chunkType:
    | "function"
    | "component"
    | "hook"
    | "store"
    | "type"
    | "config"
    | "class"
    | "method"
    | "summary"
    | "model";
  content: string;
  startLine: number;
  endLine: number;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function hasJsx(node: Parser.SyntaxNode): boolean {
  if (
    node.type === "jsx_element" ||
    node.type === "jsx_self_closing_element" ||
    node.type === "jsx_fragment"
  ) {
    return true;
  }
  for (const child of node.children) {
    if (hasJsx(child)) return true;
  }
  return false;
}

/** Extract the assigned name from a variable declaration (const foo = ...) */
function extractVarName(node: Parser.SyntaxNode): string | null {
  if (
    node.type !== "lexical_declaration" &&
    node.type !== "variable_declaration"
  ) {
    return null;
  }
  const declarator = node.children.find(
    (c) => c.type === "variable_declarator",
  );
  if (!declarator) return null;
  return declarator.childForFieldName("name")?.text ?? null;
}

/** Extract the value node from a variable declaration */
function extractVarValue(
  node: Parser.SyntaxNode,
): Parser.SyntaxNode | null {
  const declarator = node.children.find(
    (c) => c.type === "variable_declarator",
  );
  if (!declarator) return null;
  return declarator.childForFieldName("value") ?? null;
}

/** Check if a variable declaration holds a function/arrow/call expression */
function isVarFunction(node: Parser.SyntaxNode): boolean {
  const value = extractVarValue(node);
  if (!value) return false;
  return (
    value.type === "arrow_function" ||
    value.type === "function_expression" ||
    value.type === "call_expression"
  );
}

/** Check if a variable declaration holds a plain object literal */
function isVarObject(node: Parser.SyntaxNode): boolean {
  const value = extractVarValue(node);
  if (!value) return false;
  // Direct object literal
  if (value.type === "object") return true;
  // `as const` / `satisfies X` wrapping an object
  if (value.type === "as_expression" || value.type === "satisfies_expression") {
    const inner = value.children[0];
    return inner?.type === "object";
  }
  return false;
}

/** Check if a variable holds an array literal */
function isVarArray(node: Parser.SyntaxNode): boolean {
  const value = extractVarValue(node);
  if (!value) return false;
  if (value.type === "array") return true;
  if (value.type === "as_expression" || value.type === "satisfies_expression") {
    const inner = value.children[0];
    return inner?.type === "array";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Chunk type detection
// ---------------------------------------------------------------------------

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

function isStoreName(name: string): boolean {
  return /^(use.+Store|create.+Store|.+Store|.+Slice)$/.test(name);
}

function isStoreCall(node: Parser.SyntaxNode): boolean {
  const value = extractVarValue(node);
  if (!value || value.type !== "call_expression") return false;
  const callee = value.childForFieldName("function")?.text ?? "";
  return /^(create|createStore|createSlice|defineStore)$/.test(callee);
}

function inferChunkType(
  name: string,
  node: Parser.SyntaxNode,
  isTsx: boolean,
): RawChunk["chunkType"] {
  if (isStoreName(name) || isStoreCall(node)) return "store";
  if (isHookName(name)) return "hook";
  if (isTsx && hasJsx(node)) return "component";
  return "function";
}

// ---------------------------------------------------------------------------
// Smart truncation: keep signature + head + tail instead of just head
// ---------------------------------------------------------------------------

function smartTruncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const lines = content.split("\n");

  // Find signature end (first { or => on its own line, or first few lines)
  let sigEnd = Math.min(5, lines.length);
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    if (lines[i]!.trimEnd().endsWith("{") || lines[i]!.includes("=>")) {
      sigEnd = i + 1;
      break;
    }
  }

  const sigLines = lines.slice(0, sigEnd);
  const sigLen = sigLines.join("\n").length;

  // Budget remaining chars between head body and tail
  const remaining = maxChars - sigLen - 30; // 30 for the truncation marker
  if (remaining <= 0) {
    return lines.slice(0, sigEnd).join("\n") + "\n// ... truncated";
  }

  const headBudget = Math.floor(remaining * 0.6);
  const tailBudget = remaining - headBudget;

  // Head: lines after signature
  const bodyLines = lines.slice(sigEnd);
  let headEnd = 0;
  let headLen = 0;
  for (let i = 0; i < bodyLines.length; i++) {
    if (headLen + bodyLines[i]!.length + 1 > headBudget) break;
    headLen += bodyLines[i]!.length + 1;
    headEnd = i + 1;
  }

  // Tail: lines from the end
  let tailStart = bodyLines.length;
  let tailLen = 0;
  for (let i = bodyLines.length - 1; i >= headEnd; i--) {
    if (tailLen + bodyLines[i]!.length + 1 > tailBudget) break;
    tailLen += bodyLines[i]!.length + 1;
    tailStart = i;
  }

  const parts = [...sigLines, ...bodyLines.slice(0, headEnd)];
  if (tailStart > headEnd) {
    parts.push("  // ... truncated ...");
    parts.push(...bodyLines.slice(tailStart));
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Import/type context extraction
// ---------------------------------------------------------------------------

function extractImportContext(source: string): Map<string, string> {
  // Build a map of imported names → import source for context injection
  const imports = new Map<string, string>();
  const importRegex =
    /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))(?:\s*,\s*\{([^}]+)\})?\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const names = [match[1], match[2], match[3]]
      .filter(Boolean)
      .flatMap((s) => s!.split(",").map((n) => n.trim().split(" as ")[0]!.trim()))
      .filter(Boolean);
    const from = match[4]!;
    for (const name of names) {
      imports.set(name, from);
    }
  }
  return imports;
}

function buildContextPreamble(
  chunkContent: string,
  typeChunks: RawChunk[],
  importMap: Map<string, string>,
): string {
  // Find type/interface names referenced in the chunk
  const referenced: string[] = [];

  for (const typeChunk of typeChunks) {
    // Check if the chunk references this type name (as a word boundary match)
    const regex = new RegExp(`\\b${typeChunk.exportName}\\b`);
    if (regex.test(chunkContent)) {
      // Include short type definitions inline (< 200 chars), reference longer ones
      if (typeChunk.content.length < 200) {
        referenced.push(typeChunk.content);
      } else {
        // Find import source or just note the type exists
        const src = importMap.get(typeChunk.exportName);
        referenced.push(
          `// type ${typeChunk.exportName}${src ? ` from "${src}"` : ""} (${typeChunk.endLine - typeChunk.startLine + 1} lines)`,
        );
      }
    }
  }

  return referenced.length > 0
    ? "// Referenced types:\n" + referenced.join("\n") + "\n\n"
    : "";
}

// ---------------------------------------------------------------------------
// Barrel file detection
// ---------------------------------------------------------------------------

function isBarrelFile(source: string, filePath: string): boolean {
  if (!filePath.endsWith("index.ts") && !filePath.endsWith("index.js")) {
    return false;
  }
  const lines = source
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("//"));
  if (lines.length > 20) return false;
  return lines.every(
    (l) =>
      l.startsWith("export ") ||
      l.startsWith("import ") ||
      l.trim() === "",
  );
}

// ---------------------------------------------------------------------------
// Class method extraction
// ---------------------------------------------------------------------------

function chunkClass(
  node: Parser.SyntaxNode,
  className: string,
  maxChars: number,
  isTsx: boolean,
): RawChunk[] {
  const chunks: RawChunk[] = [];
  const body = node.childForFieldName("body");
  if (!body) {
    // No body, just chunk the whole class
    chunks.push({
      exportName: className,
      chunkType: "class",
      content: smartTruncate(node.text, maxChars),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
    return chunks;
  }

  // Extract the class signature (decorators + class line + heritage)
  const sigLines = node.text
    .split("\n")
    .slice(0, body.startPosition.row - node.startPosition.row + 1);
  const classSig = sigLines.join("\n");

  // If the class is small enough, keep it as one chunk
  if (node.text.length <= maxChars) {
    chunks.push({
      exportName: className,
      chunkType: "class",
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
    return chunks;
  }

  // Class is big — extract individual methods
  // First, add a class overview chunk
  const methodNames: string[] = [];
  for (const child of body.children) {
    if (
      child.type === "method_definition" ||
      child.type === "public_field_definition"
    ) {
      const name = child.childForFieldName("name")?.text;
      if (name) methodNames.push(name);
    }
  }

  chunks.push({
    exportName: className,
    chunkType: "class",
    content: smartTruncate(
      `${classSig}\n  // Methods: ${methodNames.join(", ")}\n}`,
      maxChars,
    ),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  });

  // Then extract each method
  for (const child of body.children) {
    if (child.type === "method_definition") {
      const name = child.childForFieldName("name")?.text ?? "anonymous";
      const isComponent = isTsx && hasJsx(child);
      chunks.push({
        exportName: `${className}.${name}`,
        chunkType: isComponent ? "component" : "method",
        content: smartTruncate(
          `// Method of class ${className}\n${child.text}`,
          maxChars,
        ),
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
      });
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Main chunker
// ---------------------------------------------------------------------------

export function chunkTypeScript(
  source: string,
  isTsx: boolean,
  maxChunkChars: number,
  filePath?: string,
): RawChunk[] {
  // Skip barrel files — they're just re-exports with no useful content
  if (filePath && isBarrelFile(source, filePath)) {
    return [
      {
        exportName: "file_summary",
        chunkType: "summary",
        content: source.slice(0, maxChunkChars),
        startLine: 1,
        endLine: source.split("\n").length,
      },
    ];
  }

  const tree = parse(source, isTsx);
  const root = tree.rootNode;
  const chunks: RawChunk[] = [];
  const coveredRanges: Set<number> = new Set();
  const importMap = extractImportContext(source);

  // First pass: collect type chunks for context injection
  const typeChunks: RawChunk[] = [];

  function markCovered(node: Parser.SyntaxNode) {
    for (let i = node.startPosition.row; i <= node.endPosition.row; i++) {
      coveredRanges.add(i);
    }
  }

  function processDeclaration(
    node: Parser.SyntaxNode,
    declaration: Parser.SyntaxNode,
    isExported: boolean,
  ) {
    // Type/interface/enum
    if (
      declaration.type === "type_alias_declaration" ||
      declaration.type === "interface_declaration" ||
      declaration.type === "enum_declaration"
    ) {
      const name =
        declaration.childForFieldName("name")?.text ??
        declaration.children.find(
          (c) => c.type === "type_identifier" || c.type === "identifier",
        )?.text ??
        "anonymous";
      const chunk: RawChunk = {
        exportName: name,
        chunkType: "type",
        content: smartTruncate(node.text, maxChunkChars),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      };
      chunks.push(chunk);
      typeChunks.push(chunk);
      markCovered(node);
      return true;
    }

    // Class declarations — method-level extraction
    if (declaration.type === "class_declaration") {
      const name =
        declaration.childForFieldName("name")?.text ?? "anonymous";
      const classChunks = chunkClass(
        declaration,
        name,
        maxChunkChars,
        isTsx,
      );
      chunks.push(...classChunks);
      markCovered(node);
      return true;
    }

    // Function declarations
    if (declaration.type === "function_declaration") {
      const name =
        declaration.childForFieldName("name")?.text ?? "anonymous";
      chunks.push({
        exportName: name,
        chunkType: inferChunkType(name, declaration, isTsx),
        content: smartTruncate(node.text, maxChunkChars),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
      markCovered(node);
      return true;
    }

    // Variable declarations (const/let)
    if (
      declaration.type === "lexical_declaration" ||
      declaration.type === "variable_declaration"
    ) {
      const name = extractVarName(declaration);
      if (!name) return false;

      // Functions / arrow functions / call expressions
      if (isVarFunction(declaration)) {
        chunks.push({
          exportName: name,
          chunkType: inferChunkType(name, declaration, isTsx),
          content: smartTruncate(node.text, maxChunkChars),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        markCovered(node);
        return true;
      }

      // Plain objects (configs, route maps, constant objects)
      if (isVarObject(declaration) || isVarArray(declaration)) {
        // Only chunk if it's substantial (> 3 lines)
        const lineCount =
          node.endPosition.row - node.startPosition.row + 1;
        if (lineCount >= 3) {
          chunks.push({
            exportName: name,
            chunkType: "config",
            content: smartTruncate(node.text, maxChunkChars),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          markCovered(node);
          return true;
        }
      }

      return false;
    }

    return false;
  }

  // Main traversal
  for (const node of root.children) {
    // Direct declarations (not wrapped in export)
    if (
      node.type === "type_alias_declaration" ||
      node.type === "interface_declaration" ||
      node.type === "enum_declaration" ||
      node.type === "class_declaration" ||
      node.type === "function_declaration" ||
      node.type === "lexical_declaration" ||
      node.type === "variable_declaration"
    ) {
      processDeclaration(node, node, false);
      continue;
    }

    // Export statements
    if (node.type === "export_statement") {
      const declaration =
        node.childForFieldName("declaration") ?? node.children[1];
      if (declaration) {
        processDeclaration(node, declaration, true);
      }
      continue;
    }
  }

  // Second pass: inject type context into function/component/hook chunks
  for (const chunk of chunks) {
    if (
      chunk.chunkType === "function" ||
      chunk.chunkType === "component" ||
      chunk.chunkType === "hook" ||
      chunk.chunkType === "method"
    ) {
      const preamble = buildContextPreamble(
        chunk.content,
        typeChunks,
        importMap,
      );
      if (preamble) {
        chunk.content = smartTruncate(
          preamble + chunk.content,
          maxChunkChars,
        );
      }
    }
  }

  // Batch small type chunks together to reduce embedding calls
  const smallTypeChunks = chunks.filter(
    (c) => c.chunkType === "type" && c.content.length < 150,
  );
  if (smallTypeChunks.length >= 3) {
    // Remove individual small type chunks and replace with one batched chunk
    const batchedContent = smallTypeChunks
      .map((c) => c.content)
      .join("\n\n");
    if (batchedContent.length <= maxChunkChars) {
      const names = smallTypeChunks.map((c) => c.exportName).join(", ");
      // Remove the small ones
      for (const sc of smallTypeChunks) {
        const idx = chunks.indexOf(sc);
        if (idx !== -1) chunks.splice(idx, 1);
      }
      // Add the batched one
      chunks.push({
        exportName: `types(${names})`,
        chunkType: "type",
        content: batchedContent,
        startLine: smallTypeChunks[0]!.startLine,
        endLine: smallTypeChunks[smallTypeChunks.length - 1]!.endLine,
      });
    }
  }

  // File summary
  const lines = source.split("\n");
  const summaryParts: string[] = [];

  const importLines = lines
    .filter(
      (l) =>
        l.startsWith("import ") ||
        l.startsWith("export {") ||
        l.startsWith("export *"),
    )
    .slice(0, 30);
  if (importLines.length > 0) {
    summaryParts.push(importLines.join("\n"));
  }

  if (chunks.length > 0) {
    const exports = chunks
      .map((c) => `${c.chunkType}: ${c.exportName}`)
      .join(", ");
    summaryParts.push(`// Exports: ${exports}`);
  }

  if (summaryParts.length > 0) {
    chunks.push({
      exportName: "file_summary",
      chunkType: "summary",
      content: smartTruncate(summaryParts.join("\n\n"), maxChunkChars),
      startLine: 1,
      endLine: lines.length,
    });
  }

  return chunks;
}
