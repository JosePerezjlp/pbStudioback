import { Resend } from "resend";
import { formatDateVisibleMx } from "./time";
import { prisma } from "../config/prisma";

const resend = new Resend(process.env.RESEND_API_KEY); // usa variables de entorno en producción

// Flag global para deshabilitar envíos reales de correo.
// De momento lo dejamos en true para NO enviar nada por Resend.
const EMAIL_SENDING_DISABLED = true;

// Helper centralizado: respeta el flag y evita tocar cada llamada a Resend
const safeSendEmail = async (
  params: Parameters<(typeof resend.emails)["send"]>[0]
) => {
  if (EMAIL_SENDING_DISABLED) {
    return; // noop temporal: no envía nada
  }
  await resend.emails.send(params);
};

const FROM = "PB Studio <admin@pbstudioapp.com>"; // puedes personalizarlo si ya tienes un dominio verificado
const BASE_URL =
  process.env.API_URL || "https://webpbstudio-produccion.onrender.com";

// utilidad para escapar HTML en strings dinámicos
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );

// utilidad para convertir tipo de clase a formato legible
const formatClassType = (type: string | undefined): string => {
  if (!type) return "Individual";

  const normalizedType = type.toLowerCase();
  if (normalizedType.includes("group") || normalizedType.includes("grupal")) {
    return "Grupal";
  }
  return "Individual";
};

