import express from "express";
import { admin, db } from "../../firebase.js";
import { verifySuperAdmin } from "../middleware/authMiddleware.js";
import { sendRoleAssignedEmail } from "../services/emailService.js";
import axios from "axios";

const router = express.Router();

router.post("/assign-role", verifySuperAdmin, async (req, res) => {
  try {
    const { email, role, wpToken } = req.body;

    if (!email || !role) {
      return res.status(400).json({ status: false, message: "Email and role are required." });
    }

    if (!wpToken) {
      return res.status(400).json({ status: false, message: "WordPress token is required to synchronize roles." });
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
        return res.status(404).json({ status: false, message: "No user found with this email address in Firebase." });
      }
      throw error;
    }

    // 1. SYNC WITH WORDPRESS FIRST
    try {
      await axios.post(
        `${process.env.WP_API_URL || 'https://stage.ruumies.com'}/wp-json/rummies-wp/v1/update-user-role`, 
        {
          target_email: email,
          role: "administrator" // Upgrade WP role
        },
        {
          headers: { Authorization: `Bearer ${wpToken}` }
        }
      );
    } catch (wpError) {
      console.error("WP Sync Failed:", wpError?.response?.data || wpError.message);
      return res.status(400).json({ 
        status: false, 
        message: wpError?.response?.data?.message || "Failed to update user in WordPress. Ensure the user exists there." 
      });
    }

    // 2. ONLY PROCEED IF WP SYNC WAS SUCCESSFUL
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

    // Send notification email (don't block on this)
    sendRoleAssignedEmail(email, role).catch(emailError => {
      console.error("Failed to send role assignment email:", emailError);
    });

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
    const { targetUid, wpToken } = req.body;

    if (!targetUid) {
      return res.status(400).json({ status: false, message: "Target UID is required." });
    }

    if (targetUid === req.user.uid) {
      return res.status(400).json({ status: false, message: "You cannot revoke your own access." });
    }

    const userRecord = await admin.auth().getUser(targetUid);
    const targetEmail = userRecord.email;

    // 1. SYNC WITH WORDPRESS FIRST
    if (wpToken) {
      try {
        await axios.post(
          `${process.env.WP_API_URL || 'https://stage.ruumies.com'}/wp-json/rummies-wp/v1/update-user-role`, 
          {
            target_email: targetEmail,
            role: "um_rummate" // Demote back to default user
          },
          {
            headers: { Authorization: `Bearer ${wpToken}` }
          }
        );
      } catch (wpError) {
        console.error("WP Downgrade Failed:", wpError?.response?.data || wpError.message);
        return res.status(400).json({ 
          status: false, 
          message: wpError?.response?.data?.message || "Failed to revoke role in WordPress. Operation aborted." 
        });
      }
    }

    // 2. ONLY PROCEED IF WP DOWNGRADE WAS SUCCESSFUL (or if no wpToken was provided)
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