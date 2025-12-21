import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

// Ensure directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const uploadLocal = async (
  file: Express.Multer.File,
  subDir = 'misc'
): Promise<string> => {
  const targetDir = path.join(UPLOADS_DIR, subDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const fileName = `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const filePath = path.join(targetDir, fileName);

  await fs.promises.writeFile(filePath, file.buffer);

  // Return relative URL (assuming /uploads is mounted)
  return `/uploads/${subDir}/${fileName}`;
};

export const deleteLocalFile = async (fileUrl: string): Promise<void> => {
    try {
        // fileUrl ex: /uploads/misc/filename.jpg
        // We need to map it back to filesystem
        if (!fileUrl.startsWith('/uploads')) return; // Not a local file

        // Remove leading slash to join correctly
        const relativePath = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
        const fullPath = path.join(PUBLIC_DIR, relativePath);

        if (fs.existsSync(fullPath)) {
            await fs.promises.unlink(fullPath);
            console.log("✅ Archivo eliminado localmente:", fullPath);
        }
    } catch (error) {
        console.warn("⚠️ No se pudo eliminar el archivo local:", fileUrl, error);
    }
}
