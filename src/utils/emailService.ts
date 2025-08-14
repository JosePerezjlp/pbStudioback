import { Resend } from "resend";
import admin from "../config/firebase";

const resend = new Resend(process.env.RESEND_API_KEY); // usa variables de entorno en producción

const FROM = "PB Studio <admin@pbstudioapp.com>"; // puedes personalizarlo si ya tienes un dominio verificado

// utilidad para escapar HTML en strings dinámicos
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );

// Envia con imagen al registrar
export const sendWelcomeEmail = async (to: string, name: string) => {
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `¡Bienvenido ${name} a PB Studio!`,
      html: `
      <!-- Wrapper a 100% -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
        <tr>
          <td align="center">
            <!-- Contenedor centrado -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
              <tr>
                <td align="center" style="padding:24px 16px 8px 16px;">
                  <img 
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2FRegistroemail.jpeg?alt=media&token=314a8fde-30a3-454c-9481-231f579d7a20" 
                    alt="Bienvenida de PB Studio"
                    width="600"
                    style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
                  />
                </td>
              </tr>

              <!-- Espaciador compatible -->
              <tr>
                <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    Hola ${name}, gracias por registrarte en PB Studio.
                    <br/>¡Estamos felices de tenerte aquí!
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando welcome email:", error);
  }
};

// Envia con imagen para confirmar reserva
export const sendReservationConfirmationEmail = async (
  to: string,
  name: string,
  classInfo: string
) => {
  try {
    const safeName = escapeHtml(name);
    const safeClass = escapeHtml(classInfo);

    await resend.emails.send({
      from: FROM,
      to,
      subject: `Reserva confirmada: ${safeClass}`,
      html: `
      <!-- Preheader (vista previa en inbox) -->
      <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        Tu reserva para "${safeClass}" ha sido confirmada.
      </div>

      <!-- Wrapper a 100% -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
        <tr>
          <td align="center">
            <!-- Contenedor centrado -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
              
              <tr>
                <td align="center" style="padding:24px 16px 8px 16px;">
                  <img
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2FReservaconfirm.jpeg?alt=media&token=0c1f6357-cde3-4a03-8045-2acce3f13695"
                    alt="Reserva confirmada en PB Studio"
                    width="600"
                    style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
                  />
                </td>
              </tr>

              <!-- Espaciador -->
              <tr>
                <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 8px 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    Hola ${safeName}, tu reserva para <strong>${safeClass}</strong> ha sido confirmada.
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#555555;">
                    Si necesitas cancelar, hazlo desde tu cuenta con la antelación indicada para evitar penalidades.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando email de reserva:", error);
  }
};


// Envia copn imagen para cancelar reserva
export const sendReservationCancelledEmail = async (
  to: string,
  name: string,
  classInfo: string
) => {
  try {
    const safeName = escapeHtml(name);
    const safeClass = escapeHtml(classInfo);

    await resend.emails.send({
      from: FROM,
      to,
      subject: `Reserva cancelada: ${safeClass}`,
      html: `
      <!-- Preheader -->
      <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        Tu reserva para "${safeClass}" ha sido cancelada.
      </div>

      <!-- Wrapper a 100% -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
        <tr>
          <td align="center">
            <!-- Contenedor centrado -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
              
              <tr>
                <td align="center" style="padding:24px 16px 8px 16px;">
                  <img
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2FReservaCancelada.jpeg?alt=media&token=7547e7cd-1119-4bc9-bd28-b73c75a68a66"
                    alt="Reserva cancelada en PB Studio"
                    width="600"
                    style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
                  />
                </td>
              </tr>

              <!-- Espaciador -->
              <tr>
                <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 8px 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    Hola ${safeName}, tu reserva para <strong>${safeClass}</strong> ha sido cancelada.
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#555555;">
                    Si fue un error o deseas reprogramar, puedes reservar nuevamente cuando quieras.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando email de cancelación:", error);
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

// Envia con imagen al entrar en lista de espera
export const sendWaitlistEntryEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);

    const safeName = escapeHtml(name);
    const safeDiscipline = escapeHtml(discipline);
    const safeDate = escapeHtml(dateStr);
    const safeHour = escapeHtml(hour);

    await resend.emails.send({
      from: FROM,
      to,
      subject: `Lista de espera: ${safeDiscipline} — ${safeDate} ${safeHour}`,
      html: `
      <!-- Preheader -->
      <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        Has ingresado en la lista de espera para "${safeDiscipline}" el ${safeDate} a las ${safeHour}.
      </div>

      <!-- Wrapper a 100% -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
        <tr>
          <td align="center">
            <!-- Contenedor centrado -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">

              <tr>
                <td align="center" style="padding:24px 16px 8px 16px;">
                  <img
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2FIngresoListaEspera.jpeg?alt=media&token=d8468a66-6397-4bc8-aacb-bf5a75b7afbc"
                    alt="Ingreso a lista de espera en PB Studio"
                    width="600"
                    style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
                  />
                </td>
              </tr>

              <!-- Espaciador -->
              <tr>
                <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 8px 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    Hola ${safeName}, entraste en la lista de espera para
                    <strong>${safeDiscipline}</strong> el <strong>${safeDate}</strong> a las <strong>${safeHour}</strong>.
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#555555;">
                    Te notificaremos automáticamente si se libera un cupo. Gracias por tu paciencia.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando email de lista de espera:", error);
  }
};


// Envia con imagen cuando se le da cupo al usuario de la lista de espera
export const sendWaitlistAcceptedEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);

    const safeName = escapeHtml(name);
    const safeDiscipline = escapeHtml(discipline);
    const safeDate = escapeHtml(dateStr);
    const safeHour = escapeHtml(hour);

    await resend.emails.send({
      from: FROM,
      to,
      subject: `¡Cupo disponible: ${safeDiscipline} — ${safeDate} ${safeHour}`,
      html: `
      <!-- Preheader -->
      <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        ¡Se liberó un cupo! Tu reserva para "${safeDiscipline}" el ${safeDate} a las ${safeHour} fue creada automáticamente.
      </div>

      <!-- Wrapper -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
        <tr>
          <td align="center">
            <!-- Contenedor -->
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">

              <tr>
                <td align="center" style="padding:24px 16px 8px 16px;">
                  <img
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2FAceptacionListaDeEspera.jpeg?alt=media&token=799c5ec8-6c8d-40c0-9a18-065a192de6ac"
                    alt="Cupo disponible en PB Studio"
                    width="600"
                    style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
                  />
                </td>
              </tr>

              <tr>
                <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 8px 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    Hola ${safeName}, ¡buenas noticias! Se liberó un cupo para
                    <strong>${safeDiscipline}</strong> el <strong>${safeDate}</strong> a las <strong>${safeHour}</strong>.
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#555555;">
                    Tu reserva fue creada automáticamente. Si no puedes asistir, recuerda cancelarla con la antelación establecida.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando email de aceptación de lista de espera:", error);
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

// Cancelacion de lista de espera

export const sendWaitlistCancelledByUserEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Has salido de la lista de espera",
      html: `
        <p>Hola ${name},</p>
        <p>Has cancelado tu solicitud en lista de espera para la clase <strong>${discipline}</strong> del ${dateStr} a las ${hour}.</p>
        <p>Si cambias de opinión, puedes volver a unirte desde la agenda.</p>
      `,
    });
  } catch (error) {
    console.error(
      "Error enviando email de cancelación de lista de espera por el usuario:",
      error
    );
  }
};
