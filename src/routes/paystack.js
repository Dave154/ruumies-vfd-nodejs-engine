// src/routes/paystack.js
import express from "express";
import crypto from "crypto";
import { createSubaccountOnPaystack, initializeTransaction, initiateTransfer, resolveAccount, verifyTransaction } from "../services/paystackService.js";
import { db } from "../../firebase.js";
import { ensureRecipient, findSubaccount } from "./payments.js";

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
    // Idempotency: check if we already have a subaccount saved for this userId or account_number
    // Priority: userId -> account_number
    let existing = null;
    if (userId) {
      const doc = await db.collection("subaccounts").doc(userId).get();
      if (doc.exists) existing = doc.data();
    }

    if (!existing) {
      // try by account_number index
      const q = await db.collection("subaccounts").where("account_number", "==", String(account_number)).limit(1).get();
      if (!q.empty) existing = q.docs[0].data();
    }

    if (existing && existing.paystack_subaccount_id) {
      // return existing record to the client - idempotent
      return res.json({ status: true, data: existing, idempotent: true });
    }

    // Create subaccount on Paystack
    const paystackPayload = {
      business_name,
      bank_code,
      account_number,
      account_name,
      percentage_charge,
      metadata,
    };

    const subaccount = await createSubaccountOnPaystack(paystackPayload);

    // Save to Firestore. If we have userId use doc id = userId for easy lookup
    const stored = {
      userId: userId || null,
      paystack_subaccount_id: subaccount.subaccount_code,
      subaccount: subaccount,
      business_name,
      account_number: String(account_number),
      bank_code,
      account_name: account_name || subaccount?.account_name || "",
      percentage_charge: Number(percentage_charge) || 0,
      createdAt: new Date().toISOString(),
    };

    if (userId) {
      await db.collection("subaccounts").doc(userId).set(stored, { merge: true });
    } else {
      // write with paystack_subaccount_id as id if available, otherwise push auto id
      const docId = stored.paystack_subaccount_id || undefined;
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
router.post("/payout", async (req, res) => {
  try {
    const { userId, amount, clientRef, reason = "", metadata = {} } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        status: false,
        message: "userId and amount are required"
      });
    }

    const amountKobo = Math.round(Number(amount) * 100);

    if (isNaN(amountKobo) || amountKobo <= 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid amount"
      });
    }

    // Idempotency check
    if (clientRef) {
      const q = await db.collection("transfers")
        .where("clientRef", "==", clientRef)
        .limit(1)
        .get();

      if (!q.empty) {
        return res.json({
          status: true,
          data: q.docs[0].data(),
          idempotent: true
        });
      }
    }

    // Fetch user's subaccount
    const sub = await findSubaccount(userId, null);
    if (!sub) {
      return res.status(404).json({
        status: false,
        message: "Subaccount not found"
      });
    }

    const subId = sub.id;
    const subData = sub.data;

    // Ensure recipient exists
    const recipient = await ensureRecipient(subId, subData);
    const recipient_code = recipient.recipient_code;

    // Initiate transfer
    const transfer = await initiateTransfer({
      amountKobo,
      recipient_code,
      reason,
      reference: clientRef || undefined,
      metadata: { userId, ...metadata }
    });

    const record = {
      clientRef: clientRef || null,
      transfer_code: transfer.transfer_code || null,
      transfer_id: transfer.id || null,
      amount: amountKobo,
      amount_display: amountKobo / 100,
      currency: transfer.currency || "NGN",
      recipient_code,
      recipient_subaccountId: subId,
      recipient_account_number: subData.account_number,
      status: transfer.status || "pending",
      reason,
      metadata: { userId, ...metadata },
      raw: transfer,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const saveId = transfer.transfer_code || transfer.id;

    if (saveId) {
      await db.collection("transfers").doc(String(saveId)).set(record, { merge: true });

      return res.json({
        status: true,
        data: record,
        id: saveId
      });
    }

    const newDoc = await db.collection("transfers").add(record);

    return res.json({
      status: true,
      data: record,
      id: newDoc.id
    });

  } catch (error) {
    console.error("payout error", error.response.data);
    return res.status(500).json({
      status: false,
      message: error.response.data.message || "Failed to process payout"
    });
  }
});




export default router;
