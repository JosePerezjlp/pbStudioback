import bcrypt from "bcrypt";
import admin from "../config/firebase";

const DEFAULT_ADMIN = {
  email: "admintemporal@pbstudioapp.com",
  password: "Temporal2025*",
  firstName: "Admin",
  lastName: "Temporal",
  role: "admin",
  isAdmin: true,
  phone: "0000000000",
  branch: "Principal",
  permissions: { superuser: true },
};

export const initializeDefaultAdmin = async () => {
  try {
    console.log("Verificando si ya existe el administrador por defecto...");

    // Buscar si ya existe en Firestore ese email
    const existingDoc = await admin
      .firestore()
      .collection("users")
      .where("email", "==", DEFAULT_ADMIN.email)
      .limit(1)
      .get();

    if (!existingDoc.empty) {
      console.log("Ya existe el administrador por defecto en Firestore.");
      return;
    }

    // Crear o recuperar el usuario en Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: DEFAULT_ADMIN.email,
        password: DEFAULT_ADMIN.password,
      });
      console.log("Administrador creado en Firebase Auth.");
    } catch (error) {
			console.log("TCL: initializeDefaultAdmin -> error", error)
      userRecord = await admin.auth().getUserByEmail(DEFAULT_ADMIN.email);
      console.log("Administrador ya existía en Firebase Auth.");
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, 10);

    // Guardar el usuario en Firestore
    await admin
      .firestore()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        ...DEFAULT_ADMIN,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    console.log("✅ Administrador por defecto creado exitosamente en Firestore.");
  } catch (error) {
    console.error("❌ Error al crear administrador por defecto:", error);
    throw error;
  }
};
