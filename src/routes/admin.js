import express from "express";
import { admin, db } from "../../firebase.js";
import { verifySuperAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/assign-role", verifySuperAdmin, async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ status: false, message: "Email and role are required." });
    }

    const validRoles = ["super_admin", "support"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ status: false, message: "Invalid role provided." });
    }

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({ status: false, message: "No user found with this email address." });
      }
      throw error;
    }

    const targetUid = userRecord.uid;

    await admin.auth().setCustomUserClaims(targetUid, { 
      admin: true, 
      role: role 
    });

    await db.collection("admins").doc(targetUid).set({
      uid: targetUid,
      email: email,
      role: role,
      assignedBy: req.user.uid,
      assignedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ 
      status: true, 
      message: `Successfully granted ${role} access to ${email}.` 
    });

  } catch (error) {
    console.error("Assign Role Error:", error);
    return res.status(500).json({ status: false, message: "Failed to assign role." });
  }
});

router.post("/revoke-role", verifySuperAdmin, async (req, res) => {
  try {
    const { targetUid } = req.body;

    if (!targetUid) {
      return res.status(400).json({ status: false, message: "Target UID is required." });
    }

    if (targetUid === req.user.uid) {
      return res.status(400).json({ status: false, message: "You cannot revoke your own access." });
    }

    await admin.auth().setCustomUserClaims(targetUid, null);
    await db.collection("admins").doc(targetUid).delete();
    await admin.auth().revokeRefreshTokens(targetUid);

    return res.json({ 
      status: true, 
      message: "Admin access has been successfully revoked." 
    });

  } catch (error) {
    console.error("Revoke Role Error:", error);
    return res.status(500).json({ status: false, message: "Failed to revoke role." });
  }
});

export default router;