# codebase-index

AST-aware codebase indexing with semantic search, exposed as an MCP server. Think Cursor's codebase awareness, but for Claude Code (or any MCP client).

**What it does:** Parses your codebase with tree-sitter, chunks it intelligently (functions, components, hooks, stores, configs, classes with method extraction, types), embeds locally with Ollama, stores in LanceDB, and exposes semantic search via MCP.

## Quick Start

```bash
# Prerequisites
brew install ollama
ollama serve
ollama pull nomic-embed-text

# In your repo
npx codebase-index init          # generates config
npx codebase-index index --full  # build the index
```

Add to your `.mcp.json` (Claude Code):

```json
{
  "mcpServers": {
    "codebase-index": {
      "command": "npx",
      "args": ["codebase-index", "serve"]
    }
  }
}
```

That's it. Claude Code now has `search_codebase` and `get_file_context` tools.

## How It Works

```
Your repo files
     │
     ▼
  tree-sitter AST parsing
     │
     ▼
  Smart chunks (functions, components, hooks, stores, configs, classes, types, Prisma models)
     │
     ▼
  Ollama embeddings (nomic-embed-text, local, free)
     │
     ▼
  LanceDB vector storage (just files on disk)
     │
     ▼
  MCP server (stdio) → search_codebase / get_file_context
```

- **Chunking is AST-aware** — not dumb line splits. Each function, component, type definition, and Prisma model is its own chunk.
- **Context-enriched** — function chunks include referenced type definitions inline, so embeddings capture the full picture.
- **Smart truncation** — large chunks keep signature + head + tail instead of cutting off at the bottom (preserves return statements and JSX output).
- **Class method extraction** — large classes are split into individual method chunks instead of one truncated blob.
- **Chunk type detection** — React hooks (`useXxx`), Zustand/Redux stores, config objects, and barrel files are all detected and tagged.
- **Small type batching** — tiny adjacent type aliases are merged into a single chunk to reduce embedding calls.
- **Embeddings are local** — Ollama runs on your machine. No API keys, no network, no cost.
- **Storage is embedded** — LanceDB is just a directory on disk. No database server.
- **Branch-aware** — when on a feature branch, search results for modified files return live content from disk.

## Configuration

The config file `codebase-index.config.json` goes at your repo root. It's optional — the tool works with zero config on any TypeScript/JavaScript project.

```json
{
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "output": ".codebase-index",
  "baseBranch": "main",
  "embedding": {
    "provider": "ollama",
    "url": "http://localhost:11434",
    "model": "nomic-embed-text"
  },
  "tags": []
}
```

### Tags

Tags let you add custom metadata dimensions to your chunks. Each tag has rules that match against file paths or content, and the tag values become filterable in the MCP search tool.

```json
{
  "tags": [
    {
      "name": "layer",
      "defaultValue": "other",
      "rules": [
        { "pattern": "app/api/", "value": "backend" },
        { "pattern": "components/", "value": "frontend" },
        { "pattern": "lib/", "value": "shared" }
      ]
    },
    {
      "name": "domain",
      "defaultValue": "general",
      "rules": [
        { "pattern": "billing", "value": "billing" },
        { "pattern": "auth", "value": "auth" },
        { "contentPattern": "Stripe|stripe", "value": "billing" }
      ]
    }
  ]
}
```

With these tags configured, `search_codebase` automatically gets `layer` and `domain` as optional filter parameters.

### Monorepo Example

```json
{
  "include": [
    "apps/**/*.{ts,tsx,js,jsx}",
    "packages/**/*.{ts,tsx,js,jsx}",
    "apps/**/schema.prisma"
  ],
  "tags": [
    {
      "name": "platform",
      "defaultValue": "all",
      "rules": [
        { "pattern": "facebook", "value": "meta" },
        { "pattern": "tiktok", "value": "tiktok" },
        { "pattern": "google-ads", "value": "google" }
      ]
    },
    {
      "name": "app",
      "defaultValue": "unknown",
      "rules": [
        { "pattern": "apps/web/", "value": "web" },
        { "pattern": "apps/api/", "value": "api" },
        { "pattern": "packages/", "value": "packages" }
      ]
    }
  ]
}
```

## CLI

```
codebase-index init [--force]     Generate starter config
codebase-index index              Incremental index (changed files only)
codebase-index index --full       Full reindex (drop and rebuild)
codebase-index stats              Show index statistics
codebase-index serve              Start MCP server (stdio)
```

### Indexing

- **Full index**: Parses all files, embeds everything, rebuilds the database. ~15-20 min for ~5K files on Apple Silicon.
- **Incremental index**: Only re-embeds files changed since last indexed commit. ~10 seconds for typical daily changes.
- **Stats**: Shows chunk counts broken down by type and configured tags.

## MCP Tools

### `search_codebase`

Semantic search across the codebase. Returns relevant code chunks ranked by similarity.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language search query |
| `limit` | number | Max results (default 10) |
| `<tag_name>` | enum | Filter by any configured tag |

### `get_file_context`

Get all indexed chunks for a specific file. Shows the file's structure — functions, components, types.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file_path` | string | Relative path from repo root |

## Chunk Types

The chunker detects and labels each chunk:

| Type | What it captures |
|------|-----------------|
| `function` | Functions and arrow functions |
| `component` | React components (JSX-returning functions in `.tsx`/`.jsx`) |
| `hook` | React hooks (`useXxx` naming convention) |
| `store` | Zustand/Redux stores (`create()`, `*Store`, `*Slice`) |
| `config` | Plain object/array literals (route maps, constants, configs) |
| `class` | Class overview with method listing |
| `method` | Individual methods extracted from large classes |
| `type` | Type aliases, interfaces, enums |
| `model` | Prisma model/enum/type blocks |
| `summary` | File-level overview (imports + export listing) |

## Prerequisites

- **Node.js 18+**
- **Git** — the repo must be a git repository with at least one commit
- **Ollama** running locally with an embedding model (`ollama serve && ollama pull nomic-embed-text`)
- **C++ compiler** (for tree-sitter native module — Xcode CLI tools on macOS, build-essential on Linux)

## How Freshness Works

The index tracks the base branch (default: `main`). When you're on a feature branch:

1. Search results are returned from the index as normal
2. If a result points to a file modified on your branch (`git diff main...HEAD`)
3. The tool reads the live file from disk and re-parses it
4. You get current content, not stale indexed content

This means the index only needs to track `main` — feature branch changes are always live.

## License

MIT
