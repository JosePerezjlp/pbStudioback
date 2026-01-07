import admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

// Usamos 'any' para evitar depender de tipos internos de firebase-admin
let bucketInstance: any | null = null;

function getBucket(): any {
  if (bucketInstance) return bucketInstance;

  const credentialsJson = process.env.FIREBASE_CREDENTIALS_JSON;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!credentialsJson || !storageBucket) {
    throw new Error("Firebase Storage no está configurado (FIREBASE_CREDENTIALS_JSON / FIREBASE_STORAGE_BUCKET)");
  }

  const serviceAccount = JSON.parse(credentialsJson);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      storageBucket,
    });
  }

  bucketInstance = admin.storage().bucket();
  return bucketInstance;
}

export async function uploadToFirebaseStorage(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  const bucket = getBucket();

  const fileName = `${folder}/${Date.now()}-${file.originalname}`;
  const fileRef = bucket.file(fileName);
  const downloadToken = uuidv4();

  await fileRef.save(file.buffer, {
    contentType: file.mimetype,
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
    } as any,
    resumable: false,
  });

  const encodedPath = encodeURIComponent(fileName);
  const bucketName = bucket.name;

  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;
}
