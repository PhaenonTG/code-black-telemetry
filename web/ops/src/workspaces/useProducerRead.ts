import { useEffect, useState } from "react"
import { createProducerPoll } from "./producerPolling"

export function useProducerRead() {
  const [poll] = useState(createProducerPoll)
  useEffect(() => { poll.activate(); return () => poll.dispose() }, [poll])
  return poll
}
