import { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../config/prisma";
import { uploadLocal, deleteLocalFile } from "../utils/uploadLocal";

/* ─────────────────────────────
   Helpers
────────────────────────────── */
const parseDisciplines = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map(String).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      /* noop */
    }
  }
  return [];
};

/* ─────────────────────────────
   CREATE
────────────────────────────── */
export const createInstructorController = [
  multer({ storage: multer.memoryStorage() }).single("image"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        email,
        firstName,
        lastName,
        phone,
        address,
        description,
        joinDate,
        enabled = true,
        branch,
        branchId,
      } = req.body as Record<string, unknown>;

      const enabledFinal =
        (req.body as any).isActive !== undefined
          ? String((req.body as any).isActive) === "true"
          : String(enabled) === "true";

      const branchFinal = String(branchId ?? branch ?? "");

      const disciplines = parseDisciplines(req.body.disciplines);

      if (
        !String(firstName || "").trim() ||
        disciplines.length === 0 ||
        !String(description || "").trim() ||
        !String(branchFinal || "").trim() ||
        !String(phone || "").trim() ||
        !String(joinDate || "").trim()
      ) {
        res.status(400).json({
          error:
            "Faltan campos obligatorios: nombre, disciplinas, descripción, sucursal, teléfono y fecha de ingreso",
        });
        return;
      }

      // Imagen obligatoria en creación
      let imageUrl = "";
      if (req.file) {
        try {
          imageUrl = await uploadLocal(req.file, "instructors");
        } catch (_) {
          imageUrl = "";
        }
      }
      if (!imageUrl) {
        res.status(400).json({
          error: "La imagen de perfil es obligatoria",
        });
        return;
      }

      // Corregido: Usamos el modelo 'instructor' (singular).
      // Asegúrate de ejecutar 'npx prisma generate' para actualizar el cliente.
      const instructor = await prisma.instructor.create({
        data: {
          firstName: String(firstName),
          lastName: lastName ? String(lastName) : null,
          email: email ? String(email) : null,
          phone: String(phone),
          address: address ? String(address) : null,
          description: String(description),
          joinDate: new Date(String(joinDate)), // Ensure valid date format
          disciplines: JSON.stringify(disciplines),
          enabled: enabledFinal,
          branch: branchFinal,
          image: imageUrl,
        },
      });

      res.status(201).json({
        message: "Instructor creado correctamente",
        id: instructor.id,
      });
    } catch (error: unknown) {
      console.error("🔥 ERROR al crear instructor:", error);
      res.status(500).json({
        error: "Error al crear instructor",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
];

/* ─────────────────────────────
   LIST
────────────────────────────── */
export const getAllInstructorsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const qp = req.query as Record<string, unknown>;
    const enabledRaw =
      typeof qp.enabled === "string" ? qp.enabled.toLowerCase() : undefined;

    let whereClause: any = {};
    if (enabledRaw === "true") whereClause.isActive = true;
    else if (enabledRaw === "false") whereClause.isActive = false;

    // Fetch all staff matching the active criteria
    const staffMembers = await prisma.staff.findMany({
      where: whereClause,
      include: {
        profile: true,
        instructorsDisciplines: {
          include: {
            discipline: true,
          },
        },
      },
    });

    // Filter by role manually since roles are serialized JSON strings
    const instructors = staffMembers.filter((staff) => {
      try {
        const roles = staff.roles;
        if (typeof roles === "string") {
          if (roles.includes("ROLE_INSTRUCTOR")) return true;
          try {
            const parsed = JSON.parse(roles);
            return Array.isArray(parsed) && parsed.includes("ROLE_INSTRUCTOR");
          } catch {
            return false;
          }
        }
        return false;
      } catch {
        return false;
      }
    });

    // Map to the expected format
    const formattedInstructors = instructors.map((inst) => ({
      id: inst.id,
      firstName: inst.profile?.firstname || inst.username,
      lastName: inst.profile?.paternalSurname || "",
      email: inst.email,
      phone: inst.profile?.telephone || "",
      address: inst.profile?.address || "",
      description: inst.profile?.description || "",
      joinDate: inst.profile?.admissionAt || inst.lastLogin,
      disciplines: inst.instructorsDisciplines.map((d) => d.discipline.name),
      enabled: inst.isActive,
      branch: "",
      image: inst.profile?.photo || "",
      createdAt: inst.profile?.createdAt,
      updatedAt: inst.profile?.updatedAt,
    }));

    res.status(200).json({ instructors: formattedInstructors });
  } catch (error) {
    console.error("Error getting instructors:", error);
    res.status(500).json({
      error: "Error al obtener instructores",
      details: String(error),
    });
  }
};

