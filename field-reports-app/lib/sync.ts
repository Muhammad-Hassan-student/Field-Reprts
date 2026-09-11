// The retry engine. This is where the "never send twice" guarantee lives.

import { getAllReports, updateReport, QueuedReport } from "./db";

// Backoff schedule (ms). Starts quick, then backs off.
function backoffMs(attempts: number): number {
  const base = Math.min(2000 * Math.pow(2, attempts), 30000);
  // Small jitter so multiple queued reports don't retry in lockstep.
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

let running = false;

export async function syncQueue(): Promise<void> {
  if (running) return; // prevent concurrent syncs
  running = true;
  try {
    const reports = await getAllReports();
    const now = Date.now();
    for (const r of reports) {
      if (r.status === "sent" || r.status === "failed") continue;
      if (r.next_attempt_at > now) continue;
      await sendOne(r);
    }
  } finally {
    running = false;
  }
}

async function sendOne(r: QueuedReport): Promise<void> {
  await updateReport(r.client_report_id, {
    status: "sending",
    attempts: r.attempts + 1,
  });

  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // IMPORTANT: same client_report_id on every attempt.
        client_report_id: r.client_report_id,
        outlet_name: r.outlet_name,
        finding: r.finding,
        action_needed: r.action_needed,
        captured_at: r.captured_at,
        lat: r.lat,
        lng: r.lng,
      }),
    });

    if (res.status === 201 || res.status === 200) {
      const body = await res.json().catch(() => ({}));
      await updateReport(r.client_report_id, {
        status: "sent",
        server_report_id: body.report_id ?? null,
        last_error: null,
      });
      return;
    }

    if (res.status === 409) {
      // The server already has this report from a previous attempt
      // (the save_then_drop case). This is SUCCESS, not failure.
      const body = await res.json().catch(() => ({}));
      await updateReport(r.client_report_id, {
        status: "sent",
        server_report_id: body.report_id ?? null,
        last_error: null,
      });
      return;
    }

    if (res.status === 400 || res.status === 413) {
      // Permanent failure. Retrying will never help.
      const body = await res.json().catch(() => ({}));
      await updateReport(r.client_report_id, {
        status: "failed",
        last_error: body.error ?? `HTTP ${res.status}`,
      });
      return;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "5");
      await updateReport(r.client_report_id, {
        status: "queued",
        next_attempt_at: Date.now() + retryAfter * 1000,
        last_error: "rate limited",
      });
      return;
    }

    // 5xx and anything else → retry with backoff
    await updateReport(r.client_report_id, {
      status: "queued",
      next_attempt_at: Date.now() + backoffMs(r.attempts),
      last_error: `HTTP ${res.status}`,
    });
  } catch (err) {
    // Network error / connection dropped.
    // The server MAY have already stored the report — we don't know.
    // So we retry with the SAME client_report_id. If the server has it,
    // it will reply 409 and we mark it sent. No duplicate.
    await updateReport(r.client_report_id, {
      status: "queued",
      next_attempt_at: Date.now() + backoffMs(r.attempts),
      last_error: err instanceof Error ? err.message : "network error",
    });
  }
}