export interface ActiveRequest {
  id: number;
  controller: AbortController;
}

// One user intent (search, point selection, or retry) owns the displayed result at a time.
export class LatestRequest {
  private nextId = 0;
  private active: ActiveRequest | null = null;

  begin(): ActiveRequest {
    this.active?.controller.abort();
    const request = { id: ++this.nextId, controller: new AbortController() };
    this.active = request;
    return request;
  }

  isCurrent(request: ActiveRequest): boolean {
    return this.active === request && !request.controller.signal.aborted;
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = null;
  }
}
