export const ERROR_CODES = {
  USER_NOT_FOUND:           "USER_NOT_FOUND",
  CLASS_NOT_FOUND:          "CLASS_NOT_FOUND",
  DUPLICATE_RESERVATION:    "DUPLICATE_RESERVATION",
  NO_SLOTS_AVAILABLE:       "NO_SLOTS_AVAILABLE",
  NO_CLASSES_AVAILABLE:     "NO_CLASSES_AVAILABLE",
  RESERVATION_NOT_FOUND:    "RESERVATION_NOT_FOUND",
  INTERNAL_ERROR:           "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export enum StatusTypeEnum {
  ACTIVE = "Activo",
  INACTIVE = "Inactivo"
}

export enum RolTypeEnum {
  EMPLOYEE = "employee",
  ADMIN = "admin"
}
