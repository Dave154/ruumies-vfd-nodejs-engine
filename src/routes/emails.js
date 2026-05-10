import express from 'express';
import { 
  sendCoreEmail, 
  sendPropertyApprovalEmail, 
  sendPropertyRejectionEmail 
} from '../services/emailService.js';
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

router.post('/send-property-approval-email', verifyAuth, async (req, res) => {
  const { propertyId, propertyTitle, ownerEmail, ownerName } = req.body;

  // Validate required fields
  if (!propertyId || !propertyTitle || !ownerEmail || !ownerName) {
    return res.status(400).json({ 
      status: false, 
      message: "Missing required fields: propertyId, propertyTitle, ownerEmail, ownerName" 
    });
  }

  try {
    const result = await sendPropertyApprovalEmail({
      propertyId,
      propertyTitle,
      ownerEmail,
      ownerName
    });

    if (result.success) {
      return res.json({ status: true, message: "Property approval email sent successfully!" });
    } else {
      return res.status(500).json({ status: false, message: "Failed to send approval email" });
    }
  } catch (error) {
    console.error('Error sending property approval email:', error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
});

router.post('/send-property-rejection-email', verifyAuth, async (req, res) => {
  const { propertyId, propertyTitle, ownerEmail, ownerName } = req.body;

  // Validate required fields
  if (!propertyId || !propertyTitle || !ownerEmail || !ownerName) {
    return res.status(400).json({ 
      status: false, 
      message: "Missing required fields: propertyId, propertyTitle, ownerEmail, ownerName" 
    });
  }

  try {
    const result = await sendPropertyRejectionEmail({
      propertyId,
      propertyTitle,
      ownerEmail,
      ownerName
    });

    if (result.success) {
      return res.json({ status: true, message: "Property rejection email sent successfully!" });
    } else {
      return res.status(500).json({ status: false, message: "Failed to send rejection email" });
    }
  } catch (error) {
    console.error('Error sending property rejection email:', error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
});

export default router;