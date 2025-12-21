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
  permissions: { superuser: true },
};

export const initializeDefaultAdmin = async () => {
  try {
    console.log("Verificando si ya existe el administrador por defecto (SQL)...");

    const existingUser = await prisma.user.findUnique({
      where: { email: DEFAULT_ADMIN.email },
    });

    if (existingUser) {
      console.log("Ya existe el administrador por defecto en SQL.");
      return;
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, 10);

    // Buscar sucursal por defecto (opcional)
    const branch = await prisma.branchOffice.findFirst({
        where: { name: DEFAULT_ADMIN.branch }
    });

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
