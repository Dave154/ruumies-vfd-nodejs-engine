import { admin } from "./firebase.js";

const bootstrapMyAccount = async () => {
  const myUid = "TyhvVhxSCOZBPAfjerJrf2oBApn2"; 
  
  await admin.auth().setCustomUserClaims(myUid, { 
    admin: true, 
    role: "super_admin" 
  });
  
  console.log("Bootstrap complete. You are now the Super Admin!");
  process.exit(0);
};

bootstrapMyAccount();