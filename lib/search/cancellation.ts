// lib/search/cancellation.ts
// In-memory set of run IDs that have been cancelled by the user.
// The pipeline checks this between stages and aborts early if its runId is present.
// Entries are cleaned up when the pipeline finishes (either naturally or via cancellation).
// Does not survive server restarts — that's fine because in-flight pipelines die with the server.

const cancelledRuns = new Set<string>()

export function cancelRun(runId: string): void {
  cancelledRuns.add(runId)
}

export function isCancelled(runId: string): boolean {
  return cancelledRuns.has(runId)
}

export function clearCancellation(runId: string): void {
  cancelledRuns.delete(runId)
}
