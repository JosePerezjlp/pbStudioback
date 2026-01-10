/* ────────────────────────────────────────────────────────────────
   src/controllers/transactionController.ts
   ──────────────────────────────────────────────────────────────── */
import { Request, Response } from "express";
import { DateTime } from "luxon";
import prisma from "../config/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import { sendPackagePurchaseEmail } from "../utils/emailService";
// import { incrementMetrics } from "../utils/metrics"; // Deprecated/Moved to SQL aggregations

/* ---------- helpers ---------- */
/**
 * Formatea el tipo de paquete/clase para mostrar en español
 * Detecta: "group", "groups", "grupal", "grupales" → "Grupal"
 */
const formatPackageType = (type: string | undefined): string => {
  if (!type) return "Individual";
  const normalizedType = type.toLowerCase();
  if (normalizedType.includes("group") || normalizedType.includes("grupal")) {
    return "Grupal";
  }
  return "Individual";
};

/**
 * Normaliza una fecha al inicio del día (00:00:00) en horario mexicano
 */
const normalizeStartDate = (dateInput: string | Date): Date => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const mexicanDate = DateTime.fromJSDate(date).setZone("America/Mexico_City");
  return mexicanDate.startOf("day").toJSDate();
};

/**
 * Normaliza una fecha al final del día (23:59:59.999) en horario mexicano
 */
const normalizeEndDate = (dateInput: string | Date): Date => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const mexicanDate = DateTime.fromJSDate(date).setZone("America/Mexico_City");
  return mexicanDate.endOf("day").toJSDate();
};

/**
 * Normaliza la fecha actual al inicio del día (00:00:00) en horario mexicano para comparación
 */
const normalizeToday = (): Date => {
  const nowMexico = DateTime.now().setZone("America/Mexico_City");
  return nowMexico.startOf("day").toJSDate();
};

/* ---------- Tipos ---------- */
export type PaymentMethod = "paypal" | "cash" | "terminal";
export type TransactionStatus = "paid" | "pending" | "rejected" | "cancelled";

/* ---------- formateo de respuesta común ---------- */
const formatTransactionRecord = (t: any) => ({
  ...t,
  // Adaptar campos para compatibilidad con frontend
  user: t.user
    ? {
        firstName: t.user.name,
        lastName: t.user.lastname,
        email: t.user.email,
      }
    : null,
  packageDoc: t.package
    ? {
        id: String(t.package.id),
        type: formatPackageType(t.package.type),
        totalClasses: t.package.totalClasses,
      }
    : null,
  // Convertir Decimal a number para JSON
  amount: Number(t.total),
  total: Number(t.total),
  packageAmount: Number(t.packageAmount),
  packageSpecialPrice: t.packageSpecialPrice
    ? Number(t.packageSpecialPrice)
    : null,
  couponDiscount: t.couponDiscount ? Number(t.couponDiscount) : null,
});

/* Construye el objeto `where` para filtrar transacciones a partir de query params */
const buildTransactionWhere = (query: any) => {
  const {
    status,
    method,
    branch,
    packageId,
    startDate,
    endDate,
    userId,
    userEmail,
    userName,
  } = query;

  const where: any = {};

  // Status mapping (Frontend envía string "paid", etc.)
  if (status) {
    if (status === "paid") where.status = 1;
    else if (status === "pending") where.status = 0;
    else if (!isNaN(Number(status))) where.status = Number(status);
  }

  if (method) where.chargeMethod = method; // "cash", "terminal", "paypal"
  if (branch) where.branchOfficeId = Number(branch);
  if (packageId) where.packageId = Number(packageId);
  if (userId) where.userId = Number(userId);

  // Fechas
  if (startDate || endDate) {
    where.createdAt = {};

    if (startDate) {
      const start = new Date(String(startDate));
      if (!isNaN(start.getTime())) {
        where.createdAt.gte = normalizeStartDate(start);
      }
    }

    if (endDate) {
      const end = new Date(String(endDate));
      if (!isNaN(end.getTime())) {
        where.createdAt.lte = normalizeEndDate(end);
      }
    }
  }

  // Búsqueda por Email o Nombre (Join con User)
  if (userEmail || userName) {
    where.user = {};
    if (userEmail) where.user.email = { contains: userEmail };
    if (userName) {
      where.user.OR = [
        { name: { contains: userName } },
        { lastname: { contains: userName } },
      ];
    }
  }

  return where;
};

