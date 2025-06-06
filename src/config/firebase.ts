import admin, { ServiceAccount } from "firebase-admin";
import { readFileSync } from "fs";
import { join } from "path";

let serviceAccount: ServiceAccount;

try {
  if (process.env.FIREBASE_CREDENTIALS_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON) as ServiceAccount;
    console.log("Cargando credenciales desde variable de entorno");
  } else {
    const serviceAccountPath = join(process.cwd(), "src", "config", "pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json");
    console.log("Cargando credenciales desde archivo local:", serviceAccountPath);
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8")) as ServiceAccount;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.projectId,
      databaseURL: `https://${serviceAccount.projectId}.firebaseio.com`,
      storageBucket: `${serviceAccount.projectId}.appspot.com`,
    });
    console.log("Firebase Admin inicializado correctamente");
  }
} catch (error) {
  console.error("❌ Error al cargar las credenciales de Firebase:", error);
  throw error;
}

export default admin;
