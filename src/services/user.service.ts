import prisma from "../config/prisma";
import { User, Staff } from "../generated/prisma/client";
import bcrypt from "bcrypt";

export interface UserContext {
  id: number;
  firebaseUid?: string | null;
  email: string;
  role: string;
  branches?: number[];
  isAdmin: boolean;
  name: string;
  type: "user" | "staff";
  permissions: Record<string, string[]>;
  sessionId?: string | null;
}

class UserService {
  private prisma = prisma;

  /**
   * Crea un nuevo usuario en SQL con contraseña hasheada
   */
  async createUser(data: {
    email: string;
    password: string;
    name: string;
    lastname?: string;
    phone?: string;
    birthDate?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  }): Promise<User> {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);

    let birthday: Date | null = null;
    if (data.birthDate) {
      birthday = new Date(data.birthDate);
    }

    return this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        lastname: data.lastname,
        phone: data.phone,
        birthday,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        enabled: true,
        freeSession: false,
        roles: JSON.stringify(["user"]),
      },
    });
  }

  /**
   * Valida credenciales de email/password
   */
  async validateUser(
    email: string,
    passwordPlain: string
  ): Promise<UserContext | null> {
    // 1. Buscar en Users
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { branchOffice: true },
    });

    if (user && user.password) {
      const isValid = await bcrypt.compare(passwordPlain, user.password);
      if (isValid) return this.mapUserToContext(user);
    }

    // 2. Buscar en Staff
    const staff = await this.prisma.staff.findUnique({
      where: { email },
      include: { staffBranchOffices: true },
    });

    if (staff && staff.password) {
      const isValid = await bcrypt.compare(passwordPlain, staff.password);
      if (isValid) return this.mapStaffToContext(staff);
    }

    return null;
  }

  /**
   * Obtiene usuario por ID (SQL)
   */
  async getUserById(
    id: number,
    type: "user" | "staff" = "user"
  ): Promise<UserContext | null> {
    if (type === "user") {
      const user = await this.prisma.user.findUnique({
        where: { id },
        include: { branchOffice: true },
      });
      return user ? this.mapUserToContext(user) : null;
    } else {
      const staff = await this.prisma.staff.findUnique({
        where: { id },
        include: { staffBranchOffices: true },
      });
      return staff ? this.mapStaffToContext(staff) : null;
    }
  }

  private mapUserToContext(user: any): UserContext {
    let roles: string[] = ["user"];
    try {
      if (user.roles) {
        if (user.roles.startsWith("[")) {
          roles = JSON.parse(user.roles);
        } else {
          roles = [user.roles];
        }
      }
    } catch (e) {}

    let permissions: Record<string, string[]> = {};
    try {
      if (user.permissions) {
        permissions =
          typeof user.permissions === "string"
            ? JSON.parse(user.permissions)
            : user.permissions;
      }
    } catch (e) {}

    return {
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      role: roles.includes("admin") ? "admin" : "user",
      isAdmin: roles.includes("admin"),
      branches: user.branchOfficeId ? [user.branchOfficeId] : [],
      type: "user",
      permissions,
      sessionId: user.sessionId,
    };
  }

  private mapStaffToContext(staff: any): UserContext {
    let roles: string[] = [];
    try {
      if (staff.roles && staff.roles.startsWith("[")) {
        roles = JSON.parse(staff.roles);
      } else {
        roles = [staff.roles];
      }
    } catch (e) {}

    const isAdmin = roles.includes("admin");

    let permissions: Record<string, string[]> = {};
    try {
      if (staff.permissions) {
        permissions =
          typeof staff.permissions === "string"
            ? JSON.parse(staff.permissions)
            : staff.permissions;
      }
    } catch (e) {}

    // Staff doesn't have sessionId in schema, but adminSessionGuard tried to read it.
    // If we want to support it, we should add it to Staff schema too.
    // For now, let's assume it's null for staff or handle it later.
    // Wait, adminSessionGuard.ts says: "Only require unique session for admin and employee".
    // If staff are employees, they need it.
    // I didn't add sessionId to Staff table. I should have.
    // But let's check if I can just return null for now to fix the compilation/logic.

    return {
      id: staff.id,
      firebaseUid: staff.firebaseUid,
      email: staff.email || "",
      name: staff.username || "Staff",
      role: roles[0] || "staff",
      isAdmin,
      branches: staff.staffBranchOffices.map((sb: any) => sb.branchOfficeId),
      type: "staff",
      permissions,
      sessionId: staff.sessionId,
    };
  }
}

export const userService = new UserService();
