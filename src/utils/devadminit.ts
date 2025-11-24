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
    console.log("Verificando/creando administrador personal en Auth y Firestore...");

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(PERSONAL_ADMIN.email);
      console.log("Administrador personal encontrado en Firebase Auth.");
    } catch {
      userRecord = await admin.auth().createUser({
        email: PERSONAL_ADMIN.email,
        password: PERSONAL_ADMIN.password,
      });
      console.log("Administrador personal creado en Firebase Auth.");
    }

    await admin.auth().updateUser(userRecord.uid, {
      password: PERSONAL_ADMIN.password,
      emailVerified: true,
    });

    const hashedPassword = await bcrypt.hash(PERSONAL_ADMIN.password, 10);
    const userRef = admin.firestore().collection("users").doc(userRecord.uid);
    const snap = await userRef.get();
    const now = new Date().toISOString();
    const data = {
      ...PERSONAL_ADMIN,
      password: hashedPassword,
      createdAt: snap.exists ? snap.data()?.createdAt ?? now : now,
      updatedAt: now,
    };
    await userRef.set(data, { merge: true });
    console.log("✅ Administrador personal verificado/creado.");
  } catch (error) {
    console.error("❌ Error al crear administrador personal:", error);
    throw error;
  }
};
