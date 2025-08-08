// src/services/packageSelection.ts
export type ClassType = "groups" | "individual";

export interface UserPackage {
  id: string;
  active: boolean;
  totalClasses: number;
  classesUsed: number;
  isUnlimited: boolean;
  type: string;            // "Grupal" | "Individual" | "groups" | "individual"
  assignedAt?: string;
  expiresAt?: string | null;
  modality?: string;
}

export const normalizeClassType = (raw?: string): ClassType | null => {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "groups" || t === "group" || t.includes("grup")) return "groups";
  if (t === "individual" || t === "solo") return "individual";
  return null;
};

const isExpired = (iso?: string | null): boolean => {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) && ts < Date.now();
};

/** Elige paquete por modalidad, no vencido, con cupo o ilimitado.
 *  Prioriza: finitos que vencen antes; luego por asignación más antigua; ilimitados al final. */
export const selectPackageForClass = (
  packages: UserPackage[],
  classType: ClassType
): { index: number; pkg: UserPackage } | null => {
  const candidates = packages
    .map((p, index) => ({ index, pkg: p }))
    .filter(({ pkg }) => pkg.active && !isExpired(pkg.expiresAt))
    .filter(({ pkg }) => normalizeClassType(pkg.type) === classType)
    .filter(({ pkg }) => pkg.isUnlimited || pkg.classesUsed < pkg.totalClasses);

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
