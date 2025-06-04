import bcrypt from 'bcrypt';
import admin from '../config/firebase';

const DEFAULT_ADMIN = {
  email: 'admintemporal@pbstudioapp.com',
  password: 'Temporal2025*',
  firstName: 'Admin',
  lastName: 'Temporal',
  role: 'admin',
  isAdmin: true,
  phone: '0000000000',
  branch: 'Principal'
};

export const initializeDefaultAdmin = async () => {
  try {
    console.log('Verificando administrador por defecto...');
    
    // Buscar si existe algún usuario con rol admin
    const adminQuery = await admin.firestore()
      .collection('users')
      .where('role', '==', 'admin')
      .limit(1)
      .get();

    if (!adminQuery.empty) {
      console.log('Ya existe un administrador en el sistema.');
      return;
    }

    // Crear usuario en Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: DEFAULT_ADMIN.email,
        password: DEFAULT_ADMIN.password
      });
    } catch {
      // Si el usuario ya existe en Auth, obtenerlo
      userRecord = await admin.auth().getUserByEmail(DEFAULT_ADMIN.email);
    }

    // Hashear la contraseña para almacenar en Firestore
    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, 10);

    // Crear el documento del usuario en Firestore
    await admin.firestore()
      .collection('users')
      .doc(userRecord.uid)
      .set({
        ...DEFAULT_ADMIN,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

    console.log('Administrador por defecto creado exitosamente.');
  } catch (error) {
    console.error('Error al crear administrador por defecto:', error);
    throw error;
  }
}; 