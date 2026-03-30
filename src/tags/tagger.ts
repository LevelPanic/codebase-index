import type { TagDefinition } from "../config/schema.js";

export function inferTags(
  tagDefs: TagDefinition[],
  filePath: string,
  content?: string,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const tag of tagDefs) {
    let matched = false;

    for (const rule of tag.rules) {
      // Check file path substring match
      if (rule.pattern && filePath.includes(rule.pattern)) {
        result[tag.name] = rule.value;
        matched = true;
        break;
      }

      // Check content regex
      if (rule.contentPattern && content) {
        if (new RegExp(rule.contentPattern, "i").test(content)) {
          result[tag.name] = rule.value;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      result[tag.name] = tag.defaultValue;
    }
  }

  return result;
}
