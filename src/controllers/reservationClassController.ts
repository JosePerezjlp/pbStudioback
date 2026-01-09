/**
 * Controlador específico para la vista de reservación de clases
 */

import { Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma } from "../config/prisma";

/**
 * Obtiene clases para la vista de reservación
 * Recibe: branchId, startDate, endDate como query params
 * Devuelve: clases agrupadas por día con info completa
 */
export const getClassesForReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { branchId, startDate, endDate } = req.query;

    // Validaciones
    if (!branchId || !startDate || !endDate) {
      res.status(400).json({
        error: "Faltan parámetros requeridos: branchId, startDate, endDate",
      });
      return;
    }

    const branchIdNum = parseInt(branchId as string, 10);
    if (isNaN(branchIdNum)) {
      res.status(400).json({ error: "branchId inválido" });
      return;
    }

    // Parsear fechas
    const start = DateTime.fromISO(startDate as string, {
      zone: "America/Mexico_City",
    })
      .startOf("day")
      .toJSDate();

    const end = DateTime.fromISO(endDate as string, {
      zone: "America/Mexico_City",
    })
      .endOf("day")
      .toJSDate();

    // Obtener clases en el rango
    const classes = await prisma.session.findMany({
      where: {
        branchOfficeId: branchIdNum,
        dateStart: {
          gte: start,
          lte: end,
        },
        // Ocultar clases borradas lógicamente
        status: { not: 3 },
      },
      include: {
        discipline: {
          select: {
            id: true,
            name: true,
          },
        },
        instructor: {
          select: {
            id: true,
            username: true,
            email: true,
            profile: {
              select: {
                firstname: true,
                paternalSurname: true,
                maternalSurname: true,
                photo: true,
              },
            },
          },
        },
        exerciseRoom: {
          select: {
            id: true,
            name: true,
            type: true,
            capacity: true,
          },
        },
        branchOffice: {
          select: {
            id: true,
            name: true,
          },
        },
        reservations: {
          where: {
            cancellationAt: null, // Solo reservaciones activas
          },
          select: {
            id: true,
            placeNumber: true,
            userId: true,
          },
        },
      },
      orderBy: [{ dateStart: "asc" }, { timeStart: "asc" }],
    });

    // Formatear respuesta con información útil
    const formattedClasses = classes.map((session) => {
      const reservedSpots = session.reservations.length;
      const availableSpots = session.availableCapacity - reservedSpots;

      // Formatos "limpios" tal como están en la BD
      const date = DateTime.fromJSDate(session.dateStart)
        .setZone("utc")
        .toFormat("yyyy-LL-dd"); // 2026-01-12

      const time = DateTime.fromJSDate(session.timeStart)
        .setZone("utc")
        .toFormat("HH:mm:ss"); // 06:45:00

      return {
        id: session.id,
        date,
        time,
        type: session.type,
        status: session.status, // 0 = cerrada, 1 = abierta, 2 = cancelada, 3 = borrada
        isOpen: session.status === 1,
        isClosed: session.status === 0,
        isCanceled: session.status === 2,
        capacity: session.exerciseRoomCapacity,
        availableCapacity: session.availableCapacity,
        reservedSpots,
        availableSpots,
        isFull: availableSpots <= 0,
        information: session.information,

        // Relaciones
        discipline: session.discipline,
        instructor: session.instructor
          ? {
              id: session.instructor.id,
              username: session.instructor.username,
              email: session.instructor.email,
              name: session.instructor.profile
                ? `${session.instructor.profile.firstname || ""} ${session.instructor.profile.paternalSurname || ""} ${session.instructor.profile.maternalSurname || ""}`.trim()
                : session.instructor.username,
              firstName: session.instructor.profile?.firstname,
              lastName:
                `${session.instructor.profile?.paternalSurname || ""} ${session.instructor.profile?.maternalSurname || ""}`.trim(),
              photo: session.instructor.profile?.photo,
            }
          : null,
        room: session.exerciseRoom,
        branch: session.branchOffice,

        // Metadata
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });

    // Agrupar por fecha para facilitar la visualización
    const groupedByDate = formattedClasses.reduce(
      (acc, classItem) => {
        // Ahora "date" ya viene formateado como yyyy-MM-dd
        const dateKey = classItem.date as string;

        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }
        acc[dateKey].push(classItem);
        return acc;
      },
      {} as Record<string, typeof formattedClasses>
    );

    res.json({
      success: true,
      dateRange: {
        start: startDate,
        end: endDate,
      },
      branchId: branchIdNum,
      totalClasses: formattedClasses.length,
      classes: formattedClasses,
      classesByDate: groupedByDate,
    });
  } catch (error) {
    console.error("Error obteniendo clases para reservación:", error);
    res.status(500).json({
      error: "Error obteniendo clases",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
