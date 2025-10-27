// src/constants/userPermissions.ts

// Permisos específicos para gestión de usuarios
export const USER_PERMISSIONS: ReadonlyArray<
  "listado" | "exportar" | "crear" | "perfil" | "habilitar_deshabilitar" | "restablecer_contraseña" | "editar"
> = [
  "listado",
  "exportar", 
  "crear",
  "perfil",
  "habilitar_deshabilitar",
  "restablecer_contraseña",
  "editar"
];

// Mapeo de permisos a acciones específicas
export const USER_PERMISSION_ACTIONS = {
  listado: ["GET /users"],
  exportar: ["GET /users/export"],
  crear: ["POST /users/register"],
  perfil: ["GET /users/:userId"],
  habilitar_deshabilitar: ["PUT /users/:userId/enable", "PUT /users/:userId/disable"],
  restablecer_contraseña: ["POST /users/:userId/reset-password"],
  editar: ["PUT /users/:userId"]
} as const;
