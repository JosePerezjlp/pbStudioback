/* ────────────────────────────────────────────────────────────────
   src/constants/reservationConfig.ts
   Configuración centralizada de reglas de reservas
   ──────────────────────────────────────────────────────────────── */

/**
 * Ventanas de cancelación en minutos
 */
export const CANCELLATION_WINDOW_MINUTES = {
  INDIVIDUAL: 24 * 60, // 24 horas
  GROUPS: 12 * 60, // 12 horas
} as const;

/**
 * Zona horaria del sistema
 */
export const SYSTEM_TIMEZONE = "America/Mexico_City";

/**
 * Límites por usuario
 */
export const USER_LIMITS = {
  MAX_DAILY_RESERVATIONS_UNLIMITED: 3, // Máx reservas por día con paquete ilimitado
  MAX_CONCURRENT_RESERVATIONS: 10, // Máx reservas activas simultáneas
  MAX_WAITLIST_ENTRIES: 5, // Máx clases en lista de espera
} as const;

/**
 * Configuración de emails
 */
export const EMAIL_CONFIG = {
  REMINDER_HOURS_BEFORE: 24, // Enviar recordatorio 24h antes
  LOW_CLASSES_THRESHOLD: 3, // Avisar cuando queden 3 clases
  EXPIRY_WARNING_DAYS_BEFORE: 7, // Avisar 7 días antes de expirar
} as const;

/**
 * Configuración de rate limiting
 */
export const RATE_LIMITS = {
  RESERVATIONS_PER_MINUTE: 10,
  CANCELLATIONS_PER_MINUTE: 5,
  WAITLIST_PER_MINUTE: 10,
} as const;

/**
 * Estados de transacciones
 */
export const TRANSACTION_STATUS = {
  ACTIVE: 1,
  EXPIRED: 0,
  REFUNDED: -1,
  SUSPENDED: 2,
} as const;

/**
 * Estados de waitlist
 */
export const WAITLIST_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const;

/**
 * Tipos de eventos de reserva
 */
export const RESERVATION_EVENT_TYPES = {
  CREATED: "created",
  CANCELLED: "cancelled",
  ATTENDED: "attended",
  NO_SHOW: "no_show",
  MODIFIED: "modified",
  WAITLIST_ADDED: "waitlist_added",
  WAITLIST_PROMOTED: "waitlist_promoted",
} as const;
