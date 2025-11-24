// Script para importar datos JSON a Firestore por colección
// Uso: node importToFirestore.js <nombre_coleccion> <ruta_al_json>

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Ajusta la ruta a tu archivo de inicialización si es necesario
const { db } = require("./src/config/firebase");

if (process.argv.length < 4) {
  console.error(
    "Uso: node importToFirestore.js <nombre_coleccion> <ruta_al_json>"
  );
  process.exit(1);
}

const collectionName = process.argv[2];
const jsonPath = process.argv[3];

if (!fs.existsSync(jsonPath)) {
  console.error("Archivo JSON no encontrado:", jsonPath);
  process.exit(1);
}

const rawData = fs.readFileSync(jsonPath);
let data;
try {
  data = JSON.parse(rawData);
} catch (e) {
  console.error("Error al parsear el JSON:", e.message);
  process.exit(1);
}

if (!Array.isArray(data)) {
  console.error("El archivo JSON debe contener un array de objetos.");
  process.exit(1);
}

async function importBatch(batchData, batchNum) {
  const batch = db.batch();
  batchData.forEach((doc) => {
    // Si el objeto tiene un campo 'id', lo usamos como ID del documento
    const docRef = doc.id
      ? db.collection(collectionName).doc(String(doc.id))
      : db.collection(collectionName).doc();
    const docCopy = { ...doc };
    delete docCopy.id; // No duplicar el campo id
    batch.set(docRef, docCopy);
  });
  await batch.commit();
  console.log(`Batch ${batchNum} importado: ${batchData.length} documentos.`);
}

async function main() {
  const BATCH_SIZE = 500;
  let batchNum = 1;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batchData = data.slice(i, i + BATCH_SIZE);
    await importBatch(batchData, batchNum);
    batchNum++;
  }
  console.log("Importación completada.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error en la importación:", err);
  process.exit(1);
});
