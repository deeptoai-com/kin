/**
 * Pure normalization for P2-2 audit rows — no DB imports, unit-testable.
 */

export type AuditEntry = {
  userId?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
};

export type AuditRow = {
  userId: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
};

export function buildAuditRow(entry: AuditEntry): AuditRow {
  return {
    userId: entry.userId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    meta: entry.meta ?? {},
    ip: entry.ip ?? null,
  };
}

/**
 * Extract the client IP from a forwarded-for header value (first hop).
 * Returns null when absent/blank.
 */
export function clientIpFromForwardedFor(forwardedFor: string | null | undefined): string | null {
  if (!forwardedFor) return null;
  const first = forwardedFor.split(',')[0]?.trim();
  return first ? first : null;
}
