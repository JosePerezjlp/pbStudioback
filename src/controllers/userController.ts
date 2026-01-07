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
  res.status(501).json({ message: "Not implemented" });
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
    } = req.query;

    const limitNum = parseInt(limit as string);
    const pageNum = parseInt(page as string);
    const skip = (pageNum - 1) * limitNum;

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

    res.json({
      data: formattedUsers,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
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
export const getUserByIdController = async (
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
      birthday: birthdayDayMonth, // siempre dd/mm o null
      ...stats, // Agrega classesAvailable, classesTaken, upcomingClasses, waitlistCount
    });
  } catch (error) {
    console.error("Error obteniendo usuario:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : String(error));
    console.error("Error message:", error instanceof Error ? error.message : String(error));
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
) => {
  res.status(501).json({ message: "Not implemented" });
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
  res.status(501).json({ message: "Not implemented" });
};
export const deleteOldUsersController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
