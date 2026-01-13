// src/utils/packageSelection.ts
import { ClassType } from "../types/enums";

export interface UserPackage {
  id: string;
  active: boolean;
  totalClasses: number;
  classesUsed: number;
  isUnlimited: boolean;
  /** Puede venir como "groups"/"individual" o en español ("Grupal", "Individual") */
  type: ClassType | string;
  assignedAt?: string;
  expiresAt?: string | null;
  modality?: string;
}

const toLower = (v?: string | ClassType | null): string =>
  (v ?? "").toString().trim().toLowerCase();

export const normalizeClassType = (
  raw?: string | ClassType | null
): ClassType | null => {
  const t = toLower(raw);
  if (!t) return null;

  // Valores exactos del enum
  if (t === ClassType.GROUPS) return ClassType.GROUPS;
  if (t === ClassType.INDIVIDUAL) return ClassType.INDIVIDUAL;

  // Códigos cortos históricos usados en MySQL: 'g' (grupal) / 'i' (individual)
  if (t === "g") return ClassType.GROUPS;
  if (t === "i") return ClassType.INDIVIDUAL;

  // Sinónimos ES/EN
  const groupsSyn = ["group", "groups", "grupal", "grupales"];
  const indivSyn = [
    "individual",
    "privada",
    "privado",
    "1:1",
    "personal",
    "one-to-one",
    "one to one",
  ];

  if (groupsSyn.includes(t)) return ClassType.GROUPS;
  if (indivSyn.includes(t)) return ClassType.INDIVIDUAL;

  return null;
};

// Alias por claridad semántica (idéntico a normalizeClassType)
export const normalizePackageType = normalizeClassType;

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

const remainingOf = (p: UserPackage): number =>
  (p.totalClasses ?? 0) - (p.classesUsed ?? 0);

type Row = { index: number; pkg: UserPackage };

const sortByExpiryAssignedUnlimited = (a: Row, b: Row): number => {
  // Finito antes que ilimitado
  if (a.pkg.isUnlimited && !b.pkg.isUnlimited) return 1;
  if (!a.pkg.isUnlimited && b.pkg.isUnlimited) return -1;

  // El que vence antes primero (Infinity si no vence)
  const aExp = a.pkg.expiresAt ? new Date(a.pkg.expiresAt).getTime() : Infinity;
  const bExp = b.pkg.expiresAt ? new Date(b.pkg.expiresAt).getTime() : Infinity;
  if (aExp !== bExp) return aExp - bExp;

  // Luego el asignado más antiguo primero
  const aAss = a.pkg.assignedAt ? new Date(a.pkg.assignedAt).getTime() : 0;
  const bAss = b.pkg.assignedAt ? new Date(b.pkg.assignedAt).getTime() : 0;
  return aAss - bAss;
};

/**
 * Selecciona un paquete que:
 *   - esté activo
 *   - no esté vencido
 *   - coincida con la modalidad (normalizada) de la clase
 *   - tenga saldo o sea ilimitado
 *
 * IMPORTANTE: ya **no** hay fallback a "cualquier paquete".
 * Si el usuario sólo tiene paquetes grupales y la clase es individual (o viceversa),
 * se devuelve null para que el servicio responda NO_COMPATIBLE_PACKAGE.
 */
export const selectPackageForClass = (
  packages: UserPackage[],
  classType: ClassType
): { index: number; pkg: UserPackage } | null => {
  const rows: Row[] = packages
    .map((pkg, index) => ({ index, pkg }))
    .filter(({ pkg }) => pkg.active && !isExpired(pkg.expiresAt))
    .filter(({ pkg }) => pkg.isUnlimited || remainingOf(pkg) > 0);

  // Candidatos que coinciden exactamente con el tipo de clase
  const exact = rows.filter(
    ({ pkg }) => normalizePackageType(pkg.type) === classType
  );

  if (exact.length === 0) return null;

  exact.sort(sortByExpiryAssignedUnlimited);
  return exact[0];
};
