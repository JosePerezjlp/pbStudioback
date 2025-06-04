import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(process.cwd(), 'src', 'config', 'pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json');
console.log('Ruta del archivo de credenciales:', serviceAccountPath);

try {
  const serviceAccount = JSON.parse(
    readFileSync(serviceAccountPath, 'utf8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
      storageBucket: `${serviceAccount.project_id}.appspot.com`
    });
    console.log('Firebase Admin inicializado correctamente');
  }
} catch (error) {
  console.error('Error al cargar las credenciales:', error);
  throw error;
}

export default admin;
