import { readFile } from 'fs/promises';
import admin from 'firebase-admin';

// Read and parse the JSON file manually
const raw = await readFile('./firebase-service-account.json', 'utf-8');
const serviceAccount = JSON.parse(raw);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
export { admin, db };
