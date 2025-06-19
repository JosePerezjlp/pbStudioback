// utils/uploadToFirebase.ts
import { v4 as uuidv4 } from "uuid";
import { getStorage } from "firebase-admin/storage";
import admin from "../config/firebase";

// Obtener bucket desde la instancia ya inicializada
const bucket = getStorage(admin.app()).bucket();

// ✅ Subida al bucket de Firebase, con ruta personalizada
export const uploadToFirebase = async (
  file: Express.Multer.File,
  pathPrefix = "home"
) => {
  const fileName = `${pathPrefix}/${uuidv4()}-${file.originalname}`;
  const fileRef = bucket.file(fileName);

  await fileRef.save(file.buffer, {
    metadata: {
      contentType: file.mimetype,
      firebaseStorageDownloadTokens: uuidv4(),
    },
    public: true,
  });

  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
};
