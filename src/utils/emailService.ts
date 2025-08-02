import { Resend } from "resend";
import admin from "../config/firebase";

const resend = new Resend(process.env.RESEND_API_KEY); // usa variables de entorno en producción

const FROM = "PB Studio <admin@pbstudioapp.com>"; // puedes personalizarlo si ya tienes un dominio verificado

export const sendWelcomeEmail = async (to: string, name: string) => {
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "¡Bienvenido a PB Studio!",
      html: `<strong>Hola ${name},</strong><br/>Gracias por registrarte en PB Studio. ¡Estamos felices de tenerte aquí!`,
    });
  } catch (error) {
    console.error("Error enviando welcome email:", error);
  }
};

export const sendPackagePurchaseEmail = async (
  to: string,
  name: string,
  packageName: string,
  totalClasses: number,
  expiresAt: string | null,
  modality?: string
) => {
  const formattedDate = expiresAt
    ? new Date(expiresAt).toLocaleDateString("es-CO", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Sin vencimiento";

  const formattedModality = modality
    ? modality.charAt(0).toUpperCase() + modality.slice(1)
    : packageName;

  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "¡Compra de paquete exitosa!",
      html: `
        <p><strong>Hola ${name},</strong></p>
        <p>Confirmamos la compra del paquete <strong>${packageName}</strong>.</p>
        <ul>
          <li><strong>Clases incluidas:</strong> ${totalClasses}</li>
          <li><strong>Modalidad:</strong> ${formattedModality}</li>
          <li><strong>Vence:</strong> ${formattedDate}</li>
        </ul>
        <p>Gracias por tu confianza en PB Studio.</p>
      `,
    });
  } catch (error) {
    console.error("Error enviando email de compra de paquete:", error);
  }
};

export const sendReservationConfirmationEmail = async (
  to: string,
  name: string,
  classInfo: string
) => {
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Reserva confirmada",
      html: `<strong>Hola ${name},</strong><br/>Tu reserva para la clase <b>${classInfo}</b> ha sido confirmada.`,
    });
  } catch (error) {
    console.error("Error enviando email de reserva:", error);
  }
};

export const sendReservationCancelledEmail = async (
  to: string,
  name: string,
  classInfo: string
) => {
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Reserva cancelada",
      html: `<strong>Hola ${name},</strong><br/>Tu reserva para la clase <b>${classInfo}</b> ha sido cancelada.`,
    });
  } catch (error) {
    console.error("Error enviando email de cancelación:", error);
  }
};

export const sendPackageExpiryWarningEmail = async (
  to: string,
  name: string,
  daysLeft: number
) => {
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Tu paquete está por vencer",
      html: `<strong>Hola ${name},</strong><br/>Tu paquete vencerá en <b>${daysLeft}</b> días. ¡Aprovecha tus clases antes de que expire!`,
    });
  } catch (error) {
    console.error("Error enviando email de expiración de paquete:", error);
  }
};

export const sendClassReminderEmail = async (
  to: string,
  name: string,
  info: { day: string; hour: string; discipline: string; branch: string }
) => {
  const { day, hour, discipline, branch } = info;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "⏰ ¡Tu clase comienza en 2 horas!",
    html: `
      <p>Hola ${name},</p>
      <p>Este es un recordatorio de tu clase:</p>
      <ul>
        <li><strong>Disciplina:</strong> ${discipline}</li>
        <li><strong>Fecha:</strong> ${day}</li>
        <li><strong>Hora:</strong> ${hour}</li>
        <li><strong>Sucursal:</strong> ${branch}</li>
      </ul>
      <p>¡Nos vemos pronto! 💪</p>
    `,
  });
};

/* ===============================================================
   CONTACTO WEB
   =============================================================== */

/** 1) Notificación interna */

export const getAdminContactEmail = async (): Promise<string | null> => {
  try {
    const doc = await admin
      .firestore()
      .collection("configurations")
      .doc("general_settings")
      .get();

    const data = doc.data();
    return data?.email || null;
  } catch (err) {
    console.error("Error al obtener el correo de contacto:", err);
    return null;
  }
};

