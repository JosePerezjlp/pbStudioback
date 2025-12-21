import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { userService } from "../services/user.service";

const JWT_SECRET =
  process.env.JWT_SECRET || "secreto_super_seguro_para_desarrollo";

export const loginController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email y contraseña son requeridos" });
      return;
    }

    const user = await userService.validateUser(email, password);

    if (!user) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    // Generar Token JWT
    const token = jwt.sign(
      {
        uid: user.firebaseUid || `sql_${user.id}`, // Mantener compatibilidad con estructura de token
        id: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" } // Token dura 7 días
    );

    // Responder con estructura similar a la que espera el frontend (adaptada)
    res.json({
      message: "Login exitoso",
      token,
      user: {
        id: user.id,
        uid: user.firebaseUid,
        email: user.email,
        role: user.role,
        name: user.name,
        isAdmin: user.isAdmin,
        branches: user.branches || [],
        // Campos legacy que el frontend podría esperar
        permissions: {}, // Rellenar si es necesario
        sessionId: "session_sql_" + Date.now(),
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const registerController = async (
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

    if (!email || !password || !firstName) {
      res
        .status(400)
        .json({
          error: "Faltan datos obligatorios (email, password, firstName)",
        });
      return;
    }

    // Verificar si ya existe (userService.validateUser busca por email primero implícitamente al validar,
    // pero aquí mejor verificamos duplicados al intentar crear)
    try {
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

      // Auto-login al registrar
      const token = jwt.sign(
        {
          uid: `sql_${newUser.id}`,
          id: newUser.id,
          email: newUser.email,
          role: "user",
          type: "user",
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.status(201).json({
        message: "Usuario registrado correctamente",
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: "user",
        },
      });
    } catch (e: any) {
      if (e.code === "P2002") {
        // Prisma unique constraint violation
        res.status(409).json({ error: "El email ya está registrado" });
        return;
      }
      throw e;
    }
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Error al registrar usuario" });
  }
};

export const oauthLoginController = async (
  req: Request,
  res: Response
): Promise<void> => {
  res.status(501).json({ error: "Not implemented" });
};

export const logoutController = async (
  req: Request,
  res: Response
): Promise<void> => {
  res.json({ message: "Logged out" });
};

export const forceLogoutController = async (
  req: Request,
  res: Response
): Promise<void> => {
  res.json({ message: "Forced logout" });
};