// Envia con imagen al registrar
export const sendWelcomeEmail = async (to: string, name: string) => {
  try {
    await safeSendEmail({
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F1.png?alt=media&token=32f07784-e443-42b2-821c-7e4aa1936d94" 
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
  classInfo: string,
  typeClass: string,
  seatNumber?: number | null
) => {
  try {
    const safeName = escapeHtml(name);
    const safeClass = escapeHtml(classInfo);

    // Determinar tipo de reserva
    const classTypeLower = typeClass.toLowerCase();
    const isGrupal =
      classTypeLower.includes("grup") || classTypeLower.includes("groups");
    const reservationType = isGrupal ? "Reserva Grupal" : "Reserva Individual";

    // Generar información del asiento para clases grupales
    let seatInfo = "";
    if (seatNumber !== null && seatNumber !== undefined && isGrupal) {
      seatInfo = `<br/><br/><strong>🎫 Tu lugar:</strong> Asiento #${seatNumber}`;
    }

    await safeSendEmail({
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F4.png?alt=media&token=dfe672c1-d6f7-49ef-9b36-a01c953d5d0c"
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
                    Hola ${safeName}, tu <strong>${reservationType}</strong> para <strong>${safeClass}</strong> ha sido confirmada.${seatInfo}
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#555555;">
                    Si necesitas cancelar, hazlo desde tu cuenta con 12 horas de anticipación para evitar penalidades.
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
  classInfo: string,
  classType?: string
) => {
  try {
    const safeName = escapeHtml(name);
    const safeClass = escapeHtml(classInfo);
    const formattedClassType = formatClassType(classType);

    await safeSendEmail({
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F5.png?alt=media&token=b38df4dd-2640-4a3c-b413-bd83297c9645"
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
                    Hola ${safeName}, tu reserva para <strong>${safeClass} ${formattedClassType}</strong> ha sido cancelada.
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

// Compra de paqquete enviando con imagen
export const sendPackagePurchaseEmail = async (
  to: string,
  name: string,
  packageName: string,
  totalClasses: number,
  expiresAt: string | null,
  modality?: string
) => {
  const formattedDate = expiresAt
    ? formatDateVisibleMx(expiresAt.slice(0, 10))
    : "Sin vencimiento";

  const formattedModality = modality
    ? modality.charAt(0).toUpperCase() + modality.slice(1)
    : packageName;

  try {
    await safeSendEmail({
      from: FROM,
      to,
      subject: "¡Compra de paquete exitosa!",
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F9.png?alt=media&token=d018147c-e4a3-4ab9-8d6f-e18836e930ee"
                    alt="PB Studio - Compra de paquete confirmada"
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
                <td align="center" style="padding:0 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    <strong>Hola ${name},</strong><br/>
                    ¡Tu compra se realizó con éxito! Estos son los detalles de tu paquete:
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:16px 24px 8px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
                    <tr>
                      <td style="font-size:14px;line-height:22px;color:#111827;padding:8px 0;">
                        <strong>Paquete:</strong> ${packageName}
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:14px;line-height:22px;color:#111827;padding:8px 0;">
                        <strong>Clases incluidas:</strong> ${totalClasses}
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:14px;line-height:22px;color:#111827;padding:8px 0;">
                        <strong>Modalidad:</strong> ${formattedModality}
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:14px;line-height:22px;color:#111827;padding:8px 0;">
                        <strong>Vencimiento:</strong> ${formattedDate}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:8px 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:22px;color:#4b5563;">
                    ¡Gracias por confiar en <strong>PB Studio</strong>!<br/>
                    Te esperamos en clase para que sigas cumpliendo tus objetivos.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando email de compra de paquete:", error);
  }
};

// Paqquete por ExpressValidator, Enviando con imagen
// export const sendPackageExpiryWarningEmail = async (
//   to: string,
//   name: string,
//   daysLeft: number
// ) => {
//   try {
//     const daysLabel = daysLeft === 1 ? "1 día" : `${daysLeft} días`;

//     await safeSendEmail({
//       from: FROM,
//       to,
//       subject: "Tu paquete está por vencer",
//       html: `
//       <!-- Wrapper a 100% -->
//       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
//         <tr>
//           <td align="center">
//             <!-- Contenedor centrado -->
//             <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
//               <tr>
//                 <td align="center" style="padding:24px 16px 8px 16px;">
//                   <img
//                     src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F14.png?alt=media&token=25e6628a-91f5-467a-bcc1-595715fb5669"
//                     alt="PB Studio - Paquete por expirar"
//                     width="600"
//                     style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
//                   />
//                 </td>
//               </tr>

//               <!-- Espaciador compatible -->
//               <tr>
//                 <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
//               </tr>

//               <tr>
//                 <td align="center" style="padding:0 24px;">
//                   <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
//                     Hola ${name},<br/>
//                     tu paquete <strong>vencerá en ${daysLabel}</strong>.
//                   </p>
//                 </td>
//               </tr>

//               <tr>
//                 <td align="center" style="padding:12px 24px 20px 24px;">
//                   <p style="margin:0;font-size:14px;line-height:22px;color:#4b5563;">
//                     ¡Aprovecha tus clases antes de que expire!<br/>
//                     Si ya realizaste la renovación, puedes ignorar este mensaje.
//                   </p>
//                 </td>
//               </tr>

//             </table>
//           </td>
//         </tr>
//       </table>`,
//     });
//   } catch (error) {
//     console.error("Error enviando email de expiración de paquete:", error);
//   }
// };

// NO IMAGEN
// export const sendClassReminderEmail = async (
//   to: string,
//   name: string,
//   info: { day: string; hour: string; discipline: string; branch: string },
//   classType?: string
// ) => {
//   const { day, hour, discipline, branch } = info;
//   const formattedClassType = formatClassType(classType);

//   await safeSendEmail({
//     from: FROM,
//     to,
//     subject: "⏰ ¡Tu clase comienza en 2 horas!",
//     html: `
//       <p>Hola ${name},</p>
//       <p>Este es un recordatorio de tu clase:</p>
//       <ul>
//         <li><strong>Disciplina:</strong> ${discipline} ${formattedClassType}</li>
//         <li><strong>Fecha:</strong> ${day}</li>
//         <li><strong>Hora:</strong> ${hour}</li>
//         <li><strong>Sucursal:</strong> ${branch}</li>
//       </ul>
//       <p>¡Nos vemos pronto! 💪</p>
//     `,
//   });
// };

/* ===============================================================
   CONTACTO WEB
   =============================================================== */

/** 1) Notificación interna */

export const getAdminContactEmail = async (): Promise<string | null> => {
  try {
    const config = await prisma.configuration.findFirst({
      where: { module: "general_settings" },
    });

    if (!config || !config.data) return null;

    // Assuming data is stored as a JSON string
    const data = JSON.parse(config.data);
    return data?.email || null;
  } catch (err) {
    console.error("Error al obtener el correo de contacto:", err);
    return null;
  }
};

// NO PROPORCIONAN IMAGEN
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

  await safeSendEmail({
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

/** 2) Autorespuesta al visitante NO PROPORCIONAN IMAGEN */
export const sendContactAutoReplyEmail = async (payload: {
  name: string;
  email: string;
}) => {
  const { name, email } = payload;

  await safeSendEmail({
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

/* Envía un código de 6 dígitos para restablecer contraseña enviop con imagen */
export const sendPasswordResetCodeEmail = async (
  to: string,
  name: string,
  code: string
) => {
  try {
    await safeSendEmail({
      from: FROM,
      to,
      subject: "Código para restablecer tu contraseña",
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F8.png?alt=media&token=38ac99b8-c2eb-46dc-a50b-e0913f1405af" 
                    alt="PB Studio - Restablecer contraseña"
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
                <td align="center" style="padding:0 24px;">
                  <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
                    Hola ${name},<br/>
                    usa el siguiente código para restablecer tu contraseña:
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:16px 24px 0 24px;">
                  <div style="
                    display:inline-block;
                    padding:12px 20px;
                    border-radius:8px;
                    background:#f3f4f6;
                    font-size:22px;
                    line-height:28px;
                    font-weight:700;
                    letter-spacing:6px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
                    color:#111827;
                  ">
                    ${code}
                  </div>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:18px 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:22px;color:#4b5563;">
                    El código <strong>vence en 2 horas</strong>.<br/>
                    Si no solicitaste este código, puedes ignorar este correo con tranquilidad.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error("Error enviando email de restablecimiento:", error);
  }
};

async function getClassInfo(classId: string) {
  const session = await prisma.session.findUnique({
    where: { id: Number(classId) },
    include: { discipline: true },
  });

  if (!session) throw new Error("Clase no encontrada para email");

  const { discipline, dateStart, timeStart } = session;

  const dateStr = formatDateVisibleMx(dateStart.toISOString().slice(0, 10));
  const hour = timeStart.toISOString().slice(11, 16); // HH:mm from ISO string (assuming stored as UTC components)
  const disciplineName = discipline?.name || "Clase";

  return { discipline: disciplineName, dateStr, hour };
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

    await safeSendEmail({
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F2.png?alt=media&token=bdcb333d-1c2e-4a2a-916e-73b4d5c4c8ea"
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
  classId: string,
  seatNumber?: number | null,
  classType?: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);

    const safeName = escapeHtml(name);
    const safeDiscipline = escapeHtml(discipline);
    const safeDate = escapeHtml(dateStr);
    const safeHour = escapeHtml(hour);
    const formattedClassType = formatClassType(classType);

    // Determinar tipo de reserva
    const isGrupal =
      classType &&
      (classType.toLowerCase().includes("grup") ||
        classType.toLowerCase().includes("groups"));
    const reservationType = isGrupal ? "Reserva Grupal" : "Reserva Individual";

    // Generar información del asiento para clases grupales
    let seatInfo = "";
    if (seatNumber !== null && seatNumber !== undefined && isGrupal) {
      seatInfo = `<br/><br/><strong>🎫 Tu lugar:</strong> Asiento #${seatNumber}`;
    }

    await safeSendEmail({
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F3.png?alt=media&token=993e6152-fd0d-454c-95c3-2b759accda6a"
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
                    Hola ${safeName}, ¡buenas noticias! Se liberó un cupo para tu <strong>${reservationType}</strong> de
                    <strong>${safeDiscipline}</strong> el <strong>${safeDate}</strong> a las <strong>${safeHour}</strong>.${seatInfo}
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:0 24px 24px 24px;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#555555;">
                    Tu reserva fue creada automáticamente. Si no puedes asistir, recuerda cancelarla con 12 horas de anticipación.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error(
      "Error enviando email de aceptación de lista de espera:",
      error
    );
  }
};

/**
 * Cuando la ventana de espera finaliza sin cupo. envio con imagen
 */
// export const sendWaitlistRejectedEmail = async (
//   to: string,
//   name: string,
//   classId: string
// ) => {
//   try {
//     const { discipline, dateStr, hour } = await getClassInfo(classId);

//     await safeSendEmail({
//       from: FROM,
//       to,
//       subject: "Tu solicitud en lista de espera ha finalizado",
//       html: `
//       <!-- Wrapper a 100% -->
//       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
//         <tr>
//           <td align="center">
//             <!-- Contenedor centrado -->
//             <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
//               <tr>
//                 <td align="center" style="padding:24px 16px 8px 16px;">
//                   <img
//                     src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F13.png?alt=media&token=b337be33-e5e6-41e4-9b73-19f22630aa6e"
//                     alt="PB Studio - Lista de espera finalizada"
//                     width="600"
//                     style="display:block;width:100%;max-width:600px;height:auto;border:0;line-height:100%;outline:none;text-decoration:none;"
//                   />
//                 </td>
//               </tr>

//               <!-- Espaciador compatible -->
//               <tr>
//                 <td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td>
//               </tr>

//               <tr>
//                 <td align="center" style="padding:0 24px 24px 24px;">
//                   <p style="margin:0;font-size:16px;line-height:24px;color:#333333;">
//                     Hola ${name},
//                     <br/>lamentablemente <strong>no se liberó ningún cupo</strong> para la clase de <strong>${discipline}</strong> del <strong>${dateStr}</strong> a las <strong>${hour}</strong>.
//                   </p>
//                   <p style="margin:16px 0 0 0;font-size:16px;line-height:24px;color:#333333;">
//                     Tu solicitud en lista de espera ha finalizado.
//                     <br/>¡No te desanimes! Puedes volver a intentarlo en próximas clases desde la agenda.
//                   </p>
//                 </td>
//               </tr>
//             </table>
//           </td>
//         </tr>
//       </table>`,
//     });
//   } catch (error) {
//     console.error("Error enviando email de rechazo de lista de espera:", error);
//   }
// };

// Cancelacion de lista de espera envio con imagen

export const sendWaitlistCancelledByUserEmail = async (
  to: string,
  name: string,
  classId: string
) => {
  try {
    const { discipline, dateStr, hour } = await getClassInfo(classId);

    await safeSendEmail({
      from: FROM,
      to,
      subject: "Has salido de la lista de espera",
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
                    src="https://firebasestorage.googleapis.com/v0/b/pb-studio-ffb8f.firebasestorage.app/o/emailImages%2F3.png?alt=media&token=993e6152-fd0d-454c-95c3-2b759accda6a" 
                    alt="PB Studio - Lista de espera"
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
                    Hola ${name},
                    <br/>hemos procesado tu solicitud y <strong>saliste de la lista de espera</strong> para la clase de <strong>${discipline}</strong> del <strong>${dateStr}</strong> a las <strong>${hour}</strong>.
                  </p>
                  <p style="margin:16px 0 0 0;font-size:16px;line-height:24px;color:#333333;">
                    Si cambias de opinión, puedes volver a unirte desde la agenda. ¡Te esperamos pronto!
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`,
    });
  } catch (error) {
    console.error(
      "Error enviando email de cancelación de lista de espera por el usuario:",
      error
    );
  }
};
