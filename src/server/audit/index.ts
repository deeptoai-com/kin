/**
 * Audit logging helper (P2-2).
 *
 * recordAudit() appends a row to audit_log. It NEVER throws — audit logging must
 * not break the action it records (mirrors the swallow-errors pattern used by the
 * Better Auth user.onCreate hook).
 */

import { db } from '~/db/db-config';
import { auditLog } from '~/db/schema';
import { buildAuditRow, type AuditEntry } from '~/server/audit/build-audit-row';

export type { AuditEntry } from '~/server/audit/build-audit-row';

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values(buildAuditRow(entry));
  } catch (error) {
    console.error('[audit] failed to record', entry.action, error);
  }
}
