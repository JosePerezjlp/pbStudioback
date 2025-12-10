// import { Request, Response } from "express";
// import admin from "../config/firebase";
// import { GympassService } from "../services/gympass.service";
// import { CreateSlotRequest } from "../models/CreateSlotRequest";
// import { ClassPayload } from "../models/ClassPayload";

// /* ============================================================
//    GET – productos por gym
//    ============================================================ */
// export const getProductsController = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   const { gymId } = req.params;

//   try {
//     const products = await GympassService.getProducts(Number(gymId));
//     res.status(200).json(products);
//   } catch (error) {
//     const msg = error instanceof Error ? error.message : "Error desconocido";
//     console.error("❌ Error al obtener productos:", msg);
//     res.status(500).json({ error: msg });
//   }
// };

// /* ============================================================
//    GET – clases por gym
//    ============================================================ */
// export const getClassesController = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   const { gymId } = req.params;

//   try {
//     const classes = await GympassService.getClass(Number(gymId));
//     res.status(200).json(classes);
//   } catch (error) {
//     const msg = error instanceof Error ? error.message : "Error desconocido";
//     console.error("❌ Error al obtener clases:", msg);
//     res.status(500).json({ error: msg });
//   }
// };

// /* ============================================================
//    POST – crear slot en una clase
//    ============================================================ */
// export const createSlotController = async (
//   req: Request<
//     {
//       gymId: string;
//       classId: string;
//     },
//     object,
//     CreateSlotRequest
//   >,
//   res: Response
// ): Promise<void> => {
//   const { gymId, classId } = req.params;
//   const branchData = await GympassService.getBranchData(gymId);
//   const gympassGymId = branchData?.gympass_gym_id;
//   const payload: CreateSlotRequest = req.body;
//   try {
//     const slot = await GympassService.createClass(
//       Number(gympassGymId),
//       Number(classId),
//       payload
//     );
//     res.status(201).json(slot);
//   } catch (error) {
//     const msg = error instanceof Error ? error.message : "Error desconocido";
//     console.error("❌ Error al crear slot:", msg);
//     res.status(500).json({ error: msg });
//   }
// };

// /* ============================================================
//    POST – crear categoría (clase)
//    ============================================================ */
// export const createCategoryController = async (
//   req: Request<{ gymId: string }, object, ClassPayload>,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { gymId } = req.params;
//     const branchData = await GympassService.getBranchData(gymId);
//     const gympassGymId = branchData?.gympass_gym_id;
//     const payload = {
//       classes: [req.body],
//     };
//     const category = await GympassService.createCategory(
//       Number(gympassGymId),
//       payload
//     );
//     res.status(201).json(category);
//   } catch (error) {
//     const msg = error instanceof Error ? error.message : "Error desconocido";
//     console.error("❌ Error al crear categoría:", error);
//     res.status(500).json({ error: msg });
//   }
// };

// /* ============================================================
//    GET –  check-in
//    ============================================================ */
// export const getUserChecking = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   const { userId } = req.params;
//   try {
//     const userDoc = await admin
//       .firestore()
//       .collection("users")
//       .doc(userId)
//       .get();
//     if (!userDoc.exists) {
//       res.status(404).json({ error: "Usuario no encontrado" });
//       return;
//     }
//     const gympass = userDoc.data()?.gympass;
//     const gymId = gympass?.gym_id;
//     const checkingWellhub = await GympassService.simulateChecking(
//       { gympass_user_id: gympass?.user_id, product_id: gympass?.product_id },
//       gymId
//     );
//     res.status(200).json({ checkingWellhub });
//   } catch (error) {
//     const msg = error instanceof Error ? error.message : "Error desconocido";
//     console.error("Error al obtener usuario por ID:", msg);
//     res.status(500).json({ error: "Error interno del servidor", details: msg });
//   }
// };
// /* ============================================================
//    POST – webhook de check-in de Gympass
//    ============================================================ */

// export const wellhubWebhookController = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const signature = (req.headers["x-gympass-signature"] ||
//       req.headers["X-Gympass-Signature"]) as string | undefined;
//     const event = req.body;

//     // 1️⃣ Verificar firma (implementar validación real si aplica)
//     if (!signature) {
//       res.status(400).json({ error: "Falta la firma de Wellhub" });
//       return;
//     }
//     const { event_type: eventType, event_data: eventData } = event;
//     if (eventType !== "checkin") {
//       res.status(400).json({ error: "Evento no soportado" });
//       return;
//     }

//     const db = admin.firestore();
//     const userPayload = eventData?.user;
//     const gymPayload = eventData?.gym;

//     if (
//       !userPayload?.unique_token ||
//       !userPayload?.email ||
//       !gymPayload?.id ||
//       !gymPayload?.product?.id
//     ) {
//       res.status(400).json({ error: "Faltan datos obligatorios del check-in" });
//       return;
//     }

