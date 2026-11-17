import { auth, db } from "./firebase-config.js";
import {
  addDoc,
  collection,
  getDoc,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

async function testFirestore() {
  const user = auth.currentUser;

  if (!user) {
    console.error("Please log in before testing Firestore.");
    return;
  }

  let testRef;

  try {
    testRef = await addDoc(
      collection(db, "EmergencyContacts"),
      {
        userId: user.uid,
        contactName: "Firestore Test",
        relationship: "Test",
        phoneNumber: "0000000000",
        priority: "Secondary"
      }
    );

    console.log("WRITE SUCCESS:", testRef.id);

    const result = await getDoc(
      doc(db, "EmergencyContacts", testRef.id)
    );

    if (!result.exists()) {
      throw new Error("The test document could not be read.");
    }

    console.log("READ SUCCESS:", result.data());

    await deleteDoc(testRef);

    console.log("DELETE SUCCESS: Test document removed.");
    console.log("Firestore read and write test passed.");
  } catch (error) {
    console.error("FIRESTORE TEST FAILED:", error.code, error.message);

    if (testRef) {
      try {
        await deleteDoc(testRef);
      } catch (cleanupError) {
        console.error("Could not remove test document:", cleanupError.message);
      }
    }
  }
}

testFirestore();