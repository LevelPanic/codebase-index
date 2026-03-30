interface EmbedResponse {
  embeddings: number[][];
}

interface LegacyEmbeddingResponse {
  embedding: number[];
}

export async function embed(
  text: string,
  url: string,
  model: string,
): Promise<number[]> {
  // Try new API first (/api/embed), fall back to legacy (/api/embeddings)
  try {
    const res = await fetch(`${url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    });

    if (res.ok) {
      const data = (await res.json()) as EmbedResponse;
      return data.embeddings[0]!;
    }
  } catch {
    // Fall through to legacy
  }

  // Legacy endpoint
  const res = await fetch(`${url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama embedding failed: ${res.status} ${await res.text()}`,
    );
  }

  const data = (await res.json()) as LegacyEmbeddingResponse;
  return data.embedding;
}

export async function healthCheck(
  url: string,
  model: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`);
    if (!res.ok) return false;
    const data = (await res.json()) as { models: { name: string }[] };
    return data.models.some(
      (m) => m.name === model || m.name === `${model}:latest`,
    );
  } catch {
    return false;
  }
}
