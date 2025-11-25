import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validationResult } from "express-validator";
import admin from "../config/firebase";
import { DateTime } from "luxon";
import { sendWelcomeEmail } from "../utils/emailService";

export const completeProfileFromAuthController = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Helper local para extraer Bearer token
  const getBearer = (r: Request): string | null => {
    const h = r.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
  };

  try {
    // 1) Verificar ID token -> obtener uid y email confiables
    const idToken = getBearer(req);
    if (!idToken) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Falta Authorization Bearer token",
      });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { uid } = decoded;
    const emailFromToken = decoded.email ?? "";

    if (!uid || !emailFromToken) {
      res
        .status(401)
        .json({ error: "UNAUTHORIZED", message: "Token inválido" });
      return;
    }

    // 2) Body de perfil
    const {
      firstName,
      lastName,
      phone = "",
      branch = "",
      birthDate = "",
      emergencyContact,
      password, // opcional: si llega, se configura en Auth
      // enabled, // ignorado si llega: no lo forzamos desde cliente
      // freeSession, // ignorado si llega: no lo forzamos desde cliente
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      email, // si llega en el body se ignora; usamos el del token
    } = req.body as {
      firstName: string;
      lastName: string;
      phone?: string;
      branch?: string;
      birthDate?: string;
      emergencyContact?: { name?: string | null; phone?: string | null } | null;
      password?: string;
      enabled?: unknown;
      freeSession?: unknown;
      email?: string;
    };

    if (!firstName || !lastName) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "firstName y lastName son requeridos",
      });
      return;
    }

    // 3) Upsert en Firestore (users/{uid})
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    const nowIso = new Date().toISOString();

    const baseDoc = {
      firstName,
      lastName,
      email: emailFromToken,
      phone,
      branch,
      role: "user" as const,
      isAdmin: false,
      birthDate: birthDate || null,
      emergencyContact: {
        name: emergencyContact?.name ?? null,
        phone: emergencyContact?.phone ?? null,
      },
    };

    if (!snap.exists) {
      // Crear doc inicial con estructuras por defecto
      await userRef.set({
        ...baseDoc,
        isNew: true,
        enabled: true,
        freeSession: false,
        registrationDate: nowIso,
        createdAt: nowIso,
        packages: [],
        transactions: [],
        waitlist: { inList: false, position: null },
        classes: { total: 0, available: 0, taken: 0 },
      });
      // (Opcional) correo de bienvenida
      try {
        await sendWelcomeEmail(emailFromToken, firstName);
      } catch (emailErr) {
        // eslint-disable-next-line no-console
        console.error("No se pudo enviar el correo de bienvenida:", emailErr);
      }
    } else {
      // Actualizar solo campos de perfil
      await userRef.update({
        ...baseDoc,
        updatedAt: nowIso,
      });
    }

    // 4) Si viene password, habilitar login por email+password para ESTE uid
    if (typeof password === "string" && password.trim()) {
      // Firebase valida políticas de contraseña; si no cumple, lanzará error
      await admin.auth().updateUser(uid, { password: password.trim() });
      // Si quieres marcar verificado (normalmente Google ya lo está):
      // await admin.auth().updateUser(uid, { emailVerified: true });
    }

    // 5) Responder con el doc fresco
    const fresh = await userRef.get();
    res.status(200).json({ id: uid, uid, ...fresh.data() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("completeProfileFromAuthController error:", err);

    // Mapear algunos errores comunes de Auth
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message =
      err instanceof Error ? err.message : "Error al completar el perfil";

    if (typeof err === "object" && err && "code" in err) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr.code?.startsWith("auth/")) {
        status = 400;
        code = fbErr.code.toUpperCase().replace(/\//g, "_");
        message = fbErr.message || message;
      }
    }

    res.status(status).json({ error: code, message });
  }
};

