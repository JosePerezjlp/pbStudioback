import bcrypt from "bcrypt";
import { prisma } from "../config/prisma";

const PERSONAL_ADMIN = {
  email: "johandevadmin@pbstudioapp.com",
  password: "JohanDev2025*",
  firstName: "Johan",
  lastName: "Cortes",
  role: "admin",
  isAdmin: true,
  phone: "1111111111",
  branch: "Desarrollo",
  permissions: { superuser: true },
};

export const initializePersonalAdmin = async () => {
  try {
    console.log("Verificando/creando administrador personal (SQL)...");

    const existingUser = await prisma.user.findUnique({
      where: { email: PERSONAL_ADMIN.email },
    });

    const hashedPassword = await bcrypt.hash(PERSONAL_ADMIN.password, 10);
    const branch = await prisma.branchOffice.findFirst({
        where: { name: PERSONAL_ADMIN.branch }
    });

    if (existingUser) {
        // Update password if exists
        await prisma.user.update({
            where: { email: PERSONAL_ADMIN.email },
            data: {
                password: hashedPassword,
                roles: JSON.stringify(["admin"]),
                permissions: JSON.stringify(PERSONAL_ADMIN.permissions),
            }
        });
        console.log("Administrador personal actualizado en SQL.");
        return;
    }

    await prisma.user.create({
      data: {
        email: PERSONAL_ADMIN.email,
        password: hashedPassword,
        name: PERSONAL_ADMIN.firstName,
        lastname: PERSONAL_ADMIN.lastName,
        phone: PERSONAL_ADMIN.phone,
        enabled: true,
        roles: JSON.stringify(["admin"]),
        permissions: JSON.stringify(PERSONAL_ADMIN.permissions),
        branchOfficeId: branch?.id ?? null,
        freeSession: false,
        classesAvailable: 0,
        classesTaken: 0,
      },
    });

    console.log("✅ Administrador personal creado exitosamente en SQL.");
  } catch (error) {
    console.error("❌ Error al crear administrador personal:", error);
  }
};
