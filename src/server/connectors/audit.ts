/**
 * Connected apps: the audit without content (owner decisions, 22 October 2026: connectors; spec §3 table 12, §9.8).
 * `connector_audit` records what happened to a connection (connected, synced, acted, disconnected), never what was in
 * it. A personal connection's rows are its person's alone (row security); a workspace connection's are read by owners
 * and HR, and also go to `audit_events` with ids only. Personal connections never write `audit_events`. Server-only.
 */
import type { Db } from "@/server/db";
import { audit } from "@/server/services/common";
import type { ConnectionKind, ConnectorErrorCode, ProviderId } from "./types";

export type ConnectorAuditRow = {
  organisationId: string;
  connectionId: string | null;
  provider: ProviderId;
  kind: ConnectionKind;
  /** The actor; for a personal connection always its person. */
  membershipId: string;
  /** e.g. connect.started, connect.ok, disconnect.ok, acted.ok, post.ok, sync.failed */
  action: string;
  outcome: "ok" | "refused" | "failed";
  errorCode?: ConnectorErrorCode | string | null;
};

const ACTION = /^[a-z_.]{3,60}$/;
const CODE = /^[A-Z_]{2,40}$/;

/** Always writes connector_audit; a workspace connection's row also goes to audit_events (ids only). System or worker context. */
export async function connectorAudit(db: Db, r: ConnectorAuditRow, o: { auditEvent?: string; actorUserId?: string | null } = {}): Promise<void> {
  if (!ACTION.test(r.action)) throw new Error("connectorAudit: bad action");
  await db.query(
    `INSERT INTO connector_audit(organisation_id, connection_id, provider, kind, membership_id, action, outcome, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [r.organisationId, r.connectionId, r.provider, r.kind, r.membershipId, r.action, r.outcome, r.errorCode && CODE.test(r.errorCode) ? r.errorCode : null]);
  if (r.kind === "workspace" && o.auditEvent) {
    await audit(db, {
      organisationId: r.organisationId, actorMembershipId: r.membershipId, actorUserId: o.actorUserId ?? null, action: o.auditEvent,
      subjectType: "connector_connection", subjectId: r.connectionId, metadata: { provider: r.provider, connectionId: r.connectionId },
    });
  }
}