export const userController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    branch,
    birthDate,
    emergencyContact,
    enabled = true,
    freeSession = false,
  } = req.body;

  try {
    const userRecord = await admin.auth().createUser({ email, password });

    await admin
      .firestore()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        firstName,
        lastName,
        email,
        phone,
        branch,
        role: "user",
        isAdmin: false,
        isNew: true,
        enabled,
        freeSession,
        birthDate: birthDate ?? null,
        registrationDate: new Date().toISOString(),
        emergencyContact: {
          name: emergencyContact?.name ?? null,
          phone: emergencyContact?.phone ?? null,
        },
        packages: [],
        transactions: [],
        waitlist: { inList: false, position: null },
        classes: { total: 0, available: 0, taken: 0 },
        createdAt: new Date().toISOString(),
      });

    try {
      await sendWelcomeEmail(email, firstName);
    } catch (emailErr) {
      console.error("No se pudo enviar el correo de bienvenida:", emailErr);
    }

    res.status(201).json({
      message: "Usuario registrado correctamente.",
      id: userRecord.uid,
      email: userRecord.email,
    });
  } catch (error) {
    // Detectar error de Firebase Admin
    let status = 500;
    let code = "INTERNAL";
    let message = "Error interno del servidor";

    if (typeof error === "object" && error && "code" in error) {
      const fbErr = error as { code?: string; message?: string };
      if (fbErr.code === "auth/email-already-exists") {
        status = 409;
        code = "EMAIL_ALREADY_EXISTS";
        message = "El correo ya está registrado.";
      } else if (fbErr.message) {
        message = fbErr.message;
      }
    }

    console.error("Error al registrar usuario:", message);
    res.status(status).json({ error: code, message });
  }
};

export const getUsersStatsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const ttlMs = 60_000;
    const nowMs = Date.now();
    // @ts-ignore
    const cached = (global as any).__usersStatsCache as { ts: number; data: any } | undefined;
    if (cached && nowMs - cached.ts < ttlMs) {
      res.status(200).json(cached.data);
      return;
    }

    const db = admin.firestore();

    const now = DateTime.now().setZone("America/Mexico_City");
    const startOfMonth = now.startOf("month").toJSDate().toISOString();
    const endOfMonth = now.endOf("month").toJSDate().toISOString();

    let totalUsers: number | null = null;
    let activeUsers: number | null = null;
    let newThisMonth: number | null = null;

    try {
      const totalAgg = await db.collection("users").where("role", "==", "user").count().get();
      totalUsers = totalAgg.data().count;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FAILED_PRECONDITION")) throw e;
      totalUsers = null;
    }

    try {
      const activeAgg = await db
        .collection("users")
        .where("role", "==", "user")
        .where("enabled", "==", true)
        .count()
        .get();
      activeUsers = activeAgg.data().count;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FAILED_PRECONDITION")) throw e;
      activeUsers = null;
    }

    try {
      const newAgg = await db
        .collection("users")
        .where("role", "==", "user")
        .where("registrationDate", ">=", startOfMonth)
        .where("registrationDate", "<=", endOfMonth)
        .count()
        .get();
      newThisMonth = newAgg.data().count;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FAILED_PRECONDITION")) throw e;
      newThisMonth = null;
    }

    const payload = { totalUsers, newThisMonth, activeUsers };
    // @ts-ignore
    (global as any).__usersStatsCache = { ts: nowMs, data: payload };
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener estadísticas de usuarios", details: String(err) });
  }
};

