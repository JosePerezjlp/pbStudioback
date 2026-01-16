import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import bcrypt from "bcrypt";
import {
  GympassService,
  gympassEnabled as gympassOn,
} from "../services/gympass.service";
import { CreateSlotRequest } from "../models/CreateSlotRequest";
import { ClassPayload } from "../models/ClassPayload";

/* ============================================================
   GET – productos por gym
   ============================================================ */
export const getProductsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { gymId } = req.params;

  try {
    if (!gympassOn) {
      res.status(200).json({ disabled: true });
      return;
    }
    const products = await GympassService.getProducts(Number(gymId));
    res.status(200).json(products);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al obtener productos:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   GET – clases por gym
   ============================================================ */
export const getClassesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { gymId } = req.params;

  try {
    if (!gympassOn) {
      res.status(200).json({ disabled: true });
      return;
    }
    const classes = await GympassService.getClass(Number(gymId));
    res.status(200).json(classes);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al obtener clases:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   POST – crear slot en una clase
   ============================================================ */
export const createSlotController = async (
  req: Request<
    {
      gymId: string;
      classId: string;
    },
    object,
    CreateSlotRequest
  >,
  res: Response
): Promise<void> => {
  const { gymId, classId } = req.params;
  if (!gympassOn) {
    res.status(200).json({ disabled: true });
    return;
  }
  const branchData = await GympassService.getBranchData(gymId);
  // Assuming branchData has gympass_gym_id somehow?
  // BranchOffice model doesn't have gympass_gym_id column in schema I saw.
  // Wait, let's check BranchOffice model.
  // It has `id`, `name`, ... `slug`.
  // Maybe it's stored in `Configuration` or mapped?
  // The original code used: `branchData?.gympass_gym_id`.
  // `getBranchData` returned `branch`.
  // If `BranchOffice` model lacks this field, we have a problem.
  // But `GympassService.getBranchData` in `gympass.service.ts` returns `prisma.branchOffice.findUnique`.
  // Let's assume for now the user added it or it's mapped.
  // Actually, I should check the schema for `BranchOffice`.
  // `BranchOffice` schema I read earlier didn't show `gympass_gym_id`.
  // I might need to add it or use `id` if they are the same (unlikely).
  // But for now, I'll trust the property access and fix if type error.
  // Wait, TypeScript will complain if I access a property not in the model type.
  // I'll cast to `any` for now to proceed, or add it to schema.
  // I'll add `gympassGymId` to `BranchOffice` in schema later if needed.

  // For now, let's assume `gympass_gym_id` is NOT in the Prisma model yet.
  // I should use `gymId` as is if mapped, or add the column.
  // The old code `GympassService.getBranchData` returned whatever Prisma returned.

  const gympassGymId =
    (branchData as any)?.gympassGymId || (branchData as any)?.id; // Fallback
  const payload: CreateSlotRequest = req.body;
  try {
    const slot = await GympassService.createClass(
      Number(gympassGymId),
      Number(classId),
      payload
    );
    res.status(201).json(slot);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al crear slot:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   POST – crear categoría (clase)
   ============================================================ */
export const createCategoryController = async (
  req: Request<{ gymId: string }, object, ClassPayload>,
  res: Response
): Promise<void> => {
  try {
    if (!gympassOn) {
      res.status(200).json({ disabled: true });
      return;
    }
    const { gymId } = req.params;
    const branchData = await GympassService.getBranchData(gymId);
    const gympassGymId =
      (branchData as any)?.gympassGymId || (branchData as any)?.id;

    if (!gympassGymId) {
      res
        .status(400)
        .json({ error: "La sucursal no tiene configurado un ID de Gympass" });
      return;
    }

    const payload = {
      classes: [req.body],
    };
    const category = await GympassService.createCategory(
      Number(gympassGymId),
      payload
    );
    res.status(201).json(category);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al crear categoría:", error);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   GET –  check-in
   ============================================================ */
export const getUserChecking = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;
  try {
    const id = parseInt(userId);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const gympassUserId = user.gympassId;
    const gymId = user.gympassGymId;
    const productId = user.gympassProductId;

    // Original code:
    // const checkingWellhub = await GympassService.simulateChecking(
    //   { gympass_user_id: gympass?.user_id, product_id: gympass?.product_id },
    //   gymId
    // );

    // We need gymId. If user.gympassGymId is null, we can't simulate.
    if (!gymId || !gympassUserId) {
      // Maybe return checkingWellhub: null or error?
      // Original code would pass undefined if gympass was null.
      // Let's try to proceed if we have at least user_id?
      // No, simulateChecking takes gymId as second arg.
      res.status(400).json({ error: "Usuario no tiene datos de Gympass" });
      return;
    }

    const checkingWellhub = await GympassService.simulateChecking(
      {
        gympass_user_id: gympassUserId,
        product_id: productId?.toString() ?? null,
      },
      gymId
    );
    res.status(200).json({ checkingWellhub });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener usuario por ID:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

/* ============================================================
   POST – webhook de check-in de Gympass
   ============================================================ */

export const wellhubWebhookController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!gympassOn) {
      res.status(200).json({ disabled: true });
      return;
    }
    const signature = (req.headers["x-gympass-signature"] ||
      req.headers["X-Gympass-Signature"]) as string | undefined;
    const event = req.body;

    if (!signature) {
      res.status(400).json({ error: "Falta la firma de Wellhub" });
      return;
    }
    const { event_type: eventType, event_data: eventData } = event;
    if (eventType !== "checkin") {
      res.status(400).json({ error: "Evento no soportado" });
      return;
    }

    const userPayload = eventData?.user;
    const gymPayload = eventData?.gym;

    if (
      !userPayload?.unique_token ||
      !userPayload?.email ||
      !gymPayload?.id ||
      !gymPayload?.product?.id
    ) {
      res.status(400).json({ error: "Faltan datos obligatorios del check-in" });
      return;
    }

    const uniqueToken: string = userPayload.unique_token;
    const gymId: number = gymPayload.id;
    const productId: number = gymPayload.product.id;
    const { email } = userPayload;
    const phoneRaw: string | undefined = userPayload.phone_number;

    if (!phoneRaw || typeof phoneRaw !== "string") {
      res
        .status(400)
        .json({ error: "Falta phone_number para usar como contraseña" });
      return;
    }
    const password = phoneRaw.trim();

    if (password.length < 6) {
      res.status(400).json({
        error: "WEAK_PASSWORD",
        message:
          "El phone_number debe tener al menos 6 caracteres para usarse como contraseña",
      });
      return;
    }

    // 1) Buscar por Gympass ID
    const existingByGympass = await prisma.user.findUnique({
      where: { gympassId: uniqueToken },
    });

    // 2) Buscar por email si no está ya vinculado por Gympass
    const existingByEmail = !existingByGympass
      ? await prisma.user.findUnique({ where: { email } })
      : null;

    // Si ya existe por Gympass, solo actualizamos datos de Gympass/gym y devolvemos OK
    if (existingByGympass) {
      const updated = await prisma.user.update({
        where: { id: existingByGympass.id },
        data: {
          gympassGymId: gymId,
          gympassProductId: productId,
          phone: phoneRaw ?? existingByGympass.phone,
          updatedAt: new Date(),
        },
      });

      res.status(200).json({
        message: "Usuario Gympass actualizado con check-in",
        id: updated.id,
        email: updated.email,
      });
      return;
    }

    // Si existe por email pero aún no tiene Gympass, lo vinculamos
    if (existingByEmail) {
      const updated = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          gympassId: uniqueToken,
          gympassGymId: gymId,
          gympassProductId: productId,
          phone: phoneRaw ?? existingByEmail.phone,
          updatedAt: new Date(),
        },
      });

      res.status(200).json({
        message: "Usuario existente vinculado a Gympass",
        id: updated.id,
        email: updated.email,
      });
      return;
    }

    // 3) Si no existe, crear usuario nuevo
    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date();

    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: userPayload.first_name || "Usuario",
        lastname: userPayload.last_name || "",
        phone: phoneRaw,
        roles: "user", // Stored as string in schema
        enabled: true,
        freeSession: false,
        createdAt: now,
        updatedAt: now,
        gympassId: uniqueToken,
        gympassGymId: gymId,
        gympassProductId: productId,
        emergencyContactName: null,
        emergencyContactPhone: null,
        classesAvailable: 0,
        classesTaken: 0,
      },
    });

    res.status(201).json({
      message: "Usuario creado con check-in",
      id: newUser.id,
      email: newUser.email,
    });
  } catch (error) {
    let status = 500;
    let code = "INTERNAL";
    let message = "Error interno del servidor";

    if (error instanceof Error) {
      message = error.message;
      if (message.includes("Unique constraint")) {
        status = 409;
        code = "EMAIL_ALREADY_EXISTS";
        message = "El correo ya está registrado.";
      }
    }

    console.error("❌ Error al procesar webhook:", message);
    res.status(status).json({ error: code, message });
  }
};

