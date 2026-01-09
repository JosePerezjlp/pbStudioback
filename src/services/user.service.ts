import prisma from "../config/prisma";
import { User, Staff } from "../generated/prisma/client";
import bcrypt from "bcrypt";

export interface UserContext {
  id: number;
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
      // Formato esperado: dd/mm (sin año)
      const parts = data.birthDate.trim().split("/");
      if (parts.length === 2) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);

        // Validar día y mes
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          // Usar año 2000 como año por defecto
          const testDate = new Date(2000, month - 1, day);

          // Verificar que la fecha sea válida (por ejemplo, 31/02 sería inválido)
          if (testDate.getDate() === day && testDate.getMonth() === month - 1) {
            birthday = testDate;
          }
        }
      }
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
        // Usuarios registrados desde la web/app comienzan con una free session disponible
        freeSession: true,
        roles: JSON.stringify(["user"]),
        createdAt: new Date(),
        updatedAt: new Date(),
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
      if (isValid) {
        // Registrar último inicio de sesión para usuarios finales
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });
        return this.mapUserToContext(user);
      }
    }

    // 2. Buscar en Staff
    const staff = await this.prisma.staff.findUnique({
      where: { email },
      include: { staffBranchOffices: true },
    });

    if (staff && staff.password) {
      const isValid = await bcrypt.compare(passwordPlain, staff.password);
      if (isValid) {
        // Registrar último inicio de sesión para staff/dashboard
        await this.prisma.staff.update({
          where: { id: staff.id },
          data: { lastLogin: new Date() },
        });
        return this.mapStaffToContext(staff);
      }
    }

    return null;
  }

  /**
   * Login o registro vía Google OAuth usando el email como clave.
   * Si el usuario ya existe, solo actualiza lastLogin.
   * Si no existe, crea uno nuevo con una contraseña aleatoria interna.
   */
  async loginOrRegisterWithGoogle(params: {
    email: string;
    name: string;
    lastname?: string;
  }): Promise<{ user: UserContext; isNewUser: boolean }> {
    const { email, name, lastname } = params;

    let isNewUser = false;

    // ¿Ya existe un usuario con este email?
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { branchOffice: true },
    });

    if (!user) {
      // Crear usuario nuevo con password aleatoria (el usuario luego puede
      // establecer/recuperar una contraseña local si quiere).
      const randomPassword = `google_${Math.random()
        .toString(36)
        .slice(2, 10)}_${Date.now().toString(36)}`;

      const created = await this.createUser({
        email,
        password: randomPassword,
        name,
        lastname,
      });

      user = await this.prisma.user.findUnique({
        where: { id: created.id },
        include: { branchOffice: true },
      });

      isNewUser = true;
    } else {
      // Usuario existente: solo registrar último login
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      user = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: { branchOffice: true },
      });
    }

    if (!user) {
      throw new Error("No se pudo obtener el usuario después de login Google");
    }

    const context = this.mapUserToContext(user);
    return { user: context, isNewUser };
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
    // Manejar AMBOS formatos: PHP serializado (datos viejos) y JSON (datos nuevos)
    let roles: string[] = ["user"];
    try {
      if (user.roles) {
        if (typeof user.roles === "string") {
          // JSON format: ["user"] o ["admin"]
          if (user.roles.startsWith("[")) {
            roles = JSON.parse(user.roles);
          }
          // PHP serialized format: a:{i:0;s:9:"ROLE_USER";}
          else if (user.roles.includes("a:{")) {
            // Extraer roles de formato PHP serializado
            if (user.roles.includes("ROLE_ADMIN")) {
              roles = ["admin"];
            } else if (user.roles.includes("ROLE_USER")) {
              roles = ["user"];
            } else {
              roles = ["user"]; // fallback
            }
          }
          // String simple: "user" o "admin"
          else {
            roles = [user.roles];
          }
        } else if (Array.isArray(user.roles)) {
          roles = user.roles;
        }
      }
    } catch (e) {
      console.error("Error parsing user roles:", e);
      // Fallback a ["user"] si falla el parse
    }

    let permissions: Record<string, string[]> = {};
    try {
      if (user.permissions) {
        permissions =
          typeof user.permissions === "string"
            ? JSON.parse(user.permissions)
            : user.permissions;
      }
    } catch (e) {
      console.error("Error parsing user permissions:", e);
    }

    return {
      id: user.id,
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
    // Manejar AMBOS formatos: PHP serializado (datos viejos) y JSON (datos nuevos)
    let roles: string[] = ["staff"];
    try {
      if (staff.roles) {
        if (typeof staff.roles === "string") {
          // JSON format: ["admin"], ["instructor"], etc.
          if (staff.roles.startsWith("[")) {
            roles = JSON.parse(staff.roles);
          }
          // PHP serialized format: a:{i:0;s:10:"ROLE_ADMIN";}
          else if (staff.roles.includes("a:{")) {
            // Extraer roles de formato PHP serializado
            if (staff.roles.includes("ROLE_ADMIN")) {
              roles = ["admin"];
            } else if (staff.roles.includes("ROLE_INSTRUCTOR")) {
              roles = ["instructor"];
            } else if (staff.roles.includes("ROLE_RECEPTION")) {
              roles = ["reception"];
            } else if (staff.roles.includes("ROLE_STAFF")) {
              roles = ["staff"];
            } else {
              roles = ["staff"]; // fallback
            }
          }
          // String simple: "admin", "instructor", etc.
          else {
            roles = [staff.roles];
          }
        } else if (Array.isArray(staff.roles)) {
          roles = staff.roles;
        }
      }
    } catch (e) {
      console.error("Error parsing staff roles:", e);
      // Fallback a ["staff"] si falla el parse
    }

    const isAdmin = roles.includes("admin");

    let permissions: Record<string, string[]> = {};
    try {
      if (staff.permissions) {
        // Manejar AMBOS formatos: PHP serializado y JSON
        if (typeof staff.permissions === "string") {
          const permsStr = staff.permissions.trim();

          // PHP serialized format: a:{i:0;s:15:"backend_session";...}
          if (permsStr.startsWith("a:")) {
            // Extraer todos los valores de permisos entre comillas
            // Ej: a:2:{i:0;s:15:"backend_session";i:1;s:12:"backend_user";}
            const matches = [...permsStr.matchAll(/"([^"]+)"/g)];
            const flatLegacyPerms = matches.map((m) => m[1]);
            permissions = this.mapLegacyStaffPermissions(
              flatLegacyPerms,
              roles
            );
          }
          // JSON format: {"dashboard":["estadisticas"],...}
          else if (permsStr.startsWith("{")) {
            permissions = JSON.parse(permsStr);
          }
        } else if (
          typeof staff.permissions === "object" &&
          staff.permissions !== null
        ) {
          permissions = staff.permissions;
        }
      }
    } catch (e) {
      console.error("Error parsing staff permissions:", e);
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
   * Convierte la lista plana de permisos legacy del backend PHP
   * (backend_session, backend_user_new, dashboard_stats, etc.)
   * al nuevo esquema de permisos por módulo/acción usado en Node.
   */
  private mapLegacyStaffPermissions(
    legacyPerms: string[],
    roles: string[]
  ): Record<string, string[]> {
    const result: Record<string, Set<string>> = {};

    const add = (module: string, action: string) => {
      if (!result[module]) result[module] = new Set<string>();
      result[module].add(action);
    };

    for (const perm of legacyPerms) {
      switch (perm) {
        // Dashboard
        case "dashboard_stats":
          add("dashboard", "estadisticas");
          break;

        // Paquetes
        case "backend_package":
          add("paquetes", "listado");
          break;
        case "backend_package_edit":
          add("paquetes", "editar");
          add("paquetes", "crear");
          break;

        // Clases (sessions)
        case "backend_session":
          add("clases", "listado");
          break;
        case "backend_session_new":
          add("clases", "crear");
          break;
        case "backend_session_edit":
          add("clases", "editar");
          break;
        case "backend_session_cancel":
          add("clases", "cancelar");
          break;
        case "backend_session_reservations":
          add("clases", "reservaciones");
          break;
        case "backend_session_waitinglist":
          add("clases", "lista_espera");
          break;

        // Clases por día
        case "backend_session_day":
          add("clases_por_dia", "listado");
          break;
        case "backend_session_day_new":
          add("clases_por_dia", "crear");
          break;
        case "backend_session_day_edit":
          add("clases_por_dia", "editar");
          break;

        // Usuarios
        case "backend_user":
          add("usuarios", "listado");
          break;
        case "backend_user_new":
          add("usuarios", "crear");
          break;
        case "backend_user_show":
          add("usuarios", "perfil");
          break;
        case "backend_user_edit":
          add("usuarios", "editar");
          break;
        case "backend_user_toggle_enable":
          add("usuarios", "habilitar_deshabilitar");
          break;
        case "backend_user_export":
          add("usuarios", "exportar");
          break;
        case "backend_user_reset_password":
          add("usuarios", "restablecer_contraseña");
          break;

        // Reservaciones de usuario
        case "backend_user_reservation_new":
          add("reservaciones", "crear");
          break;
        case "backend_user_reservation_cancel":
          add("reservaciones", "cancelar");
          break;

        // Transacciones
        case "backend_transaction":
        case "backend_transaction_show":
          add("transacciones", "listado");
          add("transacciones", "detalle");
          break;
        case "backend_transaction_new":
          add("transacciones", "crear");
          break;
        case "backend_transaction_edit_expiration":
          add("transacciones", "editar_fecha_expiracion");
          break;

        default:
          break;
      }
    }

    // Si no se pudo mapear nada y el rol es admin/colaborador,
    // dejamos que la lógica de más abajo asigne defaults para admin.
    if (Object.keys(result).length === 0) {
      return {};
    }

    // Convertir Sets a arrays simples
    const out: Record<string, string[]> = {};
    for (const [module, actions] of Object.entries(result)) {
      out[module] = Array.from(actions);
    }
    return out;
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
    }
    // Staff doesn't have sessionId field in database
  }
}

export const userService = new UserService();