/* ─────────────────────────────
   GET ONE
────────────────────────────── */
export const getInstructorByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { instructorId } = req.params;

  const id = parseInt(instructorId);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const instructor = await prisma.staff.findUnique({
      where: { id },
      include: {
        profile: true,
        instructorsDisciplines: {
          include: {
            discipline: true,
          },
        },
      },
    });

    if (!instructor) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    // Check role
    let isInstructor = false;
    try {
      if (instructor.roles.includes("ROLE_INSTRUCTOR")) isInstructor = true;
      else {
        const parsed = JSON.parse(instructor.roles);
        if (Array.isArray(parsed) && parsed.includes("ROLE_INSTRUCTOR"))
          isInstructor = true;
      }
    } catch {}

    if (!isInstructor) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    const formattedInstructor = {
      id: instructor.id,
      firstName: instructor.profile?.firstname || instructor.username,
      lastName: instructor.profile?.paternalSurname || "",
      email: instructor.email,
      phone: instructor.profile?.telephone || "",
      address: instructor.profile?.address || "",
      description: instructor.profile?.description || "",
      joinDate: instructor.profile?.admissionAt || instructor.lastLogin,
      disciplines: instructor.instructorsDisciplines.map(
        (d) => d.discipline.name
      ),
      enabled: instructor.isActive,
      branch: "",
      image: instructor.profile?.photo || "",
      createdAt: instructor.profile?.createdAt,
      updatedAt: instructor.profile?.updatedAt,
    };

    res.status(200).json(formattedInstructor);
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener instructor",
      details: String(error),
    });
  }
};

/* ─────────────────────────────
   UPDATE
────────────────────────────── */
export const updateInstructorController = [
  multer({ storage: multer.memoryStorage() }).single("image"),
  async (req: Request, res: Response): Promise<void> => {
    const { instructorId } = req.params;
    const id = parseInt(instructorId);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    try {
      const existingInstructor = await prisma.instructor.findUnique({
        where: { id },
      });

      if (!existingInstructor) {
        res.status(404).json({ error: "Instructor no encontrado" });
        return;
      }

      const body = req.body;
      const disciplinesParsed = parseDisciplines(body.disciplines);

      const updateData: any = {};

      if (body.firstName) updateData.firstName = String(body.firstName);
      if (body.lastName) updateData.lastName = String(body.lastName);
      if (body.phone) updateData.phone = String(body.phone);
      if (body.address) updateData.address = String(body.address);
      if (body.description) updateData.description = String(body.description);
      if (body.joinDate) updateData.joinDate = new Date(String(body.joinDate));
      if (body.branch) updateData.branch = String(body.branch);
      if (body.email) updateData.email = String(body.email);

      if (body.isActive !== undefined) {
        updateData.enabled = String(body.isActive) === "true";
      } else if (body.enabled !== undefined) {
        updateData.enabled = String(body.enabled) === "true";
      }

      if (disciplinesParsed.length > 0) {
        updateData.disciplines = JSON.stringify(disciplinesParsed);
      } else if (
        body.disciplines &&
        Array.isArray(JSON.parse(JSON.stringify(body.disciplines))) &&
        JSON.parse(JSON.stringify(body.disciplines)).length === 0
      ) {
        // Allow clearing disciplines if explicit empty array
        updateData.disciplines = "[]";
      }

      // Handle image
      if (req.file) {
        try {
          const newUrl = await uploadLocal(req.file, "instructors");
          updateData.image = newUrl;

          // Delete old image
          if (existingInstructor.image) {
            await deleteLocalFile(existingInstructor.image);
          }
        } catch (_) {
          console.error("Error uploading new image");
        }
      }

      await prisma.instructor.update({
        where: { id },
        data: updateData,
      });

      res.status(200).json({ message: "Instructor actualizado correctamente" });
    } catch (error: unknown) {
      console.error("Error al actualizar instructor:", error);
      res.status(500).json({
        error: "Error al actualizar instructor",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
];

/* ─────────────────────────────
   DELETE
────────────────────────────── */
export const deleteInstructorController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { instructorId } = req.params;
  const id = parseInt(instructorId);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const instructor = await prisma.instructor.findUnique({
      where: { id },
    });

    if (!instructor) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    if (instructor.image) {
      await deleteLocalFile(instructor.image);
    }

    await prisma.instructor.delete({
      where: { id },
    });

    res.status(200).json({ message: "Instructor eliminado correctamente" });
  } catch (error) {
    res.status(500).json({
      error: "Error al eliminar instructor",
      details: String(error),
    });
  }
};
