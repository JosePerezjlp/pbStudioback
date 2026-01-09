import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { userService } from "../services/user.service";
import { ADMIN_PERMISSIONS } from "../constants/userPermissions";

const JWT_SECRET =
  process.env.JWT_SECRET || "secreto_super_seguro_para_desarrollo";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const googleClient = GOOGLE_CLIENT_ID
  ? new OAuth2Client(GOOGLE_CLIENT_ID)
  : undefined;

export const loginController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, password, isDashboard } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email y contraseña son requeridos" });
      return;
    }

    const user = await userService.validateUser(email, password, isDashboard);

    if (!user) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    // Generar y guardar sessionId para validar sesión única
    const sessionId = `session_${user.type}_${user.id}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}`;
    await userService.updateSessionId(user.id, user.type, sessionId);
    user.sessionId = sessionId;

    // Generar Token JWT
    const token = jwt.sign(
      {
        uid: `sql_${user.id}`,
        id: user.id,
        email: user.email,
        role: user.role,
        type: user.type,
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
        uid: `sql_${user.id}`,
        email: user.email,
        role: user.role,
        name: user.name,
        isAdmin: user.isAdmin,
        branches: user.branches || [],
        permissions:
          user.isAdmin || user.role === "admin"
            ? ADMIN_PERMISSIONS
            : user.permissions || {},
        sessionId: sessionId,
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
      res.status(400).json({
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
  try {
    const { provider, idToken } = req.body;

    if (provider !== "google") {
      res.status(400).json({ error: "Proveedor OAuth no soportado" });
      return;
    }

    if (!idToken) {
      res.status(400).json({ error: "idToken de Google es requerido" });
      return;
    }

    if (!GOOGLE_CLIENT_ID || !googleClient) {
      console.error("GOOGLE_CLIENT_ID no está configurado");
      res.status(500).json({ error: "OAuth de Google no está configurado" });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.email) {
      res.status(400).json({ error: "Token de Google inválido" });
      return;
    }

    if (payload.email_verified === false) {
      res.status(400).json({ error: "El email de Google no está verificado" });
      return;
    }

    const email = payload.email;
    const name =
      payload.given_name || payload.name || email.split("@")[0] || "Usuario";
    const lastname = payload.family_name || undefined;

    const { user, isNewUser } = await userService.loginOrRegisterWithGoogle({
      email,
      name,
      lastname,
    });

    const sessionId = `session_${user.type}_${user.id}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}`;
    await userService.updateSessionId(user.id, user.type, sessionId);
    user.sessionId = sessionId;

    const token = jwt.sign(
      {
        uid: `sql_${user.id}`,
        id: user.id,
        email: user.email,
        role: user.role,
        type: user.type,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login OAuth Google exitoso",
      token,
      user: {
        id: user.id,
        uid: `sql_${user.id}`,
        email: user.email,
        role: user.role,
        name: user.name,
        isAdmin: user.isAdmin,
        branches: user.branches || [],
        permissions:
          user.isAdmin || user.role === "admin"
            ? ADMIN_PERMISSIONS
            : user.permissions || {},
        sessionId,
      },
      isNewUser,
      needsProfile: isNewUser,
    });
  } catch (error) {
    console.error("OAuth login error:", error);
    res.status(500).json({ error: "Error interno en login OAuth" });
  }
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
