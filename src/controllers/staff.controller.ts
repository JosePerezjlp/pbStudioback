import { Request, Response } from "express";
import prisma from "../config/prisma";
import bcrypt from "bcrypt";
import { RolTypeEnum, StatusTypeEnum } from "../types/enums";
import { Staff } from "../generated/prisma/client";

// Helper to format staff for response
const formatStaffResponse = (staff: any) => {
  let permissions = {};
  try {
    permissions = staff.permissions ? JSON.parse(staff.permissions) : {};
  } catch (e) {}

  let roles = [];
  try {
    roles = staff.roles ? JSON.parse(staff.roles) : [];
  } catch (e) {
    // If it's a simple string
    roles = [staff.roles];
  }

  const branches = staff.staffBranchOffices
    ? staff.staffBranchOffices.map((sb: any) => sb.branchOfficeId.toString())
    : [];

  return {
    id: staff.id,
    email: staff.email,
    username: staff.username,
    role: roles[0] || "",
    branches,
    permissions,
    status: staff.isActive ? StatusTypeEnum.ACTIVE : StatusTypeEnum.INACTIVE,
    firstName: staff.profile?.firstname,
    lastName: staff.profile?.paternalSurname, // Mapping paternalSurname to lastName for consistency
    phone: staff.profile?.telephone,
    createdAt: staff.profile?.createdAt,
    updatedAt: staff.profile?.updatedAt,
  };
};

export const checkStaffEmailExists = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== "string") {
      res.status(409).json({ error: "El parámetro 'email' es requerido" });
      return;
    }

    const staff = await prisma.staff.findUnique({
      where: { email },
    });

    if (staff) {
      res.status(409).json({
        error: "Este correo ya está registrado en la base de datos",
        code: "sql/email-already-exists",
      });
      return;
    }

    res.status(200).json({ message: "Correo disponible" });
  } catch (error) {
    console.error("Error al verificar el email:", error);
    res.status(500).json({
      error: "Error interno al verificar el correo",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};

// 🔐 Crear nuevo usuario staff
export const createStaffUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      email,
      password,
      role,
      branches,
      permissions,
      status,
      firstName,
      lastName,
      phone,
    }: {
      email: string;
      password: string;
      role: RolTypeEnum;
      branches: string[];
      permissions: Record<string, string[]>;
      status: StatusTypeEnum;
      firstName?: string;
      lastName?: string;
      phone?: string;
    } = req.body;

    // Validar email
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({
        error: "Email inválido o faltante",
      });
      return;
    }

    // Validar password mínimo 8 caracteres
    if (!password || typeof password !== "string" || password.length < 8) {
      res.status(400).json({
        error: "La contraseña debe tener al menos 8 caracteres",
      });
      return;
    }

    // Validar role
    if (
      !role ||
      (role !== RolTypeEnum.ADMIN &&
        role !== RolTypeEnum.COLLABORATOR &&
        role !== RolTypeEnum.INSTRUCTOR)
    ) {
      res.status(400).json({
        error: "Role inválido. Debe ser 'admin', 'collaborator' o 'instructor'",
      });
      return;
    }

    // Validar branches
    if (!Array.isArray(branches) || branches.length === 0) {
      res.status(400).json({
        error: "Debe asignar al menos una sucursal",
      });
      return;
    }

    // Validar que todas las branches existan
    // Assuming branches are IDs (strings in request, need to parse to Int)
    const branchIds = branches.map((b) => parseInt(b, 10)).filter((b) => !isNaN(b));
    
    const existingBranches = await prisma.branchOffice.findMany({
      where: {
        id: { in: branchIds },
      },
    });

    if (existingBranches.length !== branchIds.length) {
       res.status(400).json({
        error: `Algunas sucursales no existen`,
      });
      return;
    }

    // Validar permissions
    if (
      !permissions ||
      typeof permissions !== "object" ||
      Array.isArray(permissions)
    ) {
      res.status(400).json({
        error: "Permissions debe ser un objeto",
      });
      return;
    }

    // Validar status
    if (
      !status ||
      (status !== StatusTypeEnum.ACTIVE && status !== StatusTypeEnum.INACTIVE)
    ) {
      res.status(400).json({
        error: "Status inválido. Debe ser 'Activo' o 'Inactivo'",
      });
      return;
    }

    // 🔍 Verificamos si ya hay un usuario con ese email
    const existingStaff = await prisma.staff.findUnique({
      where: { email },
    });

    if (existingStaff) {
      res.status(400).json({
        error: "Este correo ya está registrado en la base de datos",
        code: "sql/email-already-exists",
      });
      return;
    }

    // Generate username (required by schema)
    let username = email.split("@")[0];
    // Ensure uniqueness
    let count = 0;
    while (await prisma.staff.findUnique({ where: { username } })) {
      count++;
      username = `${email.split("@")[0]}${count}`;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create Staff in transaction to ensure profile and relations are created
    const newStaff = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          email,
          username,
          password: hashedPassword,
          roles: JSON.stringify([role]), // Storing as array JSON
          permissions: JSON.stringify(permissions),
          isActive: status === StatusTypeEnum.ACTIVE,
          deleted: false,
        },
      });

      // Create Profile
      await tx.staffProfile.create({
        data: {
          staffId: staff.id,
          firstname: firstName || "Staff",
          paternalSurname: lastName || "",
          telephone: phone || "0000000000",
          admissionAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create Branch relations
      if (branchIds.length > 0) {
        await tx.staffBranchOffice.createMany({
          data: branchIds.map((bid) => ({
            staffId: staff.id,
            branchOfficeId: bid,
          })),
        });
      }

      return staff;
    });

    res.status(201).json({
      message: "Staff creado correctamente",
      id: newStaff.id,
    });
  } catch (error: unknown) {
    console.error("Error al crear staff:", error);
    res.status(500).json({
      error: "Error interno al crear staff",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};

// 📋 Listar todos los usuarios staff
export const getAllStaffUsers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const statusParam = String(req.query.status || "all").toLowerCase();
    const roleParam = String(req.query.role || "all").toLowerCase();

    // Correos de superusuarios que nunca deben mostrarse
    const superUsers = [
      "johandevadmin@pbstudioapp.com",
      "admintemporal@pbstudioapp.com",
    ];

    const whereClause: any = {
      deleted: false,
      email: { notIn: superUsers },
    };

    if (statusParam === "active") {
      whereClause.isActive = true;
    } else if (statusParam === "inactive") {
      whereClause.isActive = false;
    }

    // Role filtering in JSON column is tricky in Prisma without raw query or filtering in memory.
    // For simplicity, let's fetch and filter in memory if roleParam is set.
    
    const staffListRaw = await prisma.staff.findMany({
      where: whereClause,
      include: {
        staffBranchOffices: true,
        profile: true,
      },
      orderBy: {
        id: "desc", // Using ID as proxy for creation time since createdAt is not on Staff table (it's on Profile)
      },
    });

    let staffList = staffListRaw.map(formatStaffResponse);

    if (roleParam !== "all") {
       staffList = staffList.filter(s => s.role.toLowerCase() === roleParam);
    }

    res.status(200).json({ staff: staffList });
  } catch (error) {
    console.error("Error al listar staff:", error);
    res.status(500).json({
      error: "Error interno al listar staff",
      details: String(error),
    });
  }
};

// 🔎 Obtener usuario staff por ID
export const getStaffUserById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const staffId = parseInt(id, 10);

    if (isNaN(staffId)) {
       res.status(404).json({ error: "Usuario no encontrado" });
       return;
    }

    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      include: {
        staffBranchOffices: true,
        profile: true,
      },
    });

    if (!staff || staff.deleted) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.status(200).json(formatStaffResponse(staff));
  } catch (error) {
    console.error("Error al obtener staff:", error);
    res.status(500).json({
      error: "Error interno al obtener staff",
      details: String(error),
    });
  }
};

// ✏️ Actualizar usuario staff
export const updateStaffUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const staffId = parseInt(id, 10);
    if (isNaN(staffId)) {
        res.status(404).json({ error: "Usuario no encontrado" });
        return;
    }

    const updateData: Record<string, unknown> = req.body;

    const existingStaff = await prisma.staff.findUnique({
      where: { id: staffId },
      include: { profile: true },
    });

    if (!existingStaff || existingStaff.deleted) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const dataToUpdate: any = {};
    const profileToUpdate: any = {};

    // Update Email
    if ("email" in updateData) {
      const email = updateData.email as string;
      if (!email || !email.includes("@")) {
        res.status(400).json({ error: "Email inválido" });
        return;
      }
      // Check uniqueness
      const check = await prisma.staff.findUnique({ where: { email } });
      if (check && check.id !== staffId) {
        res.status(400).json({ error: "Email ya registrado", code: "sql/email-already-exists" });
        return;
      }
      dataToUpdate.email = email;
    }

    // Update Role
    if ("role" in updateData) {
      const role = updateData.role as string;
       if (
        role !== RolTypeEnum.ADMIN &&
        role !== RolTypeEnum.COLLABORATOR &&
        role !== RolTypeEnum.INSTRUCTOR
      ) {
        res.status(400).json({ error: "Role inválido" });
        return;
      }
      dataToUpdate.roles = JSON.stringify([role]);
    }

    // Update Status
    if ("status" in updateData) {
       const status = updateData.status;
       dataToUpdate.isActive = status === StatusTypeEnum.ACTIVE;
    }

    // Update Permissions
    if ("permissions" in updateData) {
       dataToUpdate.permissions = JSON.stringify(updateData.permissions);
    }

    // Update Profile fields
    if ("firstName" in updateData) profileToUpdate.firstname = updateData.firstName;
    if ("lastName" in updateData) profileToUpdate.paternalSurname = updateData.lastName;
    if ("phone" in updateData) profileToUpdate.telephone = updateData.phone;

    // Branches update
    let branchesToUpdate: number[] | null = null;
    if ("branches" in updateData && Array.isArray(updateData.branches)) {
        branchesToUpdate = updateData.branches.map((b: any) => parseInt(b, 10)).filter((b: number) => !isNaN(b));
    }

    await prisma.$transaction(async (tx) => {
        if (Object.keys(dataToUpdate).length > 0) {
            await tx.staff.update({
                where: { id: staffId },
                data: dataToUpdate
            });
        }
        
        if (Object.keys(profileToUpdate).length > 0) {
            if (existingStaff.profile) {
                await tx.staffProfile.update({
                    where: { id: existingStaff.profile.id },
                    data: { ...profileToUpdate, updatedAt: new Date() }
                });
            } else {
                await tx.staffProfile.create({
                    data: {
                        staffId: staffId,
                        firstname: profileToUpdate.firstname || "Staff",
                        paternalSurname: profileToUpdate.paternalSurname || "",
                        ...profileToUpdate,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                });
            }
        }

        if (branchesToUpdate) {
            // Delete existing
            await tx.staffBranchOffice.deleteMany({
                where: { staffId: staffId }
            });
            // Create new
            if (branchesToUpdate.length > 0) {
                await tx.staffBranchOffice.createMany({
                    data: branchesToUpdate.map(bid => ({
                        staffId: staffId,
                        branchOfficeId: bid
                    }))
                });
            }
        }
    });

    res.status(200).json({ message: "Usuario actualizado correctamente" });
  } catch (error) {
    console.error("Error al actualizar staff:", error);
    res.status(500).json({
      error: "Error interno al actualizar staff",
      details: String(error),
    });
  }
};

// ❌ Eliminar usuario staff (Soft delete)
export const deleteStaffUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const staffId = parseInt(id, 10);
     if (isNaN(staffId)) {
        res.status(404).json({ error: "Usuario no encontrado" });
        return;
    }

    await prisma.staff.update({
        where: { id: staffId },
        data: { deleted: true, isActive: false }
    });

    res.status(200).json({ message: "Usuario eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar staff:", error);
    res.status(500).json({
      error: "Error interno al eliminar staff",
      details: String(error),
    });
  }
};

// 🔑 Cambiar contraseña
export const changeStaffPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const staffId = parseInt(id, 10);

    if (isNaN(staffId)) {
        res.status(404).json({ error: "Usuario no encontrado" });
        return;
    }

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({
        error: "La nueva contraseña es requerida y debe tener al menos 8 caracteres",
      });
      return;
    }

    const staff = await prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff || staff.deleted) {
       res.status(404).json({ error: "Usuario no encontrado" });
       return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.staff.update({
        where: { id: staffId },
        data: { password: hashedPassword }
    });

    res.status(200).json({ message: "Contraseña actualizada" });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    res.status(500).json({
      error: "Error interno al cambiar contraseña",
      details: String(error),
    });
  }
};
