import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "fs"; // Import file system for local check

dotenv.config();

if (!admin.apps.length) {
  let serviceAccount;

  // OPTION A: We are on Vercel (Base64 Variable exists)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const buffer = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64');
      serviceAccount = JSON.parse(buffer.toString('utf8'));
    } catch (e) {
      console.error("Vercel Base64 parse failed:", e);
      throw new Error("Failed to parse Service Account from Base64");
    }
  } 
  // OPTION B: We are Local (File exists)
  else if (fs.existsSync('./firebase-service-account.json')) {
    const fileContent = fs.readFileSync('./firebase-service-account.json', 'utf8');
    serviceAccount = JSON.parse(fileContent);
  } 
  // ERROR: Neither method worked
  else {
    throw new Error("Fatal: Could not find firebase-service-account.json OR Base64 env var.");
  }

  // Initialize Firebase
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
export { admin, db };