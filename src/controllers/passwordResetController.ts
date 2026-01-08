import { Request, Response } from "express";
import prisma from "../config/prisma";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { sendPasswordResetCodeEmail } from "../utils/emailService";

/* ---------- 1) Solicitar código ---------- */
export const requestResetCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.body as { email: string };
    if (!email) {
      res.status(400).json({ error: "Email es requerido" });
      return;
    }

    /* 1. Obtener usuario */
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    // Parse roles if needed, or just check generic logic
    const roles = user.roles ? JSON.parse(user.roles) : [];
    if (roles.includes("admin")) {
      res.status(403).json({ error: "No permitido para administradores" });
      return;
    }

    /* 2. Generar código y fecha de expiración */
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h

    /* 3. Guardar (Upsert) */
    await prisma.passwordReset.upsert({
      where: { email },
      update: {
        code,
        token,
        expiresAt,
        used: false,
        createdAt: new Date(),
      },
      create: {
        email,
        code,
        token,
        expiresAt,
        used: false,
      },
    });

    /* 4. Email */
    await sendPasswordResetCodeEmail(email, user.name || "Usuario", code);

    res.status(200).json({ message: "Código enviado" });
  } catch (err) {
    console.error("❌ requestResetCode:", err);
    res.status(500).json({ error: "Error enviando código" });
  }
};

/* ---------- helper para leer / validar ---------- */
const getAndValidate = async (email: string, code: string | undefined) => {
  const resetRecord = await prisma.passwordReset.findUnique({
    where: { email },
  });

  if (!resetRecord) return { ok: false, reason: "Código no encontrado" };

  if (resetRecord.used) return { ok: false, reason: "Código ya usado" };
  if (new Date() > resetRecord.expiresAt)
    return { ok: false, reason: "Código expirado" };
  if (code && code !== resetRecord.code)
    return { ok: false, reason: "Código inválido" };

  return { ok: true, resetRecord };
};

/* ---------- 2) Verificar código ---------- */
export const verifyResetCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, code } = req.body as { email: string; code: string };

    const { ok, reason } = await getAndValidate(email, code);
    if (!ok) {
      res.status(400).json({ error: reason });
      return;
    }
    res.status(200).json({ message: "Código válido" });
  } catch (err) {
    console.error("❌ verifyResetCode:", err);
    res.status(500).json({ error: "Error verificando código" });
  }
};

/* ---------- 3) Confirmar nueva contraseña ---------- */
export const confirmPasswordReset = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body as {
      email: string;
      code: string;
      newPassword: string;
    };

    if (!email || !code || !newPassword) {
      res.status(400).json({ error: "Datos incompletos" });
      return;
    }

    const { ok, reason, resetRecord } = await getAndValidate(email, code);
    if (!ok || !resetRecord) {
      res.status(400).json({ error: reason });
      return;
    }

    /* 1. Buscar usuario */
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    /* 2. Hash password */
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    /* 3. Cambiar contraseña en User */
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    /* 4. Marcar código como usado */
    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true },
    });

    res.status(200).json({ message: "Contraseña actualizada" });
  } catch (err) {
    console.error("❌ confirmPasswordReset:", err);
    res.status(500).json({ error: "Error al actualizar contraseña" });
  }
};
