/**
 * The Control Center's permission model: roles are composed from granular permissions, and every admin route and
 * service checks a permission, never a role. Read-only admins get every `.view`.
 */
export const ADMIN_ROLES = ["super_admin", "operations", "support", "billing", "marketing", "technical", "read_only"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super admin", operations: "Operations admin", support: "Support admin", billing: "Billing admin", marketing: "Marketing admin", technical: "Technical admin", read_only: "Read-only admin",
};

export const PERMISSIONS = [
  "dashboard.view",
  "organization.view", "organization.edit", "organization.suspend", "organization.delete", "organization.impersonate",
  "user.view", "user.edit", "user.suspend", "user.delete", "user.impersonate",
  "plan.view", "plan.create", "plan.edit", "plan.archive",
  "subscription.view", "subscription.edit",
  "payment.view", "payment.refund",
  "usage.view",
  "marketing.view", "marketing.create", "marketing.send",
  "communications.view", "communications.send",
  "waitlist.view", "waitlist.edit", "waitlist.export",
  "launch.view", "launch.edit",
  "moderation.view", "moderation.act",
  "support.view", "support.act",
  "system.view", "system.configure",
  "audit.view",
  "admin.view", "admin.create", "admin.edit", "admin.disable",
  "settings.view", "settings.edit", "flags.edit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEW_ALL = PERMISSIONS.filter((p) => p.endsWith(".view"));

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  operations: [...VIEW_ALL, "organization.edit", "organization.suspend", "user.edit", "user.suspend", "moderation.act", "support.act", "subscription.edit", "waitlist.edit", "communications.send"],
  support: ["dashboard.view", "organization.view", "user.view", "subscription.view", "usage.view", "support.view", "support.act", "user.impersonate", "organization.impersonate", "user.suspend", "moderation.view", "audit.view", "communications.view", "communications.send"],
  billing: ["dashboard.view", "organization.view", "user.view", "plan.view", "plan.create", "plan.edit", "plan.archive", "subscription.view", "subscription.edit", "payment.view", "payment.refund", "audit.view", "communications.view", "communications.send"],
  marketing: ["dashboard.view", "marketing.view", "marketing.create", "marketing.send", "communications.view", "communications.send", "waitlist.view", "waitlist.edit", "waitlist.export", "launch.view", "organization.view", "user.view"],
  technical: ["dashboard.view", "system.view", "system.configure", "settings.view", "settings.edit", "flags.edit", "audit.view", "organization.view", "user.view", "usage.view"],
  read_only: VIEW_ALL,
};

export function permissionsFor(role: AdminRole): Set<Permission> { return new Set(ROLE_PERMISSIONS[role]); }
