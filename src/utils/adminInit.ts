import bcrypt from "bcrypt";
import { prisma } from "../config/prisma";

const DEFAULT_ADMIN = {
  email: "admintemporal@pbstudioapp.com",
  password: "Temporal2025*",
  firstName: "Admin",
  lastName: "Temporal",
  role: "admin",
  isAdmin: true,
  phone: "0000000000",
  branch: "Principal",
  permissions: {
    usuarios: ["listado", "exportar", "crear", "perfil", "editar", "habilitar_deshabilitar", "eliminar", "restablecer_contraseña"],
    transacciones: ["listado", "exportar", "detalle", "crear", "cancelar", "editar_fecha_expiracion", "eliminar", "caja"],
    clases: ["listado", "crear", "editar", "eliminar", "reservaciones", "lista_espera"],
    clases_por_dia: ["listado", "crear", "editar", "eliminar"],
    notificaciones: ["borrar"],
    staff: ["listado", "crear", "editar", "eliminar"],
    paquetes: ["listado", "crear", "editar"],
    sucursales: ["listado", "crear", "editar"],
    reportes: ["ver", "exportar"],
  },
};

export const initializeDefaultAdmin = async () => {
  try {
    console.log("Verificando si ya existe el administrador por defecto (SQL)...");

    const existingUser = await prisma.user.findUnique({
      where: { email: DEFAULT_ADMIN.email },
    });

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, 10);

    // Buscar sucursal por defecto (opcional)
    const branch = await prisma.branchOffice.findFirst({
        where: { name: DEFAULT_ADMIN.branch }
    });

    if (existingUser) {
      // Update password and permissions if exists
      await prisma.user.update({
        where: { email: DEFAULT_ADMIN.email },
        data: {
          password: hashedPassword,
          roles: JSON.stringify(["admin"]),
          permissions: JSON.stringify(DEFAULT_ADMIN.permissions),
          enabled: true,
        }
      });
      console.log("✅ Administrador por defecto actualizado en SQL.");
      return;
    }

    await prisma.user.create({
      data: {
        email: DEFAULT_ADMIN.email,
        password: hashedPassword,
        name: DEFAULT_ADMIN.firstName,
        lastname: DEFAULT_ADMIN.lastName,
        phone: DEFAULT_ADMIN.phone,
        enabled: true,
        roles: JSON.stringify(["admin"]),
        permissions: JSON.stringify(DEFAULT_ADMIN.permissions),
        branchOfficeId: branch?.id ?? null,
        freeSession: false,
        classesAvailable: 0,
        classesTaken: 0,
      },
    });

    console.log("✅ Administrador por defecto creado exitosamente en SQL.");
  } catch (error) {
    console.error("❌ Error al crear administrador por defecto:", error);
    // No throw error to avoid stopping server startup if this fails
  }
};
