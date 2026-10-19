// Origin-side candidate only. Never imported into the Cloudflare Pages Worker.
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { validateCoordination } from "../web/ops/src/status/coordination/contract"

const reply = (status: number, data: unknown) => Response.json(data, { status, headers: {
  "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff",
} })

// Caller must first authenticate and authorize through stagedPrivateGateway.
export async function readApprovedCoordination(env: Record<string, string | undefined>): Promise<Response> {
  if (!env.OPS_PRIVATE_COORDINATION_SNAPSHOT) return reply(503, { error: "COORDINATION_UNAVAILABLE" })
  let file
  try {
    file = await open(env.OPS_PRIVATE_COORDINATION_SNAPSHOT, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
    const info = await file.stat()
    if (!info.isFile() || info.size > 262144) throw Error("Invalid snapshot")
    const bytes = Buffer.alloc(262145)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead > 262144) throw Error("Invalid snapshot")
    return reply(200, validateCoordination(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))))
  } catch { return reply(503, { error: "COORDINATION_UNAVAILABLE" }) }
  finally { await file?.close() }
}
