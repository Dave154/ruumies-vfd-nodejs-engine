import crypto from "crypto";
import express from "express";
import { admin, db } from "../../firebase.js";
import { sendOtpEmail } from "../services/emailService.js";

const router = express.Router();

const generateSixDigitCode = () => {
  const code = crypto.randomInt(0, 1000000);
  return String(code).padStart(6, "0");
};

const isValidEmail = (value) => typeof value === "string" && value.trim().length > 0;

router.post("/send-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ status: false, message: "Email is required." });
    }

    try {
      await admin.auth().getUserByEmail(email);
      return res.status(400).json({ status: false, message: "An account with this email already exists. Please log in." });
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        console.error("Unexpected auth.getUserByEmail error:", error);
        return res.status(500).json({ status: false, message: "Failed to validate email." });
      }
    }

    const code = generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.collection("otps").doc(email).set({
      code,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      verified: false,
    });

    await sendOtpEmail(email, code);

    return res.json({ status: true, message: "OTP sent successfully." });
  } catch (error) {
    console.error("Send OTP Error:", error);
    return res.status(500).json({ status: false, message: "Failed to send OTP." });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();

    if (!isValidEmail(email) || !code) {
      return res.status(400).json({ status: false, message: "Email and code are required." });
    }

    const otpDoc = await db.collection("otps").doc(email).get();

    if (!otpDoc.exists) {
      return res.status(400).json({ status: false, message: "No verification request found." });
    }

    const otpData = otpDoc.data();

    if (!otpData || otpData.code !== code) {
      return res.status(400).json({ status: false, message: "Invalid verification code." });
    }

    const expiresAt = otpData.expiresAt?.toDate ? otpData.expiresAt.toDate() : null;

    if (!expiresAt || Date.now() > expiresAt.getTime()) {
      return res.status(400).json({ status: false, message: "This code has expired." });
    }

    await db.collection("otps").doc(email).update({ verified: true });

    return res.json({ status: true, message: "OTP verified successfully." });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    return res.status(500).json({ status: false, message: "Failed to verify OTP." });
  }
});

router.post("/send-welcome", async (req, res) => {
  try {
    const { email, firstName } = req.body;
    
    if (email && firstName) {
      await sendWelcomeEmail(email, firstName);
    }
    
    return res.json({ status: true });
  } catch (err) {
    console.error("Failed to send welcome email:", err);
    return res.json({ status: false, message: "Email failed, but account exists." });
  }
})

export default router;
