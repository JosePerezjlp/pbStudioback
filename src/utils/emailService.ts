import { Resend } from "resend";

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

  const formattedModality = modality ? modality.charAt(0).toUpperCase() + modality.slice(1) : packageName;

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
