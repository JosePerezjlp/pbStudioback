export const ERROR_CODES = {
  USER_NOT_FOUND:
    "No pudimos encontrar tu usuario. Inicia sesión nuevamente o contáctanos si el problema continúa.",
  CLASS_NOT_FOUND:
    "No encontramos la clase que buscas. Verifica la información o intenta con otra clase.",
  DUPLICATE_RESERVATION:
    "Ya tienes una reserva activa para esta clase.",
  NO_SLOTS_AVAILABLE:
    "Ups, ya no quedan cupos disponibles en esta clase.",
  NO_CLASSES_AVAILABLE:
    "Por ahora no hay clases disponibles para reservar.",
  RESERVATION_NOT_FOUND:
    "No encontramos esa reserva.",
  INTERNAL_ERROR:
    "Tuvimos un inconveniente inesperado. Intenta nuevamente en unos minutos.",
  UNLIMITED_DAILY_LIMIT:
    "Con tu paquete ilimitado puedes reservar como máximo 2 clases por día.",
} as const;


export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export enum StatusTypeEnum {
  ACTIVE = "Activo",
  INACTIVE = "Inactivo",
}

export enum RolTypeEnum {
  EMPLOYEE = "employee",
  ADMIN = "admin",
}

export enum ClassType {
  GROUPS = "groups",
  INDIVIDUAL = "individual",
}
