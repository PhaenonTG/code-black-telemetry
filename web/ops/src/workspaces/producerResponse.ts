import { noteProducerResponse, producerRetryMessage } from "./producerRateLimit"

export async function readProducerResponse<T>(response: Response): Promise<T> {
  noteProducerResponse(response)
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!response.ok) {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : null;
    const error = response.status === 429 ? producerRetryMessage() : typeof record?.error === "string" ? record.error : `Producer service returned HTTP ${response.status}`;
    const code = typeof record?.code === "number" ? ` (Meta ${record.code})` : "";
    throw new Error(`${error}${code}`);
  }
  if (data === null) throw new Error("Producer service returned an invalid response.");
  return data as T;
}
