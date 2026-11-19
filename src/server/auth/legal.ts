/**
 * The record that a person agreed (owner decisions, 11 November 2026: one required tick box at sign-up, 18 and over
 * only). One row in audit_events per acceptance, action `legal.accepted`: who, when (the row's own time), the version of
 * the Terms and Privacy Policy (LEGAL_VERSION), that they confirmed being 18 or older, whether they asked for product
 * news, how they signed up and from which IP address. The application role cannot change or delete audit rows
 * (migration 0005), so the record stands as evidence of consent. It has no organisation, so no workspace can read it;
 * Boredroom's Control Center can.
 */
import type { Db } from "@/server/db";
import { LEGAL_VERSION, MINIMUM_AGE } from "@/lib/legal";

export type LegalAcceptance = { marketing?: boolean };

export async function recordLegalAcceptance(db: Db, authUserId: string, o: { via: "email" | "google"; ip?: string | null; marketing?: boolean }): Promise<void> {
  await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id, metadata) VALUES ($1, 'legal.accepted', 'auth_user', $1, $2)`,
    [authUserId, JSON.stringify({ terms: LEGAL_VERSION, privacy: LEGAL_VERSION, minimumAge: MINIMUM_AGE, marketing: !!o.marketing, via: o.via, ip: o.ip ?? null })]);
}