export const sendContactNotificationEmail = async (payload: {
  name: string;
  phone: string;
  email: string;
  message: string;
}) => {
  const { name, phone, email, message } = payload;

  const adminEmail = await getAdminContactEmail();

  if (!adminEmail) {
    console.error("❌ No se encontró un email de contacto configurado.");
    return;
  }

  await resend.emails.send({
    from: FROM,
    to: adminEmail,
    subject: "📩 Nuevo mensaje de contacto",
    html: `
      <h3>Datos enviados desde el formulario</h3>
      <ul>
        <li><strong>Nombre:</strong> ${name}</li>
        <li><strong>Teléfono:</strong> ${phone || "—"}</li>
        <li><strong>Email:</strong> ${email}</li>
      </ul>
      <p><strong>Mensaje:</strong></p>
      <p>${message.replace(/\n/g, "<br/>")}</p>
    `,
  });
};

/** 2) Autorespuesta al visitante */
export const sendContactAutoReplyEmail = async (payload: {
  name: string;
  email: string;
}) => {
  const { name, email } = payload;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "¡Hemos recibido tu mensaje en PB Studio!",
    html: `
      <p>Hola ${name},</p>
      <p>Gracias por escribirnos. Hemos recibido tu mensaje y nos pondremos en contacto contigo lo antes posible.</p>
      <p>— Equipo PB Studio</p>
    `,
  });
};
// Restablecer password

/* Envía un código de 6 dígitos para restablecer contraseña */
export const sendPasswordResetCodeEmail = async (
  to: string,
  name: string,
  code: string
) => {
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Código para restablecer tu contraseña",
    html: `
      <p>Hola ${name},</p>
      <p>Tu código de verificación es:</p>
      <h2 style="letter-spacing:4px">${code}</h2>
      <p>Caduca en 2&nbsp;horas. Si no pediste este código, ignora este correo.</p>
    `,
  });
};

async function getClassInfo(classId: string) {
  const doc = await admin.firestore().collection("classes").doc(classId).get();
  if (!doc.exists) throw new Error("Clase no encontrada para email");
  const { discipline, day, hour } = doc.data() as {
    discipline: string;
    day: string;
    hour: string;
  };
  const dateStr = new Date(`${day}T00:00:00`).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return { discipline, dateStr, hour };
}

/**
 * Al entrar en lista de espera.
 */
export const sendWaitlistEntryEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Estás en la lista de espera",
      html: `
        <p>Hola ${name},</p>
        <p>Has ingresado en la lista de espera para la clase <strong>${discipline}</strong> el ${dateStr} a las ${hour}.</p>
        <p>Te notificaremos tan pronto como se libere un cupo. ¡Gracias por tu paciencia!</p>
      `,
    });
  } catch (error) {
    console.error("Error enviando email de lista de espera:", error);
  }
};

/**
 * Cuando se libera un cupo y aceptamos al usuario.
 */
export const sendWaitlistAcceptedEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);
    await resend.emails.send({
      from: FROM,
      to,
      subject: "¡Cupo disponible en tu lista de espera!",
      html: `
        <p>Hola ${name},</p>
        <p>¡Buenas noticias! Se ha liberado un cupo para la clase <strong>${discipline}</strong> el ${dateStr} a las ${hour}.</p>
        <p>Tu reserva ha sido creada automáticamente. ¡Nos vemos en clase!</p>
      `,
    });
  } catch (error) {
    console.error(
      "Error enviando email de aceptación de lista de espera:",
      error
    );
  }
};

/**
 * Cuando la ventana de espera finaliza sin cupo.
 */
export const sendWaitlistRejectedEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Tu solicitud en lista de espera ha finalizado",
      html: `
        <p>Hola ${name},</p>
        <p>Lamentablemente no se liberó ningún cupo para la clase <strong>${discipline}</strong> el ${dateStr} a las ${hour}.</p>
        <p>Tu solicitud ha sido rechazada, pero podrás intentarlo de nuevo en futuras ocasiones.</p>
      `,
    });
  } catch (error) {
    console.error("Error enviando email de rechazo de lista de espera:", error);
  }
};
