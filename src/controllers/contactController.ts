import { Request, Response } from "express";
import { sendContactAutoReplyEmail, sendContactNotificationEmail } from "../utils/emailService";

interface PropsFormContact {
  name: string;
  phone: string;
  email: string;
  message: string;
}

/**
 * POST /contact
 * Guarda el mensaje de contacto (si quieres, en Firestore) y envía:
 *   1) Notificación a admin@pbstudioapp.com con los datos del interesado
 *   2) Autorespuesta de confirmación al usuario
 */
export const sendContactMessageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { name, phone, email, message } = req.body as PropsFormContact;

    /** ---------- Validaciones básicas ---------- */
    if (!name || !email || !message) {
      res.status(400).json({ error: "Faltan campos requeridos" });
      return;
    }

    /** ---------- (Opcional) Guardar en Base de Datos ---------- */
    // Si se desea guardar historial de contactos, descomentar y adaptar modelo Contact
    // await prisma.contact.create({
    //   data: {
    //     name,
    //     phone,
    //     email,
    //     message,
    //     createdAt: new Date(),
    //   }
    // });

    /** ---------- Envío de correos ---------- */
    await Promise.all([
      sendContactNotificationEmail({ name, phone, email, message }),
      sendContactAutoReplyEmail({ name, email }),
    ]);

    res.status(200).json({ message: "Mensaje enviado correctamente" });
  } catch (err) {
    console.error("❌ Error procesando contacto:", err);
    res.status(500).json({ error: "No se pudo enviar el mensaje" });
  }
};
