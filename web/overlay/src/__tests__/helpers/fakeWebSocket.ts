export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.onopen?.();
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateRawMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

export function wireStormIntelEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "storm_intel.updated",
    schema_version: "1.0.0",
    timestamp: "2026-06-04T21:00:00Z",
    context_type: "AT_UNIT",
    context_key: "unit:cbwx-unit-striker",
    payload: {
      schema: "codeblack.storm-intel.snapshot",
      schema_version: "1.0.0",
      generated_at: "2026-06-04T21:00:00Z",
      context: {
        context_type: "AT_UNIT",
        location: { available: false, unavailable_reason: "test" },
        requested_at: "2026-06-04T21:00:00Z",
      },
      provider_name: "hrrr-nomads",
      simulation: false,
      metrics: [],
      score: {
        available: false,
        label: "x",
        algorithm_id: "x",
        algorithm_version: "x",
        inputs_used: [],
        unavailable_reason: null,
      },
      canonical_units: {},
      available: false,
      unavailable_reason: null,
    },
    ...overrides,
  };
}
