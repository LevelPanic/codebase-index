import fs from "fs";
import { loadConfig } from "../../config/loader.js";
import { getStats } from "../../storage/lancedb.js";

export async function statsCommand() {
  const config = loadConfig();

  let meta: { lastCommit: string; lastIndexed: string } | null = null;
  try {
    meta = JSON.parse(fs.readFileSync(config.metaFile, "utf-8"));
  } catch {
    // no meta
  }

  const stats = await getStats(config);

  console.log("\nCodebase Index Stats");
  console.log("====================");

  if (meta) {
    console.log(`Last commit:  ${meta.lastCommit.slice(0, 8)}`);
    console.log(`Last indexed: ${meta.lastIndexed}`);
  } else {
    console.log("No index metadata found.");
  }

  console.log(`\nTotal chunks: ${stats.totalChunks}`);
  console.log(`Total files:  ${stats.totalFiles}`);

  console.log("\nBy chunk type:");
  for (const [k, v] of Object.entries(stats.byChunkType).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${k}: ${v}`);
  }

  // Display each tag dimension
  for (const [tagName, values] of Object.entries(stats.byTag)) {
    console.log(`\nBy ${tagName}:`);
    for (const [k, v] of Object.entries(values).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
  }
}