//     const uniqueToken: string = userPayload.unique_token;
//     const gymId: number = gymPayload.id;
//     const productId: number = gymPayload.product.id;
//     const { email } = userPayload;
//     const phoneRaw: string | undefined = userPayload.phone_number;

//     // Usar phone_number como contraseña: validar que exista y cumpla con mínimo de Firebase
//     if (!phoneRaw || typeof phoneRaw !== "string") {
//       res
//         .status(400)
//         .json({ error: "Falta phone_number para usar como contraseña" });
//       return;
//     }
//     const password = phoneRaw.trim();

//     if (password.length < 6) {
//       res.status(400).json({
//         error: "WEAK_PASSWORD",
//         message:
//           "El phone_number debe tener al menos 6 caracteres para usarse como contraseña",
//       });
//       return;
//     }

//     // 2️⃣ Verificar si ya existe usuario en Firestore con ese uniqueToken
//     const existingUserSnap = await db
//       .collection("users")
//       .where("gympass.user_id", "==", uniqueToken)
//       .limit(1)
//       .get();
//     console.log(existingUserSnap);

//     if (!existingUserSnap.empty) {
//       res.status(409).json({ error: "Usuario ya existe" });
//       return;
//     }

//     // 3️⃣ Crear usuario en Firebase Auth usando el email y phone como password
//     const userRecord = await admin.auth().createUser({
//       email,
//       password,
//     });

//     // 4️⃣ Guardar en Firestore (siguiendo la estructura de userController)
//     const now = new Date().toISOString();
//     await db
//       .collection("users")
//       .doc(userRecord.uid)
//       .set({
//         firstName: userPayload.first_name ?? null,
//         lastName: userPayload.last_name ?? null,
//         email,
//         phone: phoneRaw ?? null,
//         branch: null,
//         role: "user",
//         isAdmin: false,
//         isNew: true,
//         enabled: true,
//         freeSession: false,
//         birthDate: null,
//         registrationDate: now,
//         emergencyContact: { name: null, phone: null },
//         packages: [],
//         transactions: [],
//         waitlist: { inList: false, position: null },
//         classes: { total: 0, available: 0, taken: 0 },
//         createdAt: now,
//         gympass: {
//           gym_id: gymId,
//           product_id: productId,
//           user_id: uniqueToken,
//         },
//       });
//     res.status(201).json({
//       message: "Usuario creado con check-in",
//       id: userRecord.uid,
//       email: userRecord.email,
//     });
//   } catch (error) {
//     // Manejo de errores específico para Firebase Admin
//     let status = 500;
//     let code = "INTERNAL";
//     let message = "Error interno del servidor";

//     if (typeof error === "object" && error && "code" in error) {
//       const fbErr = error as { code?: string; message?: string };
//       if (fbErr.code === "auth/email-already-exists") {
//         status = 409;
//         code = "EMAIL_ALREADY_EXISTS";
//         message = "El correo ya está registrado.";
//       } else if (fbErr.code === "auth/invalid-password") {
//         status = 400;
//         code = "INVALID_PASSWORD";
//         message =
//           "La contraseña proporcionada no cumple las políticas de Auth.";
//       } else if (fbErr.message) {
//         message = fbErr.message;
//       }
//     } else if (error instanceof Error) {
//       message = error.message;
//     }

//     console.error("❌ Error al procesar webhook:", message);
//     res.status(status).json({ error: code, message });
//   }
// };

// /* ============================================================
//    PATCH – actualizar reserva (booking)
//    ============================================================ */
// // 🔹 Busca clase a partir de un id (puede ser de reserva o clase)

// // 🔹 Controlador principal
// export const updateBookingController = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   const { classId } = req.params;
//   const payload = req.body;

//   try {
//     const { clasesDoc, gymId } =
//       await GympassService.findClassAndBranch(classId);

//     const branchData = await GympassService.getBranchData(gymId);

//     const gympassGymId = branchData?.gympass_gym_id;
//     const gympassClassId = clasesDoc.data()?.gympass.class_id;
//     const gympassSlotId = clasesDoc.data()?.gympass.slot_id;

//     const bookingRequest = GympassService.buildBookingRequest(
//       clasesDoc,
//       payload.status
//     );

//     const updatedBooking = await GympassService.updateBooking(
//       gympassGymId,
//       gympassClassId,
//       gympassSlotId,
//       bookingRequest
//     );

//     res.status(200).json(updatedBooking);
//   } catch (error) {
//     const msg = error instanceof Error ? error.message : "Error desconocido";
//     console.error("❌ Error al actualizar booking:", msg);
//     res.status(500).json({ error: msg });
//   }
// };
