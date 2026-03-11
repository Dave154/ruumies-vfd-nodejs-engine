import express from "express";
import crypto from "crypto";
import { createSubaccountOnPaystack, createTransferRecipient, initializeTransaction, initiateTransfer, resolveAccount, verifyTransaction } from "../services/paystackService.js";
import { admin, db } from "../../firebase.js";
import { ensureRecipient, findSubaccount } from "./payments.js";
import { verifyAdmin, verifySuperAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

router.get("/banks", async (req, res) => {
  try {
    const response = await fetch("https://api.paystack.co/bank", {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`
      }
    });

    const data = await response.json();
    res.json(data.data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch banks" });
  }
});

// POST /api/payments/initialize
router.post("/initialize", async (req, res) => {
  try {
    const { email, amount, metadata } = req.body;
    console.log("metas",metadata)
    if (!email || !amount) return res.status(400).json({ status: false, message: "email and amount required" });

    const data = await initializeTransaction({ email, amount, metadata });
    return res.json({
      status: true,
      access_code: data.access_code,
      authorization_url: data.authorization_url,
      reference: data.reference
    });
  } catch (err) {
    console.error("initialize error", err?.message || err);
    return res.status(500).json({ status: false, message: err.message || "server error" });
  }
});

// POST /api/payments/verify
router.post("/verify", async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ status: false, message: "reference required" });

    const data = await verifyTransaction(reference);
    return res.json({ status: true, data });
  } catch (err) {
    console.error("verify error", err?.message || err);
    return res.status(500).json({ status: false, message: err.message || "server error" });
  }
});

router.post("/resolve-account", async (req, res) => {
  try {
    const { account_number, bank_code } = req.body || {};
    if (!account_number || !bank_code) {
      return res.status(400).json({ status: false, message: "account_number and bank_code are required" });
    }

    // call Paystack via service
    const { account_name, raw } = await resolveAccount({ account_number, bank_code });

    return res.json({ status: true, data: { account_name, raw } });
  } catch (err) {
    console.error("resolve-account error", err?.message || err, err?.response || "");
    // If Paystack returns helpful message, use it
    const message = err?.response?.message || err?.message || "Failed to resolve account";
    return res.status(502).json({ status: false, message });
  }
});
router.post("/subaccount", async (req, res) => {
  try {
    const {
      userId,
      business_name,
      bank_code,
      account_number,
      account_name,
      percentage_charge,
      metadata,
    } = req.body || {};

    if (!business_name || !bank_code || !account_number) {
      return res.status(400).json({ status: false, message: "business_name, bank_code and account_number are required" });
    }

    // Check if this bank account is already registered globally
    let globalMatch = null;
    const q = await db.collection("subaccounts")
      .where("account_number", "==", String(account_number))
      .where("bank_code", "==", String(bank_code))
      .limit(1)
      .get();

    if (!q.empty) {
      globalMatch = q.docs[0].data();
    }

    let subaccountData;
    let paystackSubaccountId;

    if (globalMatch && globalMatch.paystack_subaccount_id) {
      // Reuse existing subaccount details
      paystackSubaccountId = globalMatch.paystack_subaccount_id;
      subaccountData = globalMatch.subaccount;
    } else {
      // Create new subaccount on Paystack
      const paystackPayload = {
        business_name,
        bank_code,
        account_number,
        account_name,
        percentage_charge,
        metadata,
      };
      subaccountData = await createSubaccountOnPaystack(paystackPayload);
      paystackSubaccountId = subaccountData.subaccount_code;
    }

    // Prepare data to save/update for this specific user
    const stored = {
      userId: userId || null,
      paystack_subaccount_id: paystackSubaccountId,
      subaccount: subaccountData,
      business_name,
      account_number: String(account_number),
      bank_code: String(bank_code),
      account_name: account_name || subaccountData?.account_name || "",
      percentage_charge: Number(percentage_charge) || 0,
      updatedAt: new Date().toISOString(),
    };

    if (!stored.createdAt) stored.createdAt = new Date().toISOString();

    if (userId) {
      await db.collection("subaccounts").doc(userId).set(stored, { merge: true });
    } else {
      const docId = stored.paystack_subaccount_id;
      if (docId) {
        await db.collection("subaccounts").doc(docId).set(stored, { merge: true });
      } else {
        await db.collection("subaccounts").add(stored);
      }
    }

    return res.json({ status: true, data: stored });

  } catch (err) {
    console.error("create subaccount error", err?.message || err, err?.response || "");
    const message = err?.response?.message || err?.message || "Failed to create subaccount";
    return res.status(502).json({ status: false, message });
  }
});

// POST /api/payments/payout
router.post("/payout", verifyAdmin, async (req, res) => {
  const { withdrawalId } = req.body;

  if (!withdrawalId) {
    return res.status(400).json({ status: false, message: "withdrawalId is required" });
  }

  const withdrawalRef = db.collection("withdrawals").doc(withdrawalId);
  let withdrawalData;

  try {
    withdrawalData = await db.runTransaction(async (transaction) => {
      const withdrawalSnap = await transaction.get(withdrawalRef);

      if (!withdrawalSnap.exists) {
        throw new Error("NOT_FOUND");
      }

      const data = withdrawalSnap.data();

      if (data.status !== "pending") {
        throw new Error(`ALREADY_PROCESSED_${data.status}`);
      }

      transaction.update(withdrawalRef, { status: "processing_init" });
      
      return data;
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ status: false, message: "Withdrawal request not found" });
    }
    if (error.message.startsWith("ALREADY_PROCESSED")) {
      return res.status(400).json({ status: false, message: "This withdrawal is already being processed or completed." });
    }
    return res.status(500).json({ status: false, message: "Database transaction failed." });
  }

  try {
    const { amount, bank: bankDetails, userId } = withdrawalData;
    const amountKobo = Math.round(Number(amount) * 100);

    if (isNaN(amountKobo) || amountKobo <= 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const recipient = await createTransferRecipient({
      name: bankDetails.account_name || "Ruumies User",
      account_number: bankDetails.account_number,
      bank_code: bankDetails.bank_code,
      metadata: { userId, withdrawalId }
    });

    const recipient_code = recipient.recipient_code;

    const transfer = await initiateTransfer({
      amountKobo,
      recipient_code,
      reason: `Ruumies Payout - ${withdrawalId.slice(0, 8)}`,
      reference: undefined, 
      metadata: { userId, withdrawalId }
    });

    await withdrawalRef.update({
      status: "processing",
      transfer_code: transfer.transfer_code || null,
      transfer_id: transfer.id || null,
      reference: transfer.reference || null, 
      adminAction: {
        by: req.user.uid, 
        at: admin.firestore.FieldValue.serverTimestamp(),
        note: "Transfer initiated via Paystack API"
      }
    });

    return res.json({
      status: true,
      message: "Transfer initiated successfully",
      data: { status: "processing", transfer_code: transfer.transfer_code }
    });

  } catch (error) {
    await withdrawalRef.update({ status: "pending" });

    if (error.message === "INVALID_AMOUNT") {
       return res.status(400).json({ status: false, message: "Invalid amount in database." });
    }

    if (error.response && error.response.data) {
      console.error("Payout error from Paystack:", error.response.data);
      return res.status(400).json({
        status: false,
        message: error.response.data.message || "Paystack transfer failed"
      });
    }

    console.error("Internal Payout Error:", error);
    return res.status(500).json({ status: false, message: "Internal server error during payout" });
  }
});
export default router;
