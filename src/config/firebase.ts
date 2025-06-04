import admin from 'firebase-admin';
import serviceAccount from './pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json'; 

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

export default admin;
