import admin from "../config/firebase";

async function main() {
  try {
    const db = admin.firestore();

    console.log("--- DEBUGGING CLASSES ---");
    console.error("--- DEBUGGING CLASSES (STDERR) ---");

    // 1. Get oldest 5 classes by 'day'
    console.log("Querying oldest classes by 'day'...");
    try {
      const snapshotDay = await db
        .collection("classes")
        .orderBy("day", "asc")
        .limit(5)
        .get();

      if (snapshotDay.empty) {
        console.log("No classes found ordered by 'day'.");
      } else {
        console.log("Oldest classes by 'day':");
        snapshotDay.docs.forEach((doc) => {
          const d = doc.data();
          console.log(
            `ID: ${doc.id} | Day: ${d.day} (${typeof d.day}) | CreatedAt: ${d.createdAt}`
          );
        });
      }
    } catch (e) {
      console.error("Error querying by day:", e);
    }

    // 2. Check for classes with day < "2025-11-20" explicitly
    console.log("\nChecking for classes older than 2025-11-20...");
    const cutoff = "2025-11-20";
    const oldSnap = await db
      .collection("classes")
      .where("day", "<", cutoff)
      .limit(5)
      .get();

    if (oldSnap.empty) {
      console.log(`No classes found with day < ${cutoff}`);
    } else {
      console.log(`Found classes older than ${cutoff}:`);
      oldSnap.docs.forEach((doc) => {
        const d = doc.data();
        console.log(`ID: ${doc.id} | Day: ${d.day}`);
      });
    }
  } catch (error) {
    console.error("Global Error:", error);
  }
}

main();
