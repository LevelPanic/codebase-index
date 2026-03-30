import * as lancedb from "@lancedb/lancedb";
import fs from "fs";
import type { ChunkWithVector } from "../embedding/batch.js";
import type { ResolvedConfig } from "../config/loader.js";

let db: lancedb.Connection | null = null;
let currentIndexDir: string | null = null;

async function getDb(config: ResolvedConfig): Promise<lancedb.Connection> {
  if (!db || currentIndexDir !== config.indexDir) {
    fs.mkdirSync(config.indexDir, { recursive: true });
    db = await lancedb.connect(config.indexDir);
    currentIndexDir = config.indexDir;
  }
  return db;
}

function chunkToRow(chunk: ChunkWithVector): Record<string, unknown> {
  return {
    id: chunk.id,
    file_path: chunk.filePath,
    export_name: chunk.exportName,
    chunk_type: chunk.chunkType,
    content: chunk.content,
    start_line: chunk.startLine,
    end_line: chunk.endLine,
    ...chunk.tags,
    file_hash: chunk.fileHash,
    indexed_at: chunk.indexedAt,
    git_commit: chunk.gitCommit,
    vector: chunk.vector,
  };
}

export async function createTable(
  chunks: ChunkWithVector[],
  config: ResolvedConfig,
): Promise<void> {
  const connection = await getDb(config);
  const rows = chunks.map(chunkToRow);

  try {
    await connection.dropTable(config.tableName);
  } catch {
    // Table doesn't exist
  }

  await connection.createTable(config.tableName, rows);
}

export async function upsertChunks(
  filePaths: string[],
  newChunks: ChunkWithVector[],
  config: ResolvedConfig,
): Promise<void> {
  const connection = await getDb(config);
  let table: lancedb.Table;

  try {
    table = await connection.openTable(config.tableName);
  } catch {
    if (newChunks.length > 0) {
      await connection.createTable(config.tableName, newChunks.map(chunkToRow));
    }
    return;
  }

  for (const fp of filePaths) {
    try {
      await table.delete(`file_path = '${fp.replace(/'/g, "''")}'`);
    } catch {
      // Row might not exist
    }
  }

  if (newChunks.length > 0) {
    await table.add(newChunks.map(chunkToRow));
  }
}

export async function search(
  vector: number[],
  config: ResolvedConfig,
  options: {
    tagFilters?: Record<string, string>;
    limit?: number;
  } = {},
): Promise<Record<string, unknown>[]> {
  const connection = await getDb(config);
  let table: lancedb.Table;

  try {
    table = await connection.openTable(config.tableName);
  } catch {
    return [];
  }

  let query = table.search(vector).limit(options.limit ?? 10);

  const filters: string[] = [];
  if (options.tagFilters) {
    for (const [key, value] of Object.entries(options.tagFilters)) {
      if (value) {
        filters.push(`${key} = '${value}'`);
      }
    }
  }

  if (filters.length > 0) {
    query = query.where(filters.join(" AND "));
  }

  return query.toArray();
}

export async function getChunksByFile(
  filePath: string,
  config: ResolvedConfig,
): Promise<Record<string, unknown>[]> {
  const connection = await getDb(config);
  let table: lancedb.Table;

  try {
    table = await connection.openTable(config.tableName);
  } catch {
    return [];
  }

  return table
    .query()
    .where(`file_path = '${filePath.replace(/'/g, "''")}'`)
    .toArray();
}

export async function getStats(config: ResolvedConfig): Promise<{
  totalChunks: number;
  totalFiles: number;
  byChunkType: Record<string, number>;
  byTag: Record<string, Record<string, number>>;
}> {
  const connection = await getDb(config);
  let table: lancedb.Table;

  try {
    table = await connection.openTable(config.tableName);
  } catch {
    return { totalChunks: 0, totalFiles: 0, byChunkType: {}, byTag: {} };
  }

  // Select tag columns + standard columns
  const tagNames = config.tags.map((t) => t.name);
  const selectCols = ["file_path", "chunk_type", ...tagNames];
  const allRows = await table.query().select(selectCols).limit(100000).toArray();

  const files = new Set<string>();
  const byChunkType: Record<string, number> = {};
  const byTag: Record<string, Record<string, number>> = {};

  for (const tagName of tagNames) {
    byTag[tagName] = {};
  }

  for (const row of allRows) {
    files.add(row.file_path as string);
    const c = row.chunk_type as string;
    byChunkType[c] = (byChunkType[c] ?? 0) + 1;

    for (const tagName of tagNames) {
      const val = row[tagName] as string;
      if (val) {
        byTag[tagName]![val] = (byTag[tagName]![val] ?? 0) + 1;
      }
    }
  }

  return {
    totalChunks: allRows.length,
    totalFiles: files.size,
    byChunkType,
    byTag,
  };
}

export async function deleteByFiles(
  filePaths: string[],
  config: ResolvedConfig,
): Promise<void> {
  const connection = await getDb(config);
  let table: lancedb.Table;

  try {
    table = await connection.openTable(config.tableName);
  } catch {
    return;
  }

  for (const fp of filePaths) {
    try {
      await table.delete(`file_path = '${fp.replace(/'/g, "''")}'`);
    } catch {
      // ignore
    }
  }
}
