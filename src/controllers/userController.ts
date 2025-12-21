import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../config/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { sendWelcomeEmail } from "../utils/emailService";

import { userService } from "../services/user.service";

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
      updateData.birthday = new Date(birthDate);
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
  res.status(501).json({ message: "Not implemented" });
};
export const getRecentUsersController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
export const getUserByIdController = async (req: Request, res: Response) => {
  res.status(501).json({ message: "Not implemented" });
};
export const updateMyProfileController = async (
  req: Request,
  res: Response
) => {
  res.status(501).json({ message: "Not implemented" });
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
  res.status(501).json({ message: "Not implemented" });
};
export const updateMyBirthDateController = async (
  req: Request,
  res: Response
) => {
  res.status(501).json({ message: "Not implemented" });
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
