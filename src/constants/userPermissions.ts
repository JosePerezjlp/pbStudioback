// src/constants/userPermissions.ts

// Definición completa de todos los módulos y sus permisos disponibles
export const ALL_PERMISSIONS = {
  clases: [
    "lista_espera",
    "reservaciones",
    "cancelar",
    "editar",
    "crear",
    "listado",
  ],
  clases_por_dia: ["editar", "crear", "listado"],
  configuracion: ["editar"],
  contenido: ["editar"],
  cupones: ["listado", "crear", "editar", "detalle"],
  dashboard: ["estadisticas"],
  disciplinas: ["editar", "crear", "listado"],
  instructores: ["borrar", "editar", "crear", "listado"],
  operaciones: ["ver"],
  paquetes: ["listado", "crear", "editar"],
  reservaciones: ["crear", "cancelar"],
  salones: ["listado", "crear", "editar"],
  staff: ["listado", "editar", "crear"],
  sucursales: ["listado", "crear", "editar"],
  transacciones: [
    "listado",
    "caja",
    "detalle",
    "cancelar",
    "editar_fecha_expiracion",
  ],
  usuarios: [
    "listado",
    "exportar",
    "crear",
    "perfil",
    "habilitar_deshabilitar",
    "restablecer_contraseña",
    "editar",
  ],
} as const;

// Permisos completos para ADMIN (acceso total - siempre)
export const ADMIN_PERMISSIONS = {
  clases: [
    "lista_espera",
    "reservaciones",
    "cancelar",
    "editar",
    "crear",
    "listado",
  ],
  clases_por_dia: ["editar", "crear", "listado"],
  configuracion: ["editar"],
  contenido: ["editar"],
  cupones: ["listado", "crear", "editar", "detalle"],
  dashboard: ["estadisticas"],
  disciplinas: ["editar", "crear", "listado"],
  instructores: ["borrar", "editar", "crear", "listado"],
  operaciones: ["ver"],
  paquetes: ["listado", "crear", "editar"],
  reservaciones: ["crear", "cancelar"],
  salones: ["listado", "crear", "editar"],
  staff: ["listado", "editar", "crear"],
  sucursales: ["listado", "crear", "editar"],
  transacciones: [
    "listado",
    "caja",
    "detalle",
    "cancelar",
    "editar_fecha_expiracion",
  ],
  usuarios: [
    "listado",
    "exportar",
    "crear",
    "perfil",
    "habilitar_deshabilitar",
    "restablecer_contraseña",
    "editar",
  ],
};

// Permisos por defecto para STAFF (pueden ser personalizados por staff individual)
// Nota: El staff puede tener permisos personalizados. Este es solo un template.
export const DEFAULT_STAFF_PERMISSIONS = {
  clases: ["listado", "reservaciones"],
  dashboard: ["estadisticas"],
  paquetes: ["listado"],
  reservaciones: ["crear", "cancelar"],
  usuarios: ["listado", "perfil"],
};

// Permisos específicos para gestión de usuarios (backward compatibility)
export const USER_PERMISSIONS: ReadonlyArray<
  | "listado"
  | "exportar"
  | "crear"
  | "perfil"
  | "habilitar_deshabilitar"
  | "restablecer_contraseña"
  | "editar"
> = [
  "listado",
  "exportar",
  "crear",
  "perfil",
  "habilitar_deshabilitar",
  "restablecer_contraseña",
  "editar",
];

// Mapeo de permisos a acciones específicas
export const USER_PERMISSION_ACTIONS = {
  listado: ["GET /users"],
  exportar: ["GET /users/export"],
  crear: ["POST /users/register"],
  perfil: ["GET /users/:userId"],
  habilitar_deshabilitar: [
    "PUT /users/:userId/enable",
    "PUT /users/:userId/disable",
  ],
  restablecer_contraseña: ["POST /users/:userId/reset-password"],
  editar: ["PUT /users/:userId"],
} as const;
