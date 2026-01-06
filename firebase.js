import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

if (!admin.apps.length) {
  try {
    // Get the encoded string from your environment variable
    const encodedString = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (!encodedString) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing from environment variables");
    }

    // Decode it from Base64 back to normal text
    const buffer = Buffer.from(encodedString, 'base64');
    const decodedJson = buffer.toString('utf8');

    // Parse the normal text into a JSON object
    const serviceAccount = JSON.parse(decodedJson);

    // Initialize Firebase
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    

  } catch (error) {
    console.error("❌ Firebase Auth Error:", error.message);
    if (error.message.includes("Unexpected token")) {
       console.error("Hint: The variable might not be a valid Base64 string.");
    }
    throw error;
  }
}

const db = admin.firestore();
export { admin, db };