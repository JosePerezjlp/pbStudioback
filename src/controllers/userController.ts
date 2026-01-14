import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../config/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { sendWelcomeEmail } from "../utils/emailService";

import { userService } from "../services/user.service";
import { getUserClassStats } from "../services/userStats.service";

export const completeProfileFromAuthController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    // El middleware 'verifyToken' ya debió poblar req.user
    const user = req.user;
    if (!user || !user.id) {
      res
        .status(401)
        .json({ error: "UNAUTHORIZED", message: "Usuario no autenticado" });
      return;
    }

    const {
      firstName,
      lastName,
      phone = "",
      branch = "", // ID de sucursal (ahora esperamos number o string parseable)
      birthDate = "",
      emergencyContact,
      password,
    } = req.body;

    if (!firstName || !lastName) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "firstName y lastName son requeridos",
      });
      return;
    }

    // Preparar datos para actualización
    const updateData: any = {
      name: firstName,
      lastname: lastName,
      phone: phone,
      // branchOfficeId: branch ? Number(branch) : null, // Si decidimos actualizar sucursal aquí
      emergencyContactName: emergencyContact?.name || null,
      emergencyContactPhone: emergencyContact?.phone || null,
      updatedAt: new Date(),
    };

    if (birthDate) {
      // Esperamos formato dd/mm (sin año real del usuario)
      const parts = String(birthDate).trim().split("/");
      if (parts.length === 2) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);

        if (
          Number.isFinite(day) &&
          Number.isFinite(month) &&
          day >= 1 &&
          day <= 31 &&
          month >= 1 &&
          month <= 12
        ) {
          // Año fijo 2000: no refleja la edad real del usuario
          const testDate = new Date(2000, month - 1, day);
          if (testDate.getDate() === day && testDate.getMonth() === month - 1) {
            updateData.birthday = testDate;
          }
        }
      }
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    // Actualizar en SQL
    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    // Enviar email de bienvenida si es necesario (lógica original)
    // Aquí podríamos verificar si es la primera vez que completa perfil
    // Por simplicidad, lo omito o lo dejo comentado hasta definir reglas de negocio exactas
    // await sendWelcomeEmail(user.email, firstName);

    res.status(200).json({
      message: "Perfil actualizado correctamente",
      userId: user.id,
    });
  } catch (error) {
    console.error("Error completando perfil:", error);
    res.status(500).json({ error: "Error interno al actualizar perfil" });
  }
};

export const userController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      birthDate,
      emergencyContactName,
      emergencyContactPhone,
    } = req.body;
    const newUser = await userService.createUser({
      email,
      password,
      name: firstName,
      lastname: lastName,
      phone,
      birthDate,
      emergencyContactName,
      emergencyContactPhone,
    });
    res.status(201).json(newUser);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Error creating user" });
  }
};

export const updateUserController = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, email, phone, branch, enabled } = req.body;

    const parsedUserId = parseInt(userId);
    if (isNaN(parsedUserId)) {
      res.status(400).json({ error: "ID de usuario inválido" });
      return;
    }

    // Parsear branch a número si existe
    const branchId = branch ? parseInt(branch) : undefined;

    const updatedUser = await prisma.user.update({
      where: { id: parsedUserId },
      data: {
        name: firstName,
        lastname: lastName,
        email,
        phone,
        branchOfficeId: branchId && !isNaN(branchId) ? branchId : undefined,
        enabled: enabled !== undefined ? Boolean(enabled) : undefined,
      },
    });

    res.json({
      message: "Usuario actualizado correctamente",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        lastname: updatedUser.lastname,
        email: updatedUser.email,
        phone: updatedUser.phone,
        branchOfficeId: updatedUser.branchOfficeId,
        enabled: updatedUser.enabled,
      },
    });
  } catch (error) {
    console.error("Error actualizando usuario:", error);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
};
export const deleteUserController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
export const getAllUsersController = async (req: Request, res: Response) => {
  try {
    const {
      limit = "10",
      page = "1",
      search = "",
      branchId = "",
      state = "",
      startDate = "",
      endDate = "",
    } = req.query;

    // Detectar si es una petición de exportación (sin paginación)
    const isExport = req.path.includes("/export");

    const limitNum = isExport ? 999999 : parseInt(limit as string);
    const pageNum = parseInt(page as string);
    const skip = isExport ? 0 : (pageNum - 1) * limitNum;

    // Construir filtros
    const where: any = {};

    // Búsqueda por nombre, apellido o email
    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { lastname: { contains: search as string } },
        { email: { contains: search as string } },
      ];
    }

    // Filtrar por sucursal
    if (branchId) {
      where.branchOfficeId = parseInt(branchId as string);
    }

    // Filtrar por estado (enabled)
    if (state === "enabled") {
      where.enabled = true;
    } else if (state === "disabled") {
      where.enabled = false;
    }

    // Filtrar por rango de fechas (createdAt)
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    // Obtener usuarios con paginación
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        include: {
          branchOffice: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Formatear respuesta
    const formattedUsers = users.map((user) => ({
      id: user.id,
      name: user.name,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      branchOffice: user.branchOffice?.name || "Sin asignar",
      enabled: user.enabled,
      createdAt: user.createdAt,
      roles: user.roles,
    }));

    // Si es exportación, devolver solo los datos sin paginación
    if (isExport) {
      res.json({
        data: formattedUsers,
        total,
      });
    } else {
      res.json({
        data: formattedUsers,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    }
  } catch (error) {
    console.error("Error getting users:", error);
    res.status(500).json({ error: "Error obteniendo usuarios" });
  }
};
export const getRecentUsersController = async (req: Request, res: Response) => {
  try {
    const recentUsers = await userService.getRecentUsers(5);
    res.json(recentUsers);
  } catch (error) {
    console.error("Error getting recent users:", error);
    res.status(500).json({ error: "Error obteniendo usuarios recientes" });
  }
};

export const getMyProfileController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Usuario no autenticado" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        phone: true,
        birthday: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        branchOfficeId: true,
        enabled: true,
        roles: true,
        permissions: true,
        freeSession: true,
        createdAt: true,
        branchOffice: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Formatear cumpleaños como dd/mm para el frontend, sin exponer año
    let birthdayDayMonth: string | null = null;
    if (user.birthday instanceof Date) {
      const day = String(user.birthday.getDate()).padStart(2, "0");
      const month = String(user.birthday.getMonth() + 1).padStart(2, "0");
      birthdayDayMonth = `${day}/${month}`;
    }

    // Obtener estadísticas calculadas en tiempo real
    const stats = await getUserClassStats(userId);

    res.status(200).json({
      ...user,
      birthday: birthdayDayMonth,
      ...stats,
    });
  } catch (error) {
    console.error("Error obteniendo perfil:", error);
    res.status(500).json({ error: "Error al obtener información del usuario" });
  }
};

export const getUserByIdController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { userId } = req.params;
    const parsedUserId = parseInt(userId);

    if (isNaN(parsedUserId)) {
      res.status(400).json({ error: "ID de usuario inválido" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        phone: true,
        birthday: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        branchOfficeId: true,
        enabled: true,
        roles: true,
        permissions: true,
        freeSession: true,
        createdAt: true,
        branchOffice: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Formatear cumpleaños como dd/mm para el frontend, sin exponer año
    let birthdayDayMonth: string | null = null;
    if (user.birthday instanceof Date) {
      const day = String(user.birthday.getDate()).padStart(2, "0");
      const month = String(user.birthday.getMonth() + 1).padStart(2, "0");
      birthdayDayMonth = `${day}/${month}`;
    }

    // Obtener estadísticas calculadas en tiempo real
    const stats = await getUserClassStats(parsedUserId);

    // Obtener las últimas 5 transacciones
    const recentTransactions = await prisma.transaction.findMany({
      where: {
        userId: parsedUserId,
        status: 1, // Pagado
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
      include: {
        package: {
          select: {
            id: true,
            altText: true,
            totalClasses: true,
            type: true,
            amount: true,
          },
        },
        branchOffice: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Obtener todas las reservaciones del usuario (sin límite),
    // pero manteniendo el nombre del campo "recentReservations" por compatibilidad.
    const recentReservations = await prisma.reservation.findMany({
      where: {
        userId: parsedUserId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        session: {
          include: {
            discipline: {
              select: {
                id: true,
                name: true,
              },
            },
            instructor: {
              select: {
                id: true,
                username: true,
                profile: {
                  select: {
                    firstname: true,
                    paternalSurname: true,
                    maternalSurname: true,
                  },
                },
              },
            },
            exerciseRoom: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        transaction: {
          select: {
            id: true,
            packageType: true,
          },
        },
      },
    });

    res.status(200).json({
      ...user,
      birthday: birthdayDayMonth, // siempre dd/mm o null
      ...stats, // Agrega classesAvailable, classesTaken, upcomingClasses, waitlistCount
      recentTransactions,
      recentReservations,
    });
  } catch (error) {
    console.error("Error obteniendo usuario:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : String(error)
    );
    console.error(
      "Error message:",
      error instanceof Error ? error.message : String(error)
    );
    res.status(500).json({ error: "Error al obtener información del usuario" });
  }
};
export const updateMyProfileController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Usuario no autenticado" });
      return;
    }

    const {
      name,
      lastname,
      phone,
      emergencyContactName,
      emergencyContactPhone,
    } = req.body;

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (lastname !== undefined) updateData.lastname = lastname;
    if (phone !== undefined) updateData.phone = phone;
    if (emergencyContactName !== undefined)
      updateData.emergencyContactName = emergencyContactName;
    if (emergencyContactPhone !== undefined)
      updateData.emergencyContactPhone = emergencyContactPhone;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        phone: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
      },
    });

    res.status(200).json({
      message: "Perfil actualizado correctamente",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error actualizando perfil:", error);
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
};
export const adminResetPasswordController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId } = req.params as { userId: string };
    const { newPassword } = req.body as { newPassword?: string };

    const id = Number(userId);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "ID de usuario inválido" });
      return;
    }

    // Si no nos mandan una contraseña explícita, generamos una temporal
    let passwordToSet = newPassword;
    if (!passwordToSet || typeof passwordToSet !== "string") {
      // 8 caracteres hex aleatorios (4 bytes)
      passwordToSet = Math.random().toString(36).slice(-8);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordToSet, salt);

    const user = await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: { id: true, email: true, name: true },
    });

    res.status(200).json({
      message: "Contraseña restablecida correctamente",
      user,
      // Si la contraseña fue generada por el backend, la devolvemos
      generatedPassword: newPassword ? undefined : passwordToSet,
    });
  } catch (error) {
    console.error("Error en adminResetPasswordController:", error);
    res.status(500).json({ error: "Error al restablecer la contraseña" });
  }
};
export const enableUserController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
export const disableUserController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
export const getUsersStatsController = async (req: Request, res: Response) => {
  try {
    console.log("Starting getUsersStatsController...");
    const stats = await userService.getUsersStats();
    console.log("Stats retrieved:", stats);
    res.json(stats);
  } catch (error) {
    console.error("Error getting user stats:", error);
    res
      .status(500)
      .json({ error: "Error obteniendo estadísticas de usuarios" });
  }
};
export const updateMyBirthDateController = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Usuario no autenticado" });
      return;
    }

    const { birthDate } = req.body as { birthDate?: string };

    if (!birthDate || typeof birthDate !== "string") {
      res.status(400).json({ error: "Formato de fecha inválido" });
      return;
    }

    // Esperamos formato dd/mm (sin año), igual que en createUser
    const parts = birthDate.trim().split("/");
    if (parts.length !== 2) {
      res.status(400).json({ error: "La fecha debe tener formato dd/mm" });
      return;
    }

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);

    if (
      !Number.isFinite(day) ||
      !Number.isFinite(month) ||
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12
    ) {
      res
        .status(400)
        .json({ error: "La fecha debe tener un día y mes válidos" });
      return;
    }

    // Usar año 2000 como en la creación de usuario
    const testDate = new Date(2000, month - 1, day);
    if (testDate.getDate() !== day || testDate.getMonth() !== month - 1) {
      res.status(400).json({ error: "La fecha de cumpleaños no es válida" });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        birthday: testDate,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        birthday: true,
      },
    });

    res.status(200).json({
      message: "Fecha de cumpleaños actualizada correctamente",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error actualizando fecha de cumpleaños:", error);
    res
      .status(500)
      .json({ error: "Error al actualizar la fecha de cumpleaños" });
  }
};
export const searchUsersController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
export const searchUsersByFirstNameController = async (
  req: Request,
  res: Response
) => {
  try {
    const { q, limit = "10" } = req.query;

    if (!q || typeof q !== "string") {
      res.status(400).json({ error: "El parámetro 'q' es requerido" });
      return;
    }

    const limitNum = parseInt(limit as string);

    const users = await prisma.user.findMany({
      where: {
        enabled: true, // Solo usuarios activos
        OR: [
          { name: { contains: q } },
          { lastname: { contains: q } },
          { email: { contains: q } },
        ],
      },
      take: limitNum,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        lastname: true,
        email: true,
        phone: true,
        branchOfficeId: true,
        enabled: true,
        branchOffice: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    res.json({
      data: users,
      total: users.length,
    });
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({ error: "Error buscando usuarios" });
  }
};
export const deleteOldUsersController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