// Controlador para habilitar usuario
export const enableUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;

  try {
    await admin.firestore().collection("users").doc(userId).update({
      enabled: true,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({ message: "Usuario habilitado correctamente" });
  } catch (error) {
    console.error("Error al habilitar usuario:", error);
    res.status(500).json({ error: "Error interno al habilitar usuario" });
  }
};

// Controlador para deshabilitar usuario
export const disableUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;

  try {
    await admin.firestore().collection("users").doc(userId).update({
      enabled: false,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({ message: "Usuario deshabilitado correctamente" });
  } catch (error) {
    console.error("Error al deshabilitar usuario:", error);
    res.status(500).json({ error: "Error interno al deshabilitar usuario" });
  }
};

export const updateUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const { userId } = req.params;
  const updateData = { ...req.body };

  try {
    delete updateData.role;
    delete updateData.isAdmin;

    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    if (updateData.emergencyContact) {
      const emergency = updateData.emergencyContact;

      if (typeof emergency === "string") {
        updateData.emergencyContact = { name: emergency, phone: null };
      } else if (typeof emergency === "object") {
        updateData.emergencyContact = {
          name: emergency.name ?? null,
          phone: emergency.phone ?? null,
        };
      }
    }

    const db = admin.firestore();
    let userRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData> = db
      .collection("users")
      .doc(userId);
    let userDoc = await userRef.get();

    if (!userDoc.exists) {
      const legacyRaw = String(userId || "").trim();
      const candidates: Array<{ field: string; value: unknown }> = [];
      const num = Number(legacyRaw);
      if (Number.isFinite(num)) {
        candidates.push({ field: "legacyId", value: num });
        candidates.push({ field: "legacyID", value: num });
        candidates.push({ field: "legacy_id", value: num });
      }
      candidates.push({ field: "legacyId", value: legacyRaw });
      candidates.push({ field: "legacyID", value: legacyRaw });
      candidates.push({ field: "legacy_id", value: legacyRaw });

      let found: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
      for (const c of candidates) {
        const snap = await db
          .collection("users")
          .where(c.field, "==", c.value)
          .limit(1)
          .get();
        if (!snap.empty) {
          found = snap.docs[0];
          break;
        }
      }
      if (!found) {
        res.status(404).json({ error: "Usuario no encontrado" });
        return;
      }
      userRef = found.ref;
      userDoc = await userRef.get();
    }

    Object.keys(updateData).forEach((key) => {
      if (
        updateData[key] === undefined ||
        (updateData[key] === null && key !== "emergencyContact")
      ) {
        delete updateData[key];
      }
    });

    if (Object.keys(updateData).length === 0) {
      res.status(200).json({ message: "No hay datos para actualizar" });
      return;
    }

    await userRef.update(updateData);

    res.status(200).json({
      message: "Usuario actualizado correctamente",
      updatedFields: Object.keys(updateData),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al actualizar usuario:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const deleteUserController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;

  try {
    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    await userRef.delete();

    res.status(200).json({
      message: "Usuario eliminado correctamente",
      deletedUserId: userId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al eliminar usuario:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getAllUsersController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const db = admin.firestore();
    const col = db.collection("users");

    const qp = req.query as Record<string, unknown>;
    const pageNum = Number(qp.page ?? 1);
    const limitNum = Number(qp.limit ?? 20);
    const idFilter = typeof qp.id === "string" ? qp.id.trim() : undefined;
    const firstNameFilter = typeof qp.firstName === "string" ? qp.firstName.trim() : (typeof qp.name === "string" ? (qp.name as string).trim() : undefined);
    const lastNameFilter = typeof qp.lastName === "string" ? qp.lastName.trim() : undefined;
    const emailFilter = typeof qp.email === "string" ? qp.email.trim() : undefined;
    const statusFilter = typeof qp.status === "string" ? qp.status.toLowerCase() : undefined; // "active" | "inactive"
    const hasActivePackageFilterRaw = typeof qp.hasActivePackage === "string" ? qp.hasActivePackage.toLowerCase() : undefined; // "true" | "false"
    const hasActivePackageFilter = hasActivePackageFilterRaw === "true" ? true : hasActivePackageFilterRaw === "false" ? false : undefined;
    const startDateRaw = typeof qp.startDate === "string" ? qp.startDate : undefined;
    const endDateRaw = typeof qp.endDate === "string" ? qp.endDate : undefined;

    const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
    const limit = Number.isFinite(limitNum) && limitNum > 0 ? limitNum : 20;

    const toStartISO = (s: string | undefined): string | undefined => {
      if (!s) return undefined;
      const dt = DateTime.fromISO(s);
      if (!dt.isValid) return undefined;
      return dt.toUTC().toISO();
    };
    const toEndISO = (s: string | undefined): string | undefined => {
      if (!s) return undefined;
      const dt = DateTime.fromISO(s).endOf("day");
      if (!dt.isValid) return undefined;
      return dt.toUTC().toISO();
    };

    const startISO = toStartISO(startDateRaw);
    const endISO = toEndISO(endDateRaw);

    const normalize = (v: unknown): string => String(v ?? "").toLowerCase();
    const contains = (src: unknown, q: string | undefined): boolean => {
      if (!q) return true;
      return normalize(src).includes(q.toLowerCase());
    };
    const hasActivePkg = (u: any): boolean => {
      const pkgs: any[] = Array.isArray(u.packages) ? u.packages : [];
      const now = new Date();
      return pkgs.some((p) => {
        const active = p?.active === true;
        const exp = p?.expiresAt ? new Date(p.expiresAt) : null;
        const notExpired = !exp || exp > now;
        return active && notExpired;
      });
    };

    let docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    let indexFallback = false;

    if (idFilter) {
      const snap = await col.doc(idFilter).get();
      if (snap.exists) {
        docs = [snap as FirebaseFirestore.QueryDocumentSnapshot];
      } else {
        docs = [];
      }
    } else {
      try {
        let q: FirebaseFirestore.Query = col.where("role", "==", "user");
        if (statusFilter === "active") q = q.where("enabled", "==", true);
        if (statusFilter === "inactive") q = q.where("enabled", "==", false);

        if (startISO || endISO) {
          if (startISO) q = q.where("registrationDate", ">=", startISO);
          if (endISO) q = q.where("registrationDate", "<=", endISO);
          q = q.orderBy("registrationDate", "desc");
        } else {
          q = q.orderBy("createdAt", "desc");
        }

        const snap = await q.get();
        docs = snap.docs;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("FAILED_PRECONDITION")) {
          indexFallback = true;
          const snap2 = await col.orderBy("createdAt", "desc").get();
          docs = snap2.docs;
        } else {
          throw e;
        }
      }
    }

    const allUsers = docs.map((d) => ({ id: d.id, ...d.data() }));
    const filtered = allUsers.filter((u: any) => {
      if (firstNameFilter && !contains(u.firstName, firstNameFilter)) return false;
      if (lastNameFilter && !contains(u.lastName, lastNameFilter)) return false;
      if (emailFilter && !contains(u.email, emailFilter)) return false;
      if (typeof hasActivePackageFilter === "boolean" && hasActivePkg(u) !== hasActivePackageFilter) return false;
      if (!idFilter && statusFilter === "active" && u.enabled !== true) return false;
      if (!idFilter && statusFilter === "inactive" && u.enabled !== false) return false;
      if (indexFallback && (startISO || endISO)) {
        const reg = u.registrationDate;
        if (startISO && (!reg || String(reg) < startISO)) return false;
        if (endISO && (!reg || String(reg) > endISO)) return false;
      }
      return true;
    });

    const toLegacyNum = (u: any): number => {
      const raw = (u?.legacyId ?? u?.legacyID ?? u?.legacy_id);
      const n = Number(raw);
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };
    const sorted = [...filtered].sort((a, b) => toLegacyNum(a) - toLegacyNum(b));
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);
    const startIdx = (currentPage - 1) * limit;
    const usersPage = sorted.slice(startIdx, startIdx + limit);

    const branchIds = Array.from(
      new Set(
        usersPage
          .map((u: any) => (typeof u.branch === "string" ? u.branch : String(u.branch || "")))
          .filter((id) => !!id)
      )
    );

    let branchNameMap: Record<string, string> = {};
    if (branchIds.length > 0) {
      const BATCH = 10;
      for (let i = 0; i < branchIds.length; i += BATCH) {
        const chunk = branchIds.slice(i, i + BATCH);
        const snap = await db
          .collection("branches")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string };
          branchNameMap[d.id] = String(data?.name || "");
        });
      }
    }

    const usersWithBranchName = usersPage.map((u: any) => {
      const bid = typeof u.branch === "string" ? u.branch : String(u.branch || "");
      const branchName = bid ? branchNameMap[bid] ?? null : null;
      return { ...u, branchName };
    });

    res.status(200).json({ users: usersWithBranchName, total, totalPages, page: currentPage, indexFallback });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error fetching users:", msg);
    res.status(500).json({ error: "Internal server error", details: msg });
  }
};

export const getRecentUsersController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const col = admin.firestore().collection("users");
    try {
      const snap = await col
        .where("role", "==", "user")
        .orderBy("registrationDate", "desc")
        .limit(8)
        .get();
      const users = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.status(200).json({ users, total: users.length });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FAILED_PRECONDITION")) throw e;
      // Fallback sin índice compuesto: ordenar y filtrar en memoria sobre un rango pequeño
      const snap2 = await col.orderBy("registrationDate", "desc").limit(40).get();
      const candidates = snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
      const users = candidates.filter((u: any) => (u.role || "").toLowerCase() === "user").slice(0, 8);
      res.status(200).json({ users, total: users.length, indexFallback: true });
      return;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener últimos usuarios:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getUserByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    let userId: string;

    // Si es la ruta /me, obtener el UID del token
    if (req.path === '/me' || req.originalUrl.includes('/me')) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Token no proporcionado" });
        return;
      }

      const idToken = authHeader.slice(7);
      const decoded = await admin.auth().verifyIdToken(idToken);
      userId = decoded.uid;
    } else {
      // Si es la ruta /:userId, usar el parámetro
      userId = req.params.userId;
    }

    // Buscar en users, staff e instructors (como en loginController)
    const db = admin.firestore();
    const [userDoc, staffDoc, instrDoc] = await Promise.all([
      db.collection("users").doc(userId).get(),
      db.collection("staff").doc(userId).get(),
      db.collection("instructors").doc(userId).get(),
    ]);

    let doc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
    let collection: "users" | "staff" | "instructors" | null = null;

    if (userDoc.exists) {
      collection = "users";
      doc = userDoc;
    } else if (staffDoc.exists) {
      collection = "staff";
      doc = staffDoc;
    } else if (instrDoc.exists) {
      collection = "instructors";
      doc = instrDoc;
    }

    // Fallback: si no existe por documentId, intentar resolver por legacyId
    if (!doc) {
      const legacyRaw = String(userId || "").trim();
      const candidates: Array<{ field: string; value: unknown }> = [];
      const num = Number(legacyRaw);
      if (Number.isFinite(num)) {
        candidates.push({ field: "legacyId", value: num });
        candidates.push({ field: "legacyID", value: num });
        candidates.push({ field: "legacy_id", value: num });
      }
      candidates.push({ field: "legacyId", value: legacyRaw });
      candidates.push({ field: "legacyID", value: legacyRaw });
      candidates.push({ field: "legacy_id", value: legacyRaw });

      let found: FirebaseFirestore.QuerySnapshot | null = null;
      for (const c of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await db
          .collection("users")
          .where(c.field, "==", c.value)
          .limit(1)
          .get();
        if (!snap.empty) {
          found = snap;
          break;
        }
      }
      if (found && !found.empty) {
        doc = found.docs[0];
        collection = "users";
      }
    }

    if (!doc || !doc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const data = doc.data() || {};
    const role = (data.role as string)?.toLowerCase() || "";

    // Normalizar branches y permissions para employees y admins
    let normalizedBranches: string[] = [];
    let normalizedPermissions: Record<string, string[]> = {};

    if (role === "employee" || role === "admin") {
      // Normalizar branches
      if (Array.isArray(data.branches)) {
        normalizedBranches = data.branches.filter((b: unknown) => typeof b === "string");
      } else if (typeof data.branch === "string") {
        normalizedBranches = [data.branch];
      }

      // Normalizar permissions
      if (data.permissions && typeof data.permissions === "object" && !Array.isArray(data.permissions)) {
        normalizedPermissions = Object.fromEntries(
          Object.entries(data.permissions).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.filter((x: unknown) => typeof x === "string") : [],
          ])
        );
      }

      // Para admins, branches debe ser array vacío
      if (role === "admin") {
        normalizedBranches = [];
      }

      // Construir respuesta con datos normalizados
      const { password: _omit, ...safeData } = data;
      res.status(200).json({
        id: doc.id,
        ...safeData,
        role,
        branches: normalizedBranches,
        permissions: normalizedPermissions,
      });
    } else {
      // Para usuarios regulares (no employees ni admins), devolver datos tal cual
      const { password: _omit, ...safeData } = data;
      let txDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
      let resDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
      try {
        const [txSnap, rSnap] = await Promise.all([
          db
            .collection("transactions")
            .where("userId", "==", doc.id)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get(),
          db
            .collection("reservations")
            .where("userId", "==", doc.id)
            .orderBy("createdAt", "desc")
            .limit(50)
            .get(),
        ]);
        txDocs = txSnap.docs;
        resDocs = rSnap.docs;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("FAILED_PRECONDITION")) {
          const [txSnap2, rSnap2] = await Promise.all([
            db
              .collection("transactions")
              .where("userId", "==", doc.id)
              .limit(50)
              .get(),
            db
              .collection("reservations")
              .where("userId", "==", doc.id)
              .limit(50)
              .get(),
          ]);
          txDocs = txSnap2.docs;
          resDocs = rSnap2.docs;
        } else {
          throw e;
        }
      }

      const transactions = txDocs.map((d) => ({ id: d.id, ...d.data() }));
      const reservations = resDocs.map((d) => ({ id: d.id, ...d.data() }));

      res.status(200).json({ id: doc.id, ...safeData, transactions, reservations });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener usuario:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const adminResetPasswordController = async (
  req: Request,
  res: Response
): Promise<void> => {
  // helpers locales para leer código/mensaje sin usar `any`
  const getErrorCode = (e: unknown): string | undefined => {
    if (typeof e === "object" && e !== null && "code" in e) {
      const { code } = e as { code?: unknown };
      return typeof code === "string" ? code : undefined;
    }
    return undefined;
  };

  const getErrorMessage = (e: unknown): string | undefined => {
    if (typeof e === "object" && e !== null && "message" in e) {
      const { message } = e as { message?: unknown };
      return typeof message === "string" ? message : undefined;
    }
    return undefined;
  };

  try {
    const { userId } = req.params;
    const { newPassword } = req.body as { newPassword?: string };

    // Validaciones mínimas
    if (!userId) {
      res.status(400).json({
        error: "USER_ID_REQUIRED",
        message: "Falta userId en la ruta",
      });
      return;
    }

    if (!newPassword || typeof newPassword !== "string") {
      res.status(400).json({
        error: "PASSWORD_REQUIRED",
        message: "La nueva contraseña es requerida",
      });
      return;
    }

    if (newPassword.trim().length < 8) {
      res.status(400).json({
        error: "WEAK_PASSWORD",
        message: "La contraseña debe tener al menos 8 caracteres",
      });
      return;
    }

    const db = admin.firestore();
    let targetUid = userId.trim();
    let userDoc = await db.collection("users").doc(targetUid).get();
    if (!userDoc.exists) {
      const legacyRaw = String(userId || "").trim();
      const candidates: Array<{ field: string; value: unknown }> = [];
      const num = Number(legacyRaw);
      if (Number.isFinite(num)) {
        candidates.push({ field: "legacyId", value: num });
        candidates.push({ field: "legacyID", value: num });
        candidates.push({ field: "legacy_id", value: num });
      }
      candidates.push({ field: "legacyId", value: legacyRaw });
      candidates.push({ field: "legacyID", value: legacyRaw });
      candidates.push({ field: "legacy_id", value: legacyRaw });

      let found: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
      for (const c of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await db
          .collection("users")
          .where(c.field, "==", c.value)
          .limit(1)
          .get();
        if (!snap.empty) {
          found = snap.docs[0];
          break;
        }
      }
      if (!found) {
        res.status(404).json({ error: "USER_NOT_FOUND", message: "Usuario no encontrado" });
        return;
      }
      targetUid = found.id;
      userDoc = await db.collection("users").doc(targetUid).get();
    }

    await admin.auth().updateUser(targetUid, { password: newPassword.trim() });
    await admin.auth().revokeRefreshTokens(targetUid);
    await db.collection("users").doc(targetUid).update({ updatedAt: new Date().toISOString() });

    res
      .status(200)
      .json({ message: "Contraseña actualizada y sesiones revocadas" });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error("adminResetPasswordController error:", err);

    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "No se pudo actualizar la contraseña";

    const fbCode = getErrorCode(err);
    const fbMsg = getErrorMessage(err);

    if (fbCode === "auth/user-not-found") {
      status = 404;
      code = "USER_NOT_FOUND";
      message = "Usuario no encontrado en Auth";
    } else if (typeof fbCode === "string" && fbCode.startsWith("auth/")) {
      status = 400;
      code = fbCode.toUpperCase().replace(/\//g, "_");
      message = fbMsg ?? message;
    } else if (fbMsg) {
      message = fbMsg;
    }

    res.status(status).json({ error: code, message });
  }
};
