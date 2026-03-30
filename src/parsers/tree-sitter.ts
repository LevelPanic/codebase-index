import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

let tsParser: Parser | null = null;
let tsxParser: Parser | null = null;

function getTsParser(): Parser {
  if (!tsParser) {
    tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);
  }
  return tsParser;
}

function getTsxParser(): Parser {
  if (!tsxParser) {
    tsxParser = new Parser();
    tsxParser.setLanguage(TypeScript.tsx);
  }
  return tsxParser;
}

export function parse(source: string, isTsx: boolean): Parser.Tree {
  const parser = isTsx ? getTsxParser() : getTsParser();
  return parser.parse(source);
}

export { Parser };