/* ===============================================================
  1)  CASH – Registro manual
  =============================================================== */
export const createCashTransactionController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      targetUserId,
      packageId,
      amount,
      couponCode,
      couponId,
      paymentMethod = "cash",
      branchId,
    } = req.body as {
      targetUserId?: string | number;
      packageId: string | number;
      amount: number;
      couponCode?: string;
      couponId?: string | number;
      paymentMethod?: PaymentMethod;
      branchId?: string | number;
    };

    // Métodos de pago válidos: cash (efectivo), terminal (tarjeta), free (gratis/cortesía)
    if (!["cash", "terminal", "free"].includes(paymentMethod)) {
      res.status(400).json({
        error: "Método de pago inválido. Métodos válidos: cash, terminal, free",
      });
      return;
    }

    const requesterUid = req.user?.id; // ID del admin/staff que hace la operación
    // Identificar usuario objetivo
    let targetUser: any = null;

    // Resolver usuario objetivo solo por ID SQL (aceptando "sql_123" o "123")
    if (targetUserId) {
      const match = /^sql_(\d+)$/.exec(String(targetUserId));
      const numericId = match ? Number(match[1]) : Number(targetUserId);

      if (!numericId || Number.isNaN(numericId)) {
        targetUser = null;
      } else {
        targetUser = await prisma.user.findUnique({
          where: { id: numericId },
        });
      }
    } else if (requesterUid) {
      targetUser = await prisma.user.findUnique({
        where: { id: requesterUid },
      });
    }

    if (!targetUser) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    if (!packageId || amount === undefined) {
      res
        .status(400)
        .json({ error: "Faltan datos requeridos (packageId, amount)" });
      return;
    }

    // Buscar paquete
    const pkg = await prisma.package.findUnique({
      where: { id: Number(packageId) },
    });

    if (!pkg) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    // Validar vigencia del paquete (si aplica)
    // Nota: El modelo Package actual en Prisma NO tiene campos startDate/endDate explícitos en el schema proporcionado.
    // Asumiremos que si existen en la lógica de negocio, deberían estar, pero basándome en el schema.prisma leído:
    // Package tiene: id, totalClasses, amount, type, daysExpiry, isActive (0/1/2), isUnlimited, etc.
    // NO tiene startDate/endDate. Omitiré esa validación específica de fechas de publicación del paquete
    // a menos que estén en campos no vistos o JSON. En Firestore sí existían.
    // Si 'isActive' es distinto de 1 (activo), no se debería vender.
    if (pkg.isActive !== 1) {
      res.status(400).json({ error: "Este paquete no está activo" });
      return;
    }

    // Buscar Sucursal (si aplica) - Parsear a número
    let branchOfficeId: number | null = null;
    if (branchId) {
      const parsedBranchId = parseInt(String(branchId));
      if (!isNaN(parsedBranchId)) {
        const branchOffice = await prisma.branchOffice.findUnique({
          where: { id: parsedBranchId },
        });
        if (branchOffice) branchOfficeId = branchOffice.id;
      }
    }

    // ---------------------------------------------------------
    // Lógica de Cupones
    // ---------------------------------------------------------
    let finalCoupon: any = null;
    let finalAmount = Number(amount);
    let couponDiscountAmount = 0;
    let isAutoCoupon = false;

    // 1. Buscar cupón explícito (enviado por el frontend)
    if (couponId || couponCode) {
      finalCoupon = await prisma.coupon.findFirst({
        where: {
          OR: [
            ...(couponId ? [{ id: Number(couponId) }] : []),
            ...(couponCode ? [{ code: couponCode }] : []),
          ],
        },
        include: {
          couponPackages: true,
        },
      });
    }

    // 2. Si no hay cupón explícito, intentar detectar un cupón automático
    //    vinculado al paquete (descuento ya reflejado en specialPrice).
    if (!finalCoupon && pkg.specialPrice && pkg.discountInfo) {
      const auto = await prisma.coupon.findFirst({
        where: {
          applySpecialPrice: true,
          name: String(pkg.discountInfo),
          couponPackages: {
            some: { packageId: pkg.id },
          },
        },
        include: {
          couponPackages: true,
        },
      });

      if (auto) {
        finalCoupon = auto;
        isAutoCoupon = true;
      }
    }

    if (finalCoupon) {
      const today = normalizeToday();
      const start = finalCoupon.dateStart
        ? normalizeStartDate(finalCoupon.dateStart)
        : null;
      const end = finalCoupon.dateEnd
        ? normalizeEndDate(finalCoupon.dateEnd)
        : null;

      // Validar fechas
      if (start && today < start) {
        res.status(400).json({ error: "El cupón aún no está vigente" });
        return;
      }
      if (end && today > end) {
        res.status(400).json({ error: "El cupón ha expirado" });
        return;
      }

      // Validar límites de uso
      // usesTotal es el límite global.
      if (
        finalCoupon.usesTotal > 0 &&
        finalCoupon.used >= finalCoupon.usesTotal
      ) {
        res
          .status(400)
          .json({ error: "El cupón ha alcanzado su límite de usos" });
        return;
      }

      // Validar si el usuario ya usó este cupón (si no es de usos múltiples por usuario)
      // La lógica original permitía "automáticos" múltiples veces.
      // Aquí verificaremos CouponHistory.
      // Asumimos que si tiene límite global, verificamos eso.
      // Si quisiéramos límite por usuario, necesitaríamos lógica adicional.
      // Por ahora, solo validamos si aplica al paquete.

      const appliesToPackage = finalCoupon.couponPackages.some(
        (cp: any) => cp.packageId === pkg.id
      );
      // O si es universal? Schema no tiene flag 'isUniversal'. Asumimos que si no tiene couponPackages, es universal?
      // O checamos si couponPackages está vacío.
      // Mejor ser estrictos: debe estar en la lista si la lista no es vacía.
      const hasRestrictions = finalCoupon.couponPackages.length > 0;

      if (hasRestrictions && !appliesToPackage) {
        res
          .status(400)
          .json({ error: "Este cupón no aplica para el paquete seleccionado" });
        return;
      }

      // Calcular descuento
      // Schema: discount Decimal (4,2). Es porcentaje.
      const discountVal = Number(finalCoupon.discount);

      if (isAutoCoupon) {
        // Cupón automático: el precio rebajado ya viene calculado en el frontend
        // (y usualmente coincide con specialPrice). Solo registramos el monto final
        // y la diferencia respecto al precio base, pero no aplicamos el porcentaje
        // otra vez para evitar un doble descuento.
        const basePrice = Number(pkg.amount);
        finalAmount = Number(amount);
        couponDiscountAmount = Math.max(0, basePrice - finalAmount);
      } else {
        // Cupón ingresado explícitamente: aplicamos el porcentaje sobre el monto base
        let basePrice = Number(pkg.amount);
        if (
          pkg.specialPrice &&
          Number(pkg.specialPrice) > 0 &&
          finalCoupon.applySpecialPrice
        ) {
          basePrice = Number(pkg.specialPrice);
        }

        couponDiscountAmount = (basePrice * discountVal) / 100;
        finalAmount = Math.max(0, basePrice - couponDiscountAmount);
      }
    } else {
      // Sin cupón, usar precio base o especial si existe?
      // Firestore logic usaba 'amount' recibido del body, pero validaba contra specialPrice si aplicaba.
      // Aquí respetamos el 'amount' enviado (que viene del frontend calculado),
      // pero idealmente deberíamos recalcularlo para seguridad.
      // Por compatibilidad con "CASH" (donde el admin puede ajustar?), usaremos el amount enviado
      // pero sanity check: no debería ser menor que el precio real salvo autorización.
      // Aceptamos el amount del body.
      finalAmount = Number(amount);
    }

    // ---------------------------------------------------------
    // Crear Transacción en DB
    // ---------------------------------------------------------

    // Calcular expiración
    let expirationAt: Date | null = null;
    if (pkg.daysExpiry) {
      expirationAt = DateTime.now().plus({ days: pkg.daysExpiry }).toJSDate();
    }

    const transaction = await prisma.$transaction(async (tx) => {
      // 1. Crear Transaction
      const newTx = await tx.transaction.create({
        data: {
          userId: targetUser.id,
          packageId: pkg.id,
          branchOfficeId: branchOfficeId,

          // Snapshot del paquete
          packageTotalClasses: pkg.totalClasses,
          packageAmount: pkg.amount,
          packageType: pkg.type,
          packageDaysExpiry: pkg.daysExpiry,
          packageIsUnlimited: pkg.isUnlimited,
          packageSpecialPrice: pkg.specialPrice,

          // Datos de pago
          // amount: finalAmount, // Deprecated/Mapped field? Schema has 'total' too.
          total: finalAmount,
          chargeMethod: paymentMethod,
          status: 1, // 1 = Paid/Active
          isCompleted: true,
          isExpired: false,
          haveSessionsAvailable: pkg.totalClasses > 0 || pkg.isUnlimited, // True si tiene clases

          createdAt: new Date(),
          updatedAt: new Date(),
          expirationAt: expirationAt,

          // Cupón
          couponId: finalCoupon?.id || null,
          couponDiscount: finalCoupon ? finalCoupon.discount : 0,

          // Otros
          cardType: "cash", // Placeholder
        },
      });

      // 2. Actualizar Cupón (uso)
      if (finalCoupon) {
        await tx.coupon.update({
          where: { id: finalCoupon.id },
          data: { used: { increment: 1 } },
        });

        await tx.couponHistory.create({
          data: {
            couponId: finalCoupon.id,
            transactionId: newTx.id,
            userId: targetUser.id,
            discount: finalCoupon.discount, // Porcentaje guardado
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      // 3. Lógica Free Session (si el usuario tenía freeSession y compra un paquete público)
      // newUser field in Package is TinyInt (0 or 1)
      if (targetUser.freeSession && pkg.public && pkg.newUser === 1) {
        await tx.user.update({
          where: { id: targetUser.id },
          data: { freeSession: false },
        });
      }

      return newTx;
    });

    // ---------------------------------------------------------
    // Post-Procesamiento
    // ---------------------------------------------------------

    // Email
    try {
      await sendPackagePurchaseEmail(
        targetUser.email,
        targetUser.name,
        `Paquete ${formatPackageType(pkg.type)}`,
        pkg.totalClasses,
        expirationAt ? expirationAt.toISOString() : null
        // pkg.modality // No existe en schema SQL Package, omitir o buscar alternativa
      );
    } catch (e) {
      console.error("Error enviando email de compra:", e);
    }

    // Metrics (SQL aggregated on the fly usually, or we can insert into a metrics table if needed)
    // await incrementMetrics(finalAmount, transaction.createdAt.toISOString());

    res.status(201).json({
      message: "Transacción registrada correctamente",
      tx: transaction,
    });
  } catch (err) {
    console.error("❌ Error creando transacción CASH:", err);
    res.status(500).json({ error: "No se pudo registrar la transacción" });
  }
};

/* ===============================================================
   2)  LISTADOS
   =============================================================== */
export const getAllTransactionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      limit: limitStr,
      page: pageStr,
      status,
      method,
      branch,
      packageId,
      startDate,
      endDate,
      userId,
      userEmail,
      userName,
    } = req.query as any;

    const limit = Number(limitStr) > 0 ? Number(limitStr) : 50;
    const page = Number(pageStr) > 0 ? Number(pageStr) : 1;
    const skip = (page - 1) * limit;
    const where = buildTransactionWhere({
      status,
      method,
      branch,
      packageId,
      startDate,
      endDate,
      userId,
      userEmail,
      userName,
    });

    // Query
    const [transactions, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, lastname: true, email: true },
          },
          package: {
            select: { id: true, type: true, totalClasses: true }, // Basic info
          },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    // Formatear respuesta compatible
    const formatted = transactions.map((t) => formatTransactionRecord(t));

    res.status(200).json({
      transactions: formatted,
      total,
      pages: Math.ceil(total / limit),
      page,
      limit,
      hasMore: skip + transactions.length < total,
    });
  } catch (err) {
    console.error("❌ Error listando transacciones:", err);
    res.status(500).json({
      error: "Error al obtener transacciones",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Devuelve el detalle de una transacción específica por ID
 */
export const getTransactionByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const transactionId = Number(id);

    if (!transactionId || Number.isNaN(transactionId)) {
      res.status(400).json({ error: "ID de transacción inválido" });
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        user: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        package: {
          select: { id: true, type: true, totalClasses: true },
        },
      },
    });

    if (!transaction) {
      res.status(404).json({ error: "Transacción no encontrada" });
      return;
    }

    const formatted = formatTransactionRecord(transaction);

    res.status(200).json({ transaction: formatted });
  } catch (err) {
    console.error("❌ Error obteniendo transacción por ID:", err);
    res.status(500).json({ error: "Error al obtener la transacción" });
  }
};