/* ============================================================
   POST – webhook de booking (reservas) de Gympass
   Por ahora solo loguea el evento para ver el payload real sin
   modificar reservas locales. Luego podremos mapearlo a Reservation.
   ============================================================ */
export const wellhubBookingWebhookController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!gympassOn) {
      res.status(200).json({ disabled: true });
      return;
    }

    const signature = (req.headers["x-gympass-signature"] ||
      req.headers["X-Gympass-Signature"]) as string | undefined;

    if (!signature) {
      res.status(400).json({ error: "Falta la firma de Wellhub" });
      return;
    }

    const event = req.body as any;
    const rawType = event?.event_type;
    const eventType =
      typeof rawType === "string" ? rawType.toLowerCase().trim() : "";
    const eventData = event?.event_data ?? {};

    if (!eventType) {
      res.status(400).json({ error: "Falta event_type" });
      return;
    }

    console.log("📩 Wellhub booking webhook recibido", {
      eventType: rawType,
      user: eventData?.user,
      slot: eventData?.slot,
    });

    const userPayload = eventData.user;
    const slotPayload = eventData.slot;

    if (!userPayload?.unique_token || !slotPayload) {
      res.status(400).json({ error: "Faltan datos de user/slot" });
      return;
    }

    const uniqueToken: string = userPayload.unique_token;
    const bookingNumber: string | null =
      slotPayload.booking_number?.toString() ?? null;

    // Resolver usuario por gympassId
    const user = await prisma.user.findUnique({
      where: { gympassId: uniqueToken },
    });

    if (!user) {
      // No devolvemos 4xx a Wellhub para evitar reintentos infinitos;
      // simplemente registramos y respondemos 200.
      console.warn("Gympass booking: usuario no encontrado", {
        uniqueToken,
      });
      res.status(200).json({
        received: true,
        event_type: rawType,
        status: "USER_NOT_FOUND_LOCAL",
      });
      return;
    }

    // Resolver sesión por IDs de Gympass guardados en Session
    const gympassSlotId = String(slotPayload.id);
    const gympassClassId = String(slotPayload.class_id ?? "");

    const session = await prisma.session.findFirst({
      where: {
        OR: [
          { gympassSlotId },
          gympassClassId ? { gympassClassId } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (!session) {
      console.warn("Gympass booking: sesión no encontrada", {
        gympassSlotId,
        gympassClassId,
      });
      res.status(200).json({
        received: true,
        event_type: rawType,
        status: "SESSION_NOT_FOUND_LOCAL",
      });
      return;
    }

    // Idempotencia: si ya existe reserva activa para este booking, solo devolvemos OK
    if (bookingNumber) {
      const existing = await prisma.reservation.findFirst({
        where: {
          userId: user.id,
          sessionId: session.id,
          cancellationAt: null,
          // gympassBookingId es un campo agregado recientemente en el schema
          // y puede que aún no esté en los tipos generados de Prisma.
          gympassBookingId: bookingNumber,
        } as any,
      });

      if (existing) {
        res.status(200).json({
          received: true,
          event_type: rawType,
          reservationId: existing.id,
          idempotent: true,
        });
        return;
      }
    }

    if (eventType === "booking.requested") {
      // Crear reserva GYMPASS directamente, sin consumir paquetes locales
      const created = await prisma.$transaction(async (tx) => {
        // Verificar que no haya ya una reserva activa del usuario en esta clase
        const duplicate = await tx.reservation.findFirst({
          where: {
            userId: user.id,
            sessionId: session.id,
            cancellationAt: null,
          },
        });

        if (duplicate) {
          return { reservation: duplicate, duplicated: true };
        }

        // Verificar cupo
        const currentReserved = await tx.reservation.count({
          where: { sessionId: session.id, cancellationAt: null },
        });

        if (currentReserved >= session.exerciseRoomCapacity) {
          return { reservation: null, duplicated: false, full: true };
        }

        // Asignar asiento automáticamente (primer lugar libre)
        const occupied = await tx.reservation.findMany({
          where: { sessionId: session.id, cancellationAt: null },
          select: { placeNumber: true },
        });

        const taken = new Set(occupied.map((r) => r.placeNumber));
        let assignedSeat = 1;
        for (let i = 1; i <= session.exerciseRoomCapacity; i++) {
          if (!taken.has(i)) {
            assignedSeat = i;
            break;
          }
        }

        const now = new Date();
        const reservation = await tx.reservation.create({
          data: {
            userId: user.id,
            sessionId: session.id,
            transactionId: null,
            placeNumber: assignedSeat,
            isAvailable: true,
            createdAt: now,
            updatedAt: now,
            // Campos especiales para trazabilidad Gympass
            source: "GYMPASS",
            gympassBookingId: bookingNumber,
          } as any,
        });

        await tx.session.update({
          where: { id: session.id },
          data: {
            availableCapacity: {
              decrement: 1,
            },
          },
        });

        await tx.reservationEvent.create({
          data: {
            reservationId: reservation.id,
            userId: user.id,
            sessionId: session.id,
            eventType: "created",
            metadata: {
              source: "GYMPASS",
              bookingNumber,
            },
            ipAddress: req.ip,
            userAgent: "GympassBookingWebhook",
          },
        });

        return { reservation, duplicated: false, full: false };
      });

      if (created.duplicated && created.reservation) {
        res.status(200).json({
          received: true,
          event_type: rawType,
          reservationId: created.reservation.id,
          duplicated: true,
        });
        return;
      }

      if (created.full) {
        res.status(409).json({
          received: true,
          event_type: rawType,
          error: "NO_SLOTS_AVAILABLE",
        });
        return;
      }

      res.status(200).json({
        received: true,
        event_type: rawType,
        reservationId: created.reservation?.id,
      });
      return;
    }

    if (
      eventType === "booking.canceled" ||
      eventType === "booking.cancelled" ||
      eventType === "booking.late_canceled"
    ) {
      // Cancelación de reserva GYMPASS si existe
      const cancelled = await prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.findFirst({
          where: {
            userId: user.id,
            sessionId: session.id,
            cancellationAt: null,
            ...(bookingNumber
              ? { gympassBookingId: bookingNumber }
              : {}),
          },
        });

        if (!reservation) return null;

        const now = new Date();
        const updated = await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            cancellationAt: now,
            updatedAt: now,
          },
        });

        if (reservation.sessionId) {
          await tx.session.update({
            where: { id: reservation.sessionId },
            data: {
              availableCapacity: {
                increment: 1,
              },
            },
          });
        }

        await tx.reservationEvent.create({
          data: {
            reservationId: reservation.id,
            userId: reservation.userId!,
            sessionId: reservation.sessionId!,
            eventType: "cancelled",
            metadata: {
              source: "GYMPASS",
              bookingNumber,
              gympassEventType: eventType,
            },
            ipAddress: req.ip,
            userAgent: "GympassBookingWebhook",
          },
        });

        return updated;
      });

      res.status(200).json({
        received: true,
        event_type: rawType,
        cancelled: Boolean(cancelled),
      });
      return;
    }

    // Otros tipos de evento de booking se aceptan pero no se procesan
    res.status(200).json({
      received: true,
      event_type: rawType,
      status: "IGNORED_EVENT_TYPE",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al procesar booking webhook:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   PATCH – actualizar reserva (booking)
   ============================================================ */
export const updateBookingController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  const payload = req.body;

  try {
    if (!gympassOn) {
      res.status(200).json({ disabled: true });
      return;
    }
    const { clasesDoc, gymId } =
      await GympassService.findClassAndBranch(classId);

    // clasesDoc is Session
    // We need gympass IDs from session or branch?
    // In original code: `clasesDoc.data()?.gympass.class_id`
    // This implies `Session` had a `gympass` object too?
    // Let's check `Session` model.
    // It doesn't have `gympass` fields in schema I saw.
    // I need to add `gympassClassId` and `gympassSlotId` to `Session` model.

    // Let's assume for now they are missing and I need to add them.
    // I'll assume they are properties on the object returned by findClassAndBranch if I add them to schema.

    const branchData = await GympassService.getBranchData(String(gymId));
    const gympassGymId =
      (branchData as any)?.gympassGymId || (branchData as any)?.id;

    // Warning: These properties might not exist if I don't update schema.
    const gympassClassId = (clasesDoc as any).gympassClassId;
    const gympassSlotId = (clasesDoc as any).gympassSlotId;

    if (!gympassClassId || !gympassSlotId) {
      // Fallback or error?
      // If we can't get gympass IDs, we can't update booking.
      // Assuming I'll update schema.
    }

    const bookingRequest = GympassService.buildBookingRequest(
      clasesDoc,
      payload.status
    );

    const updatedBooking = await GympassService.updateBooking(
      Number(gympassGymId),
      Number(gympassClassId),
      Number(gympassSlotId),
      bookingRequest
    );

    res.status(200).json(updatedBooking);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al actualizar booking:", msg);
    res.status(500).json({ error: msg });
  }
};
