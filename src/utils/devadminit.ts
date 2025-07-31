// initializePersonalAdmin.ts
import bcrypt from 'bcrypt';
import admin from '../config/firebase';

const PERSONAL_ADMIN = {
  email: 'johandevadmin@pbstudioapp.com',
  password: 'JohanDev2025*',
  firstName: 'Johan',
  lastName: 'Cortes',
  role: 'admin',
  isAdmin: true,
  phone: '1111111111',
  branch: 'Desarrollo',
  permissions: { superuser: true },
};

export const initializePersonalAdmin = async () => {
  try {
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: PERSONAL_ADMIN.email,
        password: PERSONAL_ADMIN.password
      });
    } catch {
      userRecord = await admin.auth().getUserByEmail(PERSONAL_ADMIN.email);
    }

    const hashedPassword = await bcrypt.hash(PERSONAL_ADMIN.password, 10);

    await admin.firestore()
      .collection('users')
      .doc(userRecord.uid)
      .set({
        ...PERSONAL_ADMIN,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

    console.log('Administrador de desarrollo creado exitosamente.');
  } catch (error) {
    console.error('Error al crear administrador de desarrollo:', error);
  }
};