export const exportTransactionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Para exportación, no usar paginación. Si se proporciona 'max', usarlo como límite.
  // Si no, traer todas las transacciones sin límite.
  const maxParam = req.query.max as string | undefined;

  if (maxParam) {
    req.query.limit = maxParam;
  } else {
    // Sin límite, traer todas
    req.query.limit = "999999";
  }

  req.query.page = "1";
  await getAllTransactionsController(req, res);
};

export const getUserTransactionsController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    // Determinar el usuario objetivo
    let effectiveUserId: number | null = null;

    if (req.path === "/my" && req.user) {
      effectiveUserId = req.user.id;
    } else if (req.params.userId) {
      const parsed = Number(req.params.userId);
      if (!Number.isNaN(parsed)) effectiveUserId = parsed;
    }

    if (!effectiveUserId) {
      res.status(400).json({ error: "Usuario no válido para transacciones" });
      return;
    }

    const {
      limit: limitStr,
      page: pageStr,
      status,
      method,
      branch,
      packageId,
      startDate,
      endDate,
      userEmail,
      userName,
    } = req.query as any;

    const limit = Number(limitStr) > 0 ? Number(limitStr) : 50;
    const page = Number(pageStr) > 0 ? Number(pageStr) : 1;
    const skip = (page - 1) * limit;

    const where = buildTransactionWhere({
      status,
      method,
      branch,
      packageId,
      startDate,
      endDate,
      userId: effectiveUserId,
      userEmail,
      userName,
    });

    const [transactions, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, lastname: true, email: true },
          },
          package: {
            select: { id: true, type: true, totalClasses: true },
          },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    const formatted = transactions.map((t) => formatTransactionRecord(t));

    res.status(200).json({
      transactions: formatted,
      total,
      pages: Math.ceil(total / limit),
      page,
      limit,
      hasMore: skip + transactions.length < total,
    });
  } catch (err) {
    console.error("❌ Error listando transacciones de usuario:", err);
    res
      .status(500)
      .json({ error: "Error al obtener transacciones del usuario" });
  }
};

export const cancelTransactionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  try {
    await prisma.transaction.update({
      where: { id: Number(id) },
      data: { status: 3 }, // 3 = Cancelled
    });
    res.json({ message: "Transacción cancelada" });
  } catch (e) {
    res.status(500).json({ error: "Error cancelando transacción" });
  }
};

export const updateTransactionExpirationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { expirationDate } = req.body;
  try {
    await prisma.transaction.update({
      where: { id: Number(id) },
      data: { expirationAt: new Date(expirationDate) },
    });
    res.json({ message: "Fecha de expiración actualizada" });
  } catch (e) {
    res.status(500).json({ error: "Error actualizando fecha" });
  }
};

export const getCajaTransactionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  req.query.method = "cash";
  await getAllTransactionsController(req, res);
};

export const getTransactionTotalController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate y endDate son requeridos" });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Fechas inválidas" });
      return;
    }

    const result = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: {
        status: 1, // Pagadas
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });

    res.status(200).json({ total: result._sum.total || 0 });
  } catch (error) {
    console.error("Error al obtener total de transacciones:", error);
    res.status(500).json({ error: "Error al obtener total de transacciones" });
  }
};

export const getTransactionSummaryController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    // 1. Totales Generales (Histórico)
    const totalAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: { status: 1 }, // Paid
    });

    // 2. Totales por Periodo
    // Anual (Año actual)
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const anualAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: { status: 1, createdAt: { gte: startOfYear } },
    });

    // Mensual
    const mensualAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: { status: 1, createdAt: { gte: startOfMonth } },
    });

    // Semanal
    const semanalAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: { status: 1, createdAt: { gte: startOfWeek } },
    });

    // Diario
    const diariaAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: { status: 1, createdAt: { gte: startOfDay } },
    });

    // 3. Desgloses con/sin descuento (Anual y Mensual)
    // Anual con descuento
    const anualConDescAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: {
        status: 1,
        createdAt: { gte: startOfYear },
        discount: { gt: 0 }, // Asumiendo que 'discount' > 0 significa con descuento
      },
    });
    // Anual sin descuento
    const anualSinDescAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: {
        status: 1,
        createdAt: { gte: startOfYear },
        discount: 0, // O null si discount es nullable y default null, pero schema dice Int @default(0)
      },
    });

    // Mensual con descuento
    const mensualConDescAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: {
        status: 1,
        createdAt: { gte: startOfMonth },
        discount: { gt: 0 },
      },
    });
    // Mensual sin descuento
    const mensualSinDescAgg = await prisma.transaction.aggregate({
      _sum: { total: true },
      where: {
        status: 1,
        createdAt: { gte: startOfMonth },
        discount: 0,
      },
    });

    // 4. Desgloses por Método de Pago (Anual y Mensual)
    const methods = ["cash", "terminal", "paypal"];

    // Función helper para obtener totales por método
    const getTotalsByMethod = async (fromDate: Date) => {
      const result: Record<string, number> = {
        cash: 0,
        terminal: 0,
        paypal: 0,
      };

      const groups = await prisma.transaction.groupBy({
        by: ["chargeMethod"],
        _sum: { total: true },
        where: {
          status: 1,
          createdAt: { gte: fromDate },
        },
      });

      groups.forEach((g) => {
        if (g.chargeMethod && result.hasOwnProperty(g.chargeMethod)) {
          result[g.chargeMethod] = Number(g._sum.total || 0);
        }
      });
      return result;
    };

    const anualPorMetodo = await getTotalsByMethod(startOfYear);
    const mensualPorMetodo = await getTotalsByMethod(startOfMonth);

    // Construir respuesta final
    const response = {
      total: Number(totalAgg._sum.total || 0),
      anual: Number(anualAgg._sum.total || 0),
      mensual: Number(mensualAgg._sum.total || 0),
      semanal: Number(semanalAgg._sum.total || 0),
      diaria: Number(diariaAgg._sum.total || 0),

      anualConDescuento: Number(anualConDescAgg._sum.total || 0),
      anualSinDescuento: Number(anualSinDescAgg._sum.total || 0),

      mensualConDescuento: Number(mensualConDescAgg._sum.total || 0),
      mensualSinDescuento: Number(mensualSinDescAgg._sum.total || 0),

      anualPorMetodo,
      mensualPorMetodo,
    };

    res.json(response);
  } catch (e) {
    console.error("Error calculating summary:", e);
    res.status(500).json({ error: "Error obteniendo resumen detallado" });
  }
};

