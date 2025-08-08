// src/utils/packageSelection.ts
import { ClassType } from "../types/enums";

export interface UserPackage {
  id: string;
  active: boolean;
  totalClasses: number;
  classesUsed: number;
  isUnlimited: boolean;
  /** Debe ser EXACTAMENTE "groups" o "individual" */
  type: ClassType | string;
  assignedAt?: string;
  expiresAt?: string | null;
  modality?: string;
}

export const normalizeClassType = (raw?: string): ClassType | null => {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === ClassType.GROUPS) return ClassType.GROUPS;
  if (t === ClassType.INDIVIDUAL) return ClassType.INDIVIDUAL;
  return null;
};

const isExpired = (iso?: string | null): boolean => {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) && ts < Date.now();
};

export const isActiveUnlimited = (p: UserPackage): boolean => {
  if (!p.active || !p.isUnlimited) return false;
  if (!p.expiresAt) return true;
  return new Date(p.expiresAt).getTime() > Date.now();
};

/** Selecciona un paquete que:
 *   - esté activo
 *   - no esté vencido
 *   - coincida con la modalidad EXACTA
 *   - tenga cupo o sea ilimitado
 * Prioridad:
 *   1) finitos que vencen antes
 *   2) luego por assignedAt más antiguo
 *   3) ilimitados al final (entre ellos por assignedAt)
 */
export const selectPackageForClass = (
  packages: UserPackage[],
  classType: ClassType
): { index: number; pkg: UserPackage } | null => {
  const candidates = packages
    .map((p, index) => ({ index, pkg: p }))
    .filter(({ pkg }) => pkg.active && !isExpired(pkg.expiresAt))
    .filter(({ pkg }) => normalizeClassType(String(pkg.type)) === classType)
    .filter(
      ({ pkg }) => pkg.isUnlimited || (pkg.classesUsed ?? 0) < (pkg.totalClasses ?? 0)
    );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.pkg.isUnlimited && !b.pkg.isUnlimited) return 1;
    if (!a.pkg.isUnlimited && b.pkg.isUnlimited) return -1;

    const aExp = a.pkg.expiresAt ? new Date(a.pkg.expiresAt).getTime() : Infinity;
    const bExp = b.pkg.expiresAt ? new Date(b.pkg.expiresAt).getTime() : Infinity;
    if (aExp !== bExp) return aExp - bExp;

    const aAss = a.pkg.assignedAt ? new Date(a.pkg.assignedAt).getTime() : 0;
    const bAss = b.pkg.assignedAt ? new Date(b.pkg.assignedAt).getTime() : 0;
    return aAss - bAss;
  });

  return candidates[0];
};
