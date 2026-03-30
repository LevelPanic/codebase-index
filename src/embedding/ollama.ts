interface EmbeddingResponse {
  embedding: number[];
}

export async function embed(
  text: string,
  url: string,
  model: string,
): Promise<number[]> {
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

  const data = (await res.json()) as EmbeddingResponse;
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
    return data.models.some((m) => m.name.includes(model));
  } catch {
    return false;
  }
}
