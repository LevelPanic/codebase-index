import type Parser from "tree-sitter";
import { parse } from "./tree-sitter.js";

export interface RawChunk {
  exportName: string;
  chunkType: "function" | "component" | "type" | "summary" | "model";
  content: string;
  startLine: number;
  endLine: number;
}

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

function extractName(node: Parser.SyntaxNode): string | null {
  if (node.type === "function_declaration") {
    return node.childForFieldName("name")?.text ?? null;
  }

  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    const declarator = node.children.find(
      (c) => c.type === "variable_declarator",
    );
    if (declarator) {
      const nameNode = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");
      if (nameNode && value) {
        if (
          value.type === "arrow_function" ||
          value.type === "function_expression" ||
          value.type === "call_expression"
        ) {
          return nameNode.text;
        }
      }
    }
  }

  return null;
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n// ... truncated";
}

export function chunkTypeScript(
  source: string,
  isTsx: boolean,
  maxChunkChars: number,
): RawChunk[] {
  const tree = parse(source, isTsx);
  const root = tree.rootNode;
  const chunks: RawChunk[] = [];
  const coveredRanges: Set<number> = new Set();

  for (const node of root.children) {
    // Type/interface/enum definitions
    if (
      node.type === "type_alias_declaration" ||
      node.type === "interface_declaration" ||
      node.type === "enum_declaration"
    ) {
      const name =
        node.childForFieldName("name")?.text ??
        node.children.find(
          (c) => c.type === "type_identifier" || c.type === "identifier",
        )?.text ??
        "anonymous";
      chunks.push({
        exportName: name,
        chunkType: "type",
        content: truncateContent(node.text, maxChunkChars),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
      for (let i = node.startPosition.row; i <= node.endPosition.row; i++) {
        coveredRanges.add(i);
      }
      continue;
    }

    // Function declarations
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text ?? "anonymous";
      const isComponent = isTsx && hasJsx(node);
      chunks.push({
        exportName: name,
        chunkType: isComponent ? "component" : "function",
        content: truncateContent(node.text, maxChunkChars),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
      for (let i = node.startPosition.row; i <= node.endPosition.row; i++) {
        coveredRanges.add(i);
      }
      continue;
    }

    // Export statements wrapping functions/types
    if (node.type === "export_statement") {
      const declaration =
        node.childForFieldName("declaration") ?? node.children[1];
      if (!declaration) continue;

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
        chunks.push({
          exportName: name,
          chunkType: "type",
          content: truncateContent(node.text, maxChunkChars),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        for (let i = node.startPosition.row; i <= node.endPosition.row; i++) {
          coveredRanges.add(i);
        }
        continue;
      }

      if (declaration.type === "function_declaration") {
        const name =
          declaration.childForFieldName("name")?.text ?? "anonymous";
        const isComponent = isTsx && hasJsx(declaration);
        chunks.push({
          exportName: name,
          chunkType: isComponent ? "component" : "function",
          content: truncateContent(node.text, maxChunkChars),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        for (let i = node.startPosition.row; i <= node.endPosition.row; i++) {
          coveredRanges.add(i);
        }
        continue;
      }

      if (
        declaration.type === "lexical_declaration" ||
        declaration.type === "variable_declaration"
      ) {
        const name = extractName(declaration);
        if (name) {
          const isComponent = isTsx && hasJsx(declaration);
          chunks.push({
            exportName: name,
            chunkType: isComponent ? "component" : "function",
            content: truncateContent(node.text, maxChunkChars),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          for (
            let i = node.startPosition.row;
            i <= node.endPosition.row;
            i++
          ) {
            coveredRanges.add(i);
          }
          continue;
        }
      }
    }

    // Top-level const/let arrow functions (not exported)
    if (
      node.type === "lexical_declaration" ||
      node.type === "variable_declaration"
    ) {
      const name = extractName(node);
      if (name) {
        const isComponent = isTsx && hasJsx(node);
        chunks.push({
          exportName: name,
          chunkType: isComponent ? "component" : "function",
          content: truncateContent(node.text, maxChunkChars),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        for (let i = node.startPosition.row; i <= node.endPosition.row; i++) {
          coveredRanges.add(i);
        }
      }
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
      content: truncateContent(summaryParts.join("\n\n"), maxChunkChars),
      startLine: 1,
      endLine: lines.length,
    });
  }

  return chunks;
}
