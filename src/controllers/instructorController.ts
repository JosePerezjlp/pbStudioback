import { Request, Response } from "express";
import multer from "multer";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../config/prisma";
import { uploadToFirebaseStorage } from "../utils/firebaseStorage";

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

// Normaliza el estado recibido desde el frontend a flags internos
// Regla para instructores: status 0 = activo, status 1 = inactivo
// Soportamos temporalmente "enabled" / "isActive" para compatibilidad.
const resolveActiveFromBody = (body: Record<string, unknown>): boolean => {
  // Prioridad 1: status numérico (0/1) como string o número
  const rawStatus = body.status as unknown;
  if (rawStatus !== undefined && rawStatus !== null) {
    const n = Number(rawStatus);
    if (!Number.isNaN(n)) {
      return n === 0; // 0 = activo, 1 = inactivo
    }
  }

  // Prioridad 2: isActive explícito
  if ((body as any).isActive !== undefined) {
    return String((body as any).isActive) === "true";
  }

  // Prioridad 3: enabled (legacy boolean)
  if (body.enabled !== undefined) {
    return String(body.enabled) === "true";
  }

  // Valor por defecto: activo
  return true;
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
        branch,
        branchId,
      } = req.body as Record<string, unknown>;

      // status 0 = activo, 1 = inactivo (ver helper)
      const enabledFinal = resolveActiveFromBody(req.body as Record<string, unknown>);

      const branchFinal = String(branchId ?? branch ?? "");

      const disciplines = parseDisciplines(req.body.disciplines);

      if (
        !String(firstName || "").trim() ||
        disciplines.length === 0 ||
        !String(description || "").trim() ||
        !String(joinDate || "").trim()
      ) {
        res.status(400).json({
          error:
            "Faltan campos obligatorios: nombre, disciplinas, descripción y fecha de ingreso",
        });
        return;
      }

      // Imagen obligatoria en creación
      let imageUrl = "";
      if (req.file) {
        try {
          imageUrl = await uploadToFirebaseStorage(req.file, "instructors");
        } catch (e) {
          console.error("Error subiendo imagen a Firebase Storage:", e);
          imageUrl = "";
        }
      }
      if (!imageUrl) {
        res.status(400).json({
          error: "La imagen de perfil es obligatoria",
        });
        return;
      }

      // Crear instructor usando tablas staff / staff_profile / instructors_disciplines / staff_branch_office

      // username único basado en email o nombre
      const baseUsername = (email && String(email).split("@")[0]) || String(firstName).toLowerCase().replace(/[^a-z0-9]/gi, "");
      const username = `${baseUsername || "instructor"}-${Date.now()}`.slice(0, 25);

      // password aleatoria (no se expone)
      const rawPassword = uuidv4();
      const passwordHash = await bcrypt.hash(rawPassword, 10);

      const parsedJoinDate = new Date(String(joinDate));

      // branchId numérico (si viene)
      let branchOfficeId: number | null = null;
      if (branchFinal && !Number.isNaN(Number(branchFinal))) {
        branchOfficeId = Number(branchFinal);
      }

      const disciplineIds = disciplines
        .map((d) => Number(d))
        .filter((n) => Number.isFinite(n));

      const created = await prisma.$transaction(async (tx) => {
        const staff = await tx.staff.create({
          data: {
            username,
            password: passwordHash,
            email: email ? String(email) : null,
            roles: JSON.stringify(["ROLE_INSTRUCTOR"]),
            isActive: enabledFinal,
            permissions: "{}",
            deleted: false,
          },
        });

        await tx.staffProfile.create({
          data: {
            staffId: staff.id,
            firstname: String(firstName || ""),
            paternalSurname: lastName ? String(lastName) : null,
            telephone: phone ? String(phone) : null,
            address: address ? String(address) : null,
            description: description ? String(description) : null,
            admissionAt: parsedJoinDate,
            photo: imageUrl,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        if (branchOfficeId) {
          await tx.staffBranchOffice.create({
            data: {
              staffId: staff.id,
              branchOfficeId,
            },
          });
        }

        if (disciplineIds.length > 0) {
          await tx.instructorsDisciplines.createMany({
            data: disciplineIds.map((disciplineId) => ({
              staffId: staff.id,
              disciplineId,
            })),
            skipDuplicates: true,
          });
        }

        return staff;
      });

      res.status(201).json({
        message: "Instructor creado correctamente",
        id: created.id,
      });
      return;
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

    // Nuevo contrato: status 0 = activo, 1 = inactivo
    const statusRaw =
      typeof qp.status === "string" ? qp.status.trim() : undefined;

    // Compatibilidad: también aceptamos enabled=true/false
    const enabledRaw =
      typeof qp.enabled === "string" ? qp.enabled.toLowerCase() : undefined;

    let whereClause: any = { deleted: false };

    if (statusRaw === "0") {
      whereClause.isActive = true;
    } else if (statusRaw === "1") {
      whereClause.isActive = false;
    } else if (enabledRaw === "true") {
      whereClause.isActive = true;
    } else if (enabledRaw === "false") {
      whereClause.isActive = false;
    }

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
        staffBranchOffices: true,
      },
    });

    // Para evitar problemas de datos inconsistentes (donde la relación staff_branch_office no existe pero la tabla legacy 'instructor' tiene el dato),
    // vamos a buscar también en la tabla 'instructor' si es necesario.
    // Esto es un "fix" temporal para soportar migraciones incompletas.

    // Obtenemos los IDs de staff que no tienen sucursales cargadas
    const staffIdsWithoutBranch = staffMembers
      .filter((s) => s.staffBranchOffices.length === 0)
      .map((s) => s.id);

    // Buscamos en la tabla 'instructor' legacy
    let legacyInstructorsMap = new Map<number, string>();
    // COMENTADO: La tabla 'instructor' legacy ya no existe en el schema
    // if (staffIdsWithoutBranch.length > 0) {
    //   const legacyInstructors = await prisma.instructor.findMany({
    //     where: { id: { in: staffIdsWithoutBranch } },
    //     select: { id: true, branch: true },
    //   });
    //   legacyInstructors.forEach((li) => {
    //     if (li.branch) legacyInstructorsMap.set(li.id, li.branch);
    //   });
    // }

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
    const formattedInstructors = instructors.map((inst) => {
      let branchId: number | null = null;

      if (inst.staffBranchOffices.length > 0) {
        branchId = inst.staffBranchOffices[0].branchOfficeId;
      } else {
        // Fallback: intentar obtener de la tabla legacy 'instructor'
        const legacyBranch = legacyInstructorsMap.get(inst.id);
        if (legacyBranch && !isNaN(Number(legacyBranch))) {
          branchId = Number(legacyBranch);
        }
      }

      return {
        id: inst.id,
        firstName: inst.profile?.firstname || inst.username,
        lastName: inst.profile?.paternalSurname || "",
        email: inst.email,
        phone: inst.profile?.telephone || "",
        address: inst.profile?.address || "",
        description: inst.profile?.description || "",
        joinDate: inst.profile?.admissionAt || inst.lastLogin,
        disciplines: inst.instructorsDisciplines.map((d) => d.discipline.name),
        // status 0 = activo, 1 = inactivo
        status: inst.isActive ? 0 : 1,
        enabled: inst.isActive,
        branch: branchId, // ID numérico o null
        image: inst.profile?.photo || "",
        createdAt: inst.profile?.createdAt,
        updatedAt: inst.profile?.updatedAt,
      };
    });

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
        staffBranchOffices: true,
      },
    });

    if (!instructor || instructor.deleted) {
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

    let branchId =
      instructor.staffBranchOffices.length > 0
        ? instructor.staffBranchOffices[0].branchOfficeId
        : null;

    // COMENTADO: La tabla 'instructor' legacy ya no existe en el schema
    // if (!branchId) {
    //   const legacyInst = await prisma.instructor.findUnique({
    //     where: { id },
    //     select: { branch: true },
    //   });
    //   if (legacyInst?.branch && !isNaN(Number(legacyInst.branch))) {
    //     branchId = Number(legacyInst.branch);
    //   }
    // }

    if (!branchId && instructor.email) {
      const userWithBranch = await prisma.user.findUnique({
        where: { email: instructor.email },
        select: { branchOfficeId: true },
      });
      if (userWithBranch?.branchOfficeId) {
        branchId = userWithBranch.branchOfficeId;
      }
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
      // status 0 = activo, 1 = inactivo
      status: instructor.isActive ? 0 : 1,
      enabled: instructor.isActive,
      branch: branchId,
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
      const existing = await prisma.staff.findUnique({
        where: { id },
        include: {
          profile: true,
          instructorsDisciplines: true,
          staffBranchOffices: true,
        },
      });

      if (!existing) {
        res.status(404).json({ error: "Instructor no encontrado" });
        return;
      }

      // Validar que realmente sea instructor
      let isInstructor = false;
      try {
        if (existing.roles.includes("ROLE_INSTRUCTOR")) isInstructor = true;
        else {
          const parsed = JSON.parse(existing.roles);
          if (Array.isArray(parsed) && parsed.includes("ROLE_INSTRUCTOR")) {
            isInstructor = true;
          }
        }
      } catch {
        // noop
      }

      if (!isInstructor) {
        res.status(404).json({ error: "Instructor no encontrado" });
        return;
      }

      const body = req.body as Record<string, unknown>;

      const disciplinesParsed = parseDisciplines(body.disciplines);

      // status 0 = activo, 1 = inactivo; si no viene, mantenemos valor actual
      const hasStatusField =
        body.status !== undefined || (body as any).isActive !== undefined ||
        body.enabled !== undefined;
      const enabledFinal = hasStatusField
        ? resolveActiveFromBody(body)
        : undefined;

      const branchFinal = String((body.branchId ?? body.branch) ?? "");

      // Subir nueva imagen si viene
      let newImageUrl: string | undefined;
      if (req.file) {
        try {
          newImageUrl = await uploadToFirebaseStorage(req.file, "instructors");
        } catch (e) {
          console.error("Error subiendo nueva imagen a Firebase Storage:", e);
        }
      }

      await prisma.$transaction(async (tx) => {
        // Actualizar tabla staff
        const staffUpdateData: any = {};
        if (body.email !== undefined) {
          staffUpdateData.email = body.email ? String(body.email) : null;
        }
        if (enabledFinal !== undefined) {
          staffUpdateData.isActive = enabledFinal;
        }

        if (Object.keys(staffUpdateData).length > 0) {
          await tx.staff.update({
            where: { id },
            data: staffUpdateData,
          });
        }

        // Actualizar / crear perfil
        const profileUpdateData: any = {};
        if (body.firstName !== undefined)
          profileUpdateData.firstname = String(body.firstName);
        if (body.lastName !== undefined)
          profileUpdateData.paternalSurname = String(body.lastName);
        if (body.phone !== undefined)
          profileUpdateData.telephone = body.phone
            ? String(body.phone)
            : null;
        if (body.address !== undefined)
          profileUpdateData.address = body.address
            ? String(body.address)
            : null;
        if (body.description !== undefined)
          profileUpdateData.description = body.description
            ? String(body.description)
            : null;
        if (body.joinDate !== undefined) {
          profileUpdateData.admissionAt = new Date(String(body.joinDate));
        }
        if (newImageUrl) {
          profileUpdateData.photo = newImageUrl;
        }
        if (Object.keys(profileUpdateData).length > 0) {
          profileUpdateData.updatedAt = new Date();

          const existingProfile = await tx.staffProfile.findUnique({
            where: { staffId: id },
          });

          if (existingProfile) {
            await tx.staffProfile.update({
              where: { id: existingProfile.id },
              data: profileUpdateData,
            });
          } else {
            await tx.staffProfile.create({
              data: {
                staffId: id,
                ...profileUpdateData,
                createdAt: new Date(),
              },
            });
          }
        }

        // Actualizar sucursal si viene un valor numérico
        if (branchFinal) {
          const branchOfficeId = Number(branchFinal);
          if (Number.isFinite(branchOfficeId)) {
            await tx.staffBranchOffice.deleteMany({ where: { staffId: id } });
            await tx.staffBranchOffice.create({
              data: {
                staffId: id,
                branchOfficeId,
              },
            });
          }
        }

        // Actualizar disciplinas si vienen
        if (disciplinesParsed.length > 0) {
          const disciplineIds = disciplinesParsed
            .map((d) => Number(d))
            .filter((n) => Number.isFinite(n));

          await tx.instructorsDisciplines.deleteMany({
            where: { staffId: id },
          });

          if (disciplineIds.length > 0) {
            await tx.instructorsDisciplines.createMany({
              data: disciplineIds.map((disciplineId) => ({
                staffId: id,
                disciplineId,
              })),
              skipDuplicates: true,
            });
          }
        }
      });

      res.status(200).json({ message: "Instructor actualizado correctamente" });
      return;
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
    const existing = await prisma.staff.findUnique({
      where: { id },
    });

    if (!existing || existing.deleted) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    // Validar que realmente sea instructor
    let isInstructor = false;
    try {
      if (existing.roles.includes("ROLE_INSTRUCTOR")) isInstructor = true;
      else {
        const parsed = JSON.parse(existing.roles);
        if (Array.isArray(parsed) && parsed.includes("ROLE_INSTRUCTOR")) {
          isInstructor = true;
        }
      }
    } catch {
      // noop
    }

    if (!isInstructor) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    // Borrado lógico: deleted = true e inactivo
    await prisma.staff.update({
      where: { id },
      data: {
        deleted: true,
        isActive: false,
      },
    });

    res.status(200).json({ message: "Instructor eliminado correctamente" });
  } catch (error) {
    res.status(500).json({
      error: "Error al eliminar instructor",
      details: String(error),
    });
  }
};