export const getRankingsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    // 1. Obtener todas las sucursales activas
    const branches = await prisma.branchOffice.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    // 2. Para cada sucursal, obtener el "ranking" de transacciones (Top ventas)
    // Asumimos que "ranking" se refiere a las transacciones con mayor monto (o recientes).
    // Basado en el ejemplo JSON, parece ser un listado detallado.
    // Usaremos Top 10 por monto por ahora.

    const result = await Promise.all(
      branches.map(async (branch) => {
        const transactions = await prisma.transaction.findMany({
          where: {
            branchOfficeId: branch.id,
            status: 1, // Pagado
          },
          orderBy: {
            total: "desc", // Ranking por monto
          },
          take: 10, // Top 10
          include: {
            user: {
              select: { id: true, name: true, lastname: true, email: true },
            },
            package: {
              select: {
                id: true,
                type: true,
                totalClasses: true,
                altText: true,
              },
            },
          },
        });

        // Formatear transacciones
        const formattedRankings = transactions.map((t) => {
          const dt = t.createdAt
            ? DateTime.fromJSDate(t.createdAt).setLocale("es")
            : DateTime.now().setLocale("es");

          // Capitalizar primera letra del día
          const dayName = dt.toFormat("cccc");
          const dayOfWeek = dayName.charAt(0).toUpperCase() + dayName.slice(1);

          const hour = dt.toFormat("hh:mm a"); // 09:00 AM

          // Etiqueta del paquete
          let pkgLabel = "—";
          if (t.package) {
            pkgLabel = t.package.altText || `${t.package.totalClasses} Clases`;
          } else if (t.packageTotalClasses) {
            pkgLabel = `${t.packageTotalClasses} Clases`;
          }

          const fullName = t.user
            ? `${t.user.name} ${t.user.lastname || ""}`.trim()
            : "Usuario Eliminado";

          return {
            userId: t.userId ? String(t.userId) : "",
            fullName,
            dayOfWeek,
            hour,
            pkgLabel,
            sum: Number(t.total),
          };
        });

        return {
          branchId: String(branch.id),
          branchName: branch.name,
          rankings: formattedRankings,
        };
      })
    );

    res.json({ branches: result });
  } catch (e) {
    console.error("Error obteniendo rankings:", e);
    res.status(500).json({ error: "Error obteniendo rankings" });
  }
};

export const getRecentTransactionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  req.query.limit = "10";
  await getAllTransactionsController(req, res);
};

export const deleteOldTransactionsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    res.json({ message: "Limpieza no implementada por seguridad" });
  } catch (e) {
    res.status(500).json({ error: "Error" });
  }
};
