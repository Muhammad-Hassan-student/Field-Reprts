"use client";

import { useEffect, useRef, useState } from "react";
import { addReport, getAllReports, QueuedReport } from "@/lib/db";
import { syncQueue } from "@/lib/sync";

// The id has to exist before the first network call and must never change,
// because it is what the server uses to tell a retry from a new report.
function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "cid_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const POLL_INTERVAL_MS = 5000;

export default function Home() {
  const [outletName, setOutletName] = useState("");
  const [finding, setFinding] = useState("");
  const [actionNeeded, setActionNeeded] = useState("");
  const [lat, setLat] = useState("24.8607");
  const [lng, setLng] = useState("67.0011");

  const [reports, setReports] = useState<QueuedReport[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  // Guards against two syncs running at once when the poll timer and the
  // online event happen to fire together.
  const syncingRef = useRef(false);

  async function refresh() {
    setReports(await getAllReports());
  }

  async function runSync() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      await syncQueue();
      await refresh();
    } finally {
      syncingRef.current = false;
    }
  }

  useEffect(() => {
    refresh();
    setOnline(navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      runSync();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Poll so the retry schedule keeps moving even when nothing else happens.
  useEffect(() => {
    const t = setInterval(runSync, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      // Written to IndexedDB first, network second. If the tab is closed
      // right here, the report is already on disk and will sync on reopen.
      const client_report_id = newClientId();

      await addReport({
        client_report_id,
        outlet_name: outletName.trim(),
        finding: finding.trim(),
        action_needed: actionNeeded.trim(),
        captured_at: new Date().toISOString(),
        lat: Number(lat),
        lng: Number(lng),
      });

      setOutletName("");
      setFinding("");
      setActionNeeded("");

      await refresh();
      runSync();
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryNow() {
    setBusy(true);
    try {
      await runSync();
    } finally {
      setBusy(false);
    }
  }

  // Split so the worker can tell at a glance what is still on its way
  // and what the server has actually accepted.
  const pending = reports.filter(
    (r) => r.status === "queued" || r.status === "sending"
  );
  const history = reports.filter(
    (r) => r.status === "sent" || r.status === "failed"
  );
  const sentCount = reports.filter((r) => r.status === "sent").length;
  const failedCount = reports.filter((r) => r.status === "failed").length;

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Field Reports</h1>
          <div style={styles.summary}>
            {sentCount} sent &middot; {pending.length} pending
            {failedCount > 0 && <> &middot; {failedCount} failed</>}
          </div>
        </div>
        <ConnectionPill online={online} />
      </header>

      <form onSubmit={handleSubmit} style={styles.form}>
        <Field label="Outlet name">
          <input
            style={styles.input}
            value={outletName}
            onChange={(e) => setOutletName(e.target.value)}
            required
          />
        </Field>

        <Field label="What they found">
          <textarea
            style={styles.textarea}
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
            required
            rows={3}
          />
        </Field>

        <Field label="Action needed">
          <textarea
            style={styles.textarea}
            value={actionNeeded}
            onChange={(e) => setActionNeeded(e.target.value)}
            required
            rows={3}
          />
        </Field>

        <div style={styles.row}>
          <Field label="Latitude">
            <input
              style={styles.input}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              required
            />
          </Field>
          <Field label="Longitude">
            <input
              style={styles.input}
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              required
            />
          </Field>
        </div>

        <button type="submit" disabled={busy} style={styles.submitBtn}>
          {busy ? "Saving..." : "Submit report"}
        </button>
      </form>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.h2}>Pending</h2>
          <span style={styles.sectionCount}>{pending.length}</span>
          <button
            onClick={handleRetryNow}
            disabled={busy || pending.length === 0}
            style={styles.retryBtn}
          >
            {busy ? "Working..." : "Retry now"}
          </button>
        </div>

        {pending.length === 0 ? (
          <p style={styles.empty}>
            Nothing waiting. New reports stay here until the server accepts
            them.
          </p>
        ) : (
          <ul style={styles.list}>
            {pending.map((r) => (
              <ReportCard key={r.client_report_id} report={r} />
            ))}
          </ul>
        )}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.h2}>History</h2>
          <span style={styles.sectionCount}>{history.length}</span>
        </div>

        {history.length === 0 ? (
          <p style={styles.empty}>Nothing delivered yet.</p>
        ) : (
          <ul style={styles.list}>
            {history.map((r) => (
              <ReportCard key={r.client_report_id} report={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={styles.label}>
      <span style={styles.labelText}>{label}</span>
      {children}
    </label>
  );
}

function ConnectionPill({ online }: { online: boolean }) {
  return (
    <span
      style={{
        ...styles.pill,
        background: online ? "#ecfdf5" : "#fef2f2",
        color: online ? "#065f46" : "#991b1b",
      }}
    >
      <span
        style={{
          ...styles.dot,
          background: online ? "#10b981" : "#ef4444",
        }}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function ReportCard({ report }: { report: QueuedReport }) {
  const [open, setOpen] = useState(false);

  return (
    <li style={styles.item}>
      <div
        style={styles.itemTop}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div style={styles.itemLeft}>
          <div style={styles.outletName}>{report.outlet_name}</div>
          <div style={styles.itemMeta}>
            {report.client_report_id.slice(0, 8)} &middot;{" "}
            {new Date(report.created_at).toLocaleTimeString()} &middot;
            attempts: {report.attempts}
          </div>
        </div>
        <div style={styles.itemRight}>
          <StatusBadge status={report.status} />
          <span style={styles.chevron}>{open ? "\u2212" : "+"}</span>
        </div>
      </div>

      {report.status === "sent" && report.server_report_id && (
        <div style={styles.itemOk}>
          Server confirmed as {report.server_report_id}
        </div>
      )}

      {report.status === "queued" && report.last_error && (
        <div style={styles.itemWarn}>
          Last attempt failed: {report.last_error}. Will retry.
        </div>
      )}

      {report.status === "failed" && report.last_error && (
        <div style={styles.itemErr}>
          Rejected: {report.last_error}. Not retrying.
        </div>
      )}

      {open && (
        <dl style={styles.details}>
          <DetailRow label="Outlet name" value={report.outlet_name} />
          <DetailRow label="Finding" value={report.finding} />
          <DetailRow label="Action needed" value={report.action_needed} />
          <DetailRow label="Captured at" value={report.captured_at} />
          <DetailRow
            label="Lat / Lng"
            value={`${report.lat}, ${report.lng}`}
          />
          <DetailRow
            label="Client ID"
            value={report.client_report_id}
            mono
          />
          {report.server_report_id && (
            <DetailRow
              label="Server ID"
              value={report.server_report_id}
              mono
            />
          )}
          <DetailRow label="Attempts" value={String(report.attempts)} />
          <DetailRow
            label="Created"
            value={new Date(report.created_at).toLocaleString()}
          />
          {report.last_error && (
            <DetailRow label="Last error" value={report.last_error} />
          )}
        </dl>
      )}
    </li>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={styles.detailRow}>
      <dt style={styles.detailLabel}>{label}</dt>
      <dd
        style={{
          ...styles.detailValue,
          ...(mono ? styles.detailMono : null),
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusBadge({ status }: { status: QueuedReport["status"] }) {
  const palette: Record<
    QueuedReport["status"],
    { bg: string; fg: string; label: string }
  > = {
    queued: { bg: "#fff7ed", fg: "#9a3412", label: "Queued" },
    sending: { bg: "#eff6ff", fg: "#1e40af", label: "Sending" },
    sent: { bg: "#ecfdf5", fg: "#065f46", label: "Sent" },
    failed: { bg: "#fef2f2", fg: "#991b1b", label: "Failed" },
  };
  const p = palette[status];
  return (
    <span style={{ ...styles.badge, background: p.bg, color: p.fg }}>
      {p.label}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 620,
    margin: "0 auto",
    padding: "24px 16px 56px",
    fontFamily:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
    color: "#0f172a",
    background: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 12,
  },
  h1: {
    fontSize: 22,
    margin: 0,
    fontWeight: 700,
    letterSpacing: -0.2,
  },
  h2: { fontSize: 14, margin: 0, fontWeight: 600, color: "#334155" },
  summary: { fontSize: 12, color: "#64748b", marginTop: 4 },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    background: "#fff",
    padding: 16,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  label: { display: "flex", flexDirection: "column", gap: 5, flex: 1 },
  labelText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: 500,
    letterSpacing: 0.1,
  },
  input: {
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #cbd5e1",
    borderRadius: 7,
    fontFamily: "inherit",
    background: "#fff",
    color: "#0f172a",
    outline: "none",
  },
  textarea: {
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #cbd5e1",
    borderRadius: 7,
    fontFamily: "inherit",
    resize: "vertical",
    background: "#fff",
    color: "#0f172a",
    outline: "none",
  },
  row: { display: "flex", gap: 12 },
  submitBtn: {
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 600,
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    marginTop: 4,
    letterSpacing: 0.1,
  },
  section: { marginTop: 28 },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  sectionCount: {
    fontSize: 12,
    color: "#64748b",
    background: "#e2e8f0",
    padding: "1px 8px",
    borderRadius: 999,
    fontWeight: 500,
  },
  retryBtn: {
    marginLeft: "auto",
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    border: "1px solid #cbd5e1",
    background: "#fff",
    borderRadius: 7,
    cursor: "pointer",
    color: "#334155",
  },
  empty: { fontSize: 13, color: "#94a3b8", margin: 0, padding: "4px 0" },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  item: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: 14,
    fontSize: 13,
    background: "#fff",
  },
  itemTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    cursor: "pointer",
  },
  itemLeft: { minWidth: 0 },
  itemRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  outletName: { fontWeight: 600, fontSize: 14, color: "#0f172a" },
  itemMeta: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 3,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  itemOk: { color: "#065f46", fontSize: 12, marginTop: 10 },
  itemWarn: { color: "#9a3412", fontSize: 12, marginTop: 10 },
  itemErr: { color: "#991b1b", fontSize: 12, marginTop: 10 },
  badge: {
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.2,
    whiteSpace: "nowrap",
  },
  chevron: {
    fontSize: 14,
    color: "#94a3b8",
    fontWeight: 500,
    width: 12,
    textAlign: "center",
    userSelect: "none",
  },
  details: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  detailRow: {
    display: "grid",
    gridTemplateColumns: "110px 1fr",
    gap: 10,
    fontSize: 12,
    alignItems: "baseline",
  },
  detailLabel: {
    color: "#64748b",
    fontWeight: 500,
    margin: 0,
  },
  detailValue: {
    color: "#0f172a",
    margin: 0,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  detailMono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
  },
};