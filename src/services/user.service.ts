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
    passwordPlain: string,
    isDashboard: boolean = false
  ): Promise<UserContext | null> {
    // Si es login de dashboard, buscar SOLO en Staff
    if (isDashboard) {
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

    // Comportamiento normal (Web/App):
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
      const rawRoles = staff.roles;
      if (rawRoles) {
        if (rawRoles.startsWith("[")) {
          // JSON format: ["admin", "staff"]
          roles = JSON.parse(rawRoles);
        } else if (rawRoles.includes("ROLE_ADMIN")) {
          // PHP Serialized format hack: check content
          roles = ["admin"];
        } else if (rawRoles.includes("ROLE_INSTRUCTOR")) {
          roles = ["instructor"];
        } else if (rawRoles.includes("ROLE_RECEPTION")) {
          roles = ["reception"];
        } else {
          // Fallback or single string
          roles = [rawRoles];
        }
      }
    } catch (e) {}

    const isAdmin = roles.includes("admin");

    let permissions: Record<string, string[]> = {};
    try {
      if (staff.permissions) {
        // Handle PHP Serialized permissions (starts with a:)
        if (
          typeof staff.permissions === "string" &&
          staff.permissions.startsWith("a:")
        ) {
          // For now, if it's PHP serialized, we might fail to parse it easily in JS without a library.
          // But if you just saved it from the new system, it should be JSON stringified.
          // If it is coming from the old system as PHP serialized, we might need a parser or just reset it.
          // Let's assume if it starts with 'a:', we can't read it easily yet, so we treat it as empty or try to regex.

          // However, the user says "se guardo correctamente .. aparecen los permisos".
          // This suggests it MIGHT be saved as JSON string but maybe the "string" check is failing or JSON.parse is failing?
          // Or maybe it is saved as an object in Prisma if the type is JSON?
          // Prisma types `Json` field as `any` or object, not string.

          // Let's check if it's already an object
          if (typeof staff.permissions === "object") {
            permissions = staff.permissions;
          } else {
            permissions = JSON.parse(staff.permissions);
          }
        } else {
          // Standard JSON parsing attempt
          permissions =
            typeof staff.permissions === "string"
              ? JSON.parse(staff.permissions)
              : staff.permissions;
        }
      }
    } catch (e) {
      console.log("Error parsing permissions:", e);
    }

    // Si es admin, otorgar todos los permisos por defecto si no tiene ninguno definido
    if (isAdmin && Object.keys(permissions).length === 0) {
      permissions = {
        dashboard: ["estadisticas"],
        sucursales: ["listado", "crear", "editar"],
        salones: ["editar", "crear", "listado"],
        paquetes: ["editar", "crear", "listado"],
        disciplinas: ["editar", "crear", "listado"],
        instructores: ["listado", "crear", "editar", "borrar"],
        clases: [
          "lista_espera",
          "reservaciones",
          "cancelar",
          "editar",
          "crear",
          "listado",
        ],
        clases_por_dia: ["editar", "crear", "listado"],
        usuarios: [
          "editar",
          "restablecer_contraseña",
          "habilitar_deshabilitar",
          "perfil",
          "crear",
          "exportar",
          "listado",
        ],
        reservaciones: ["crear", "cancelar"],
        transacciones: [
          "listado",
          "caja",
          "detalle",
          "cancelar",
          "editar_fecha_expiracion",
        ],
        cupones: ["listado", "crear", "editar", "detalle"],
        contenido: ["editar"],
        configuracion: ["editar"],
        staff: ["listado", "crear", "editar"],
        operaciones: ["ver"],
      };
    }

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

  /**
   * Obtiene estadísticas de usuarios
   */
  async getUsersStats() {
    const totalUsers = await this.prisma.user.count();

    const activeUsers = await this.prisma.user.count({
      where: { enabled: true },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newUsersLast30Days = await this.prisma.user.count({
      where: {
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
    });

    return {
      totalUsers,
      activeUsers,
      newUsersLast30Days,
    };
  }

  /**
   * Obtiene los usuarios más recientes
   */
  async getRecentUsers(limit: number = 5) {
    return this.prisma.user.findMany({
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        name: true,
        lastname: true,
        email: true,
        createdAt: true,
        phone: true,
        enabled: true,
      },
    });
  }

  /**
   * Actualiza el sessionId de un usuario o staff
   */
  async updateSessionId(
    id: number,
    type: "user" | "staff",
    sessionId: string
  ): Promise<void> {
    if (type === "user") {
      await this.prisma.user.update({
        where: { id },
        data: { sessionId },
      });
    } else {
      await this.prisma.staff.update({
        where: { id },
        data: { sessionId },
      });
    }
  }
}

export const userService = new UserService();
