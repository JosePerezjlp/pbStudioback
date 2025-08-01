// initializePersonalAdmin.ts
import bcrypt from "bcrypt";
import admin from "../config/firebase";

const PERSONAL_ADMIN = {
  email: "johandevadmin@pbstudioapp.com",
  password: "JohanDev2025*",
  firstName: "Johan",
  lastName: "Cortes",
  role: "admin",
  isAdmin: true,
  phone: "1111111111",
  branch: "Desarrollo",
  permissions: { superuser: true },
};

export const initializePersonalAdmin = async () => {
  try {
    console.log("Verificando administrador personal...");

    // Verificar si ya existe en Firestore por email
    const existingDoc = await admin
      .firestore()
      .collection("users")
      .where("email", "==", PERSONAL_ADMIN.email)
      .limit(1)
      .get();

    if (!existingDoc.empty) {
      console.log("Ya existe el administrador personal en Firestore.");
      return;
    }

    // Crear usuario en Auth o recuperar existente
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: PERSONAL_ADMIN.email,
        password: PERSONAL_ADMIN.password,
      });
    } catch {
      userRecord = await admin.auth().getUserByEmail(PERSONAL_ADMIN.email);
    }

    // Hashear contraseña antes de guardar en Firestore
    const hashedPassword = await bcrypt.hash(PERSONAL_ADMIN.password, 10);

    // Crear documento en Firestore
    await admin
      .firestore()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        ...PERSONAL_ADMIN,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    console.log("✅ Administrador personal creado exitosamente.");
  } catch (error) {
    console.error("❌ Error al crear administrador personal:", error);
    throw error;
  }
};
