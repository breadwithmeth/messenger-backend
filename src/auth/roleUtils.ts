export type AppRole = 'admin' | 'manager' | 'employee';

export function normalizeAppRole(role?: string | null): AppRole | undefined {
  if (!role) return undefined;

  const normalized = role.trim().toLowerCase();

  if (['admin', 'administrator', 'super_admin', 'role_admin', 'bm_admin'].includes(normalized)) {
    return 'admin';
  }

  if (['manager', 'supervisor', 'lead', 'role_supervisor'].includes(normalized)) {
    return 'manager';
  }

  if (['employee', 'operator', 'agent', 'role_operator', 'user'].includes(normalized)) {
    return 'employee';
  }

  return undefined;
}
