import express from 'express';
import { sendCoreEmail } from '../services/emailService.js';
import { verifyAuth } from '../middleware/authMiddleware.js'; 

const router = express.Router();

router.post('/trigger', verifyAuth, async (req, res) => {
  const { to, subject, html } = req.body;

  if (!to || !subject || !html) {
    return res.status(400).json({ status: false, message: "Missing email fields" });
  }

  const result = await sendCoreEmail({ to, subject, html });

  if (result.success) {
    return res.json({ status: true, message: "Email sent!" });
  } else {
    return res.status(500).json({ status: false, message: "Failed to send email" });
  }
});

export default router;