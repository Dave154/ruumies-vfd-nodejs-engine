import express from "express";
import crypto from "crypto";
import { 
  createSubaccountOnPaystack, 
  createTransferRecipient, 
  initializeTransaction, 
  initiateTransfer, 
  resolveAccount, 
  verifyTransaction,
  initiateRefund,
  ESCROW_RATES
} from "../services/paystackService.js";
import { admin, db } from "../../firebase.js";
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

router.post("/initialize", async (req, res) => {
  try {
    const { email, amount, metadata } = req.body;
    
    if (!email || !amount) {
      return res.status(400).json({ status: false, message: "email and amount required" });
    }

    if (metadata?.propertyId) {
      const wpUrl = `${process.env.WP_BASE_URL}/wp-json/wp/v2/property/${metadata.propertyId}`;
      const credentials = Buffer.from(`${process.env.WP_ADMIN_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");
      
      const wpResponse = await fetch(wpUrl, {
        headers: {
          "Authorization": `Basic ${credentials}`,
        }
      });

      if (wpResponse.ok) {
        const propertyData = await wpResponse.json();
        const escrowStatus = propertyData.acf?.escrow_status;
        
        if (escrowStatus && escrowStatus !== "available") {
          return res.status(409).json({ 
            status: false, 
            message: "This property is already booked or locked in escrow." 
          });
        }
      }
    }

    const data = await initializeTransaction({ email, amount, metadata });
    
    return res.json({
      status: true,
      access_code: data.access_code,
      authorization_url: data.authorization_url,
      reference: data.reference
    });
    
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message || "server error" });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ status: false, message: "reference required" });

    const data = await verifyTransaction(reference);
    return res.json({ status: true, data });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message || "server error" });
  }
});

router.post("/resolve-account", async (req, res) => {
  try {
    const { account_number, bank_code } = req.body || {};
    if (!account_number || !bank_code) {
      return res.status(400).json({ status: false, message: "account_number and bank_code are required" });
    }

    const { account_name, raw } = await resolveAccount({ account_number, bank_code });
    return res.json({ status: true, data: { account_name, raw } });
  } catch (err) {
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
      paystackSubaccountId = globalMatch.paystack_subaccount_id;
      subaccountData = globalMatch.subaccount;
    } else {
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
    const message = err?.response?.message || err?.message || "Failed to create subaccount";
    return res.status(502).json({ status: false, message });
  }
});

router.post("/approve-payout", verifyAdmin, async (req, res) => {
  try {
    const { transactionDocId } = req.body;
    if (!transactionDocId) {
      return res.status(400).json({ status: false, message: "transactionDocId required" });
    }
    
    const txRef = db.collection("paymentEntries").doc(transactionDocId);
    const txSnap = await txRef.get();
    
    if (!txSnap.exists) {
      return res.status(404).json({ status: false, message: "Transaction not found" });
    }
    const txData = txSnap.data();
    if (txData.escrowStatus !== "Move_In_Confirmed") {
      return res.status(400).json({ status: false, message: "Transaction is not ready for payout" });
    }

    const ownerId = txData.receiverID || txData.metadata?.uid;
    if (!ownerId || typeof ownerId !== 'string') {
      return res.status(400).json({ 
        status: false, 
        message: "Database Error: This transaction is missing the owner's ID (receiverID)." 
      });
    }

    // Fetch owner's outstanding debt
    const userSnap = await db.collection("users").doc(ownerId).get();
    const ownerData = userSnap.data() || {};
    const totalOutstandingDebt = ownerData.totalOutstandingDebt || 0;
    
    const payoutAmountNGN = Number(txData.ownerPendingAmount);
    const netPayoutAmountNGN = payoutAmountNGN - totalOutstandingDebt;

    const batch = db.batch();
    let transferInitiated = false;
    let debtPaymentId = null;

    if (netPayoutAmountNGN > 0) {
      // Debt is less than payout - process transfer for net amount
      const subSnap = await db.collection("subaccounts").doc(ownerId).get();
      
      if (!subSnap.exists) {
        return res.status(400).json({ status: false, message: "Owner bank details not found" });
      }

      const bankDetails = subSnap.data();
      const amountKobo = Math.round(netPayoutAmountNGN * 100);

      const recipient = await createTransferRecipient({
        name: bankDetails.account_name,
        account_number: bankDetails.account_number,
        bank_code: bankDetails.bank_code,
        metadata: { ownerId, transactionDocId }
      });

      await initiateTransfer({
        amountKobo,
        recipient_code: recipient.recipient_code,
        reason: `Ruumies Payout - ${transactionDocId.slice(0, 8)}`,
        metadata: { ownerId, transactionDocId }
      });

      transferInitiated = true;

      // Mark all owner's debts as paid
      if (totalOutstandingDebt > 0) {
        const debtSnap = await db.collection("ownerDebts")
          .where("ownerId", "==", ownerId)
          .where("status", "==", "pending")
          .get();

        debtSnap.docs.forEach(doc => {
          batch.update(doc.ref, { status: "paid" });
        });

        // Create debt payment record
        const debtPaymentRef = db.collection("debtPayments").doc();
        debtPaymentId = debtPaymentRef.id;
        batch.set(debtPaymentRef, {
          ownerId,
          transactionDocId,
          debtAmountPaidKobo: Math.round(totalOutstandingDebt * 100),
          debtAmountPaidNGN: totalOutstandingDebt,
          payoutAmountNGN,
          netTransferAmountNGN: netPayoutAmountNGN,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          paymentType: "debt_deduction_with_transfer"
        });

        // Reduce user's total outstanding debt to 0
        batch.update(userSnap.ref, { totalOutstandingDebt: 0 });
      }
    } else {
      // Debt is equal to or greater than payout - no transfer, reduce debt
      const debtAmountReducedNGN = payoutAmountNGN;
      const newRemainingDebtNGN = totalOutstandingDebt - debtAmountReducedNGN;

      // Create debt payment record
      const debtPaymentRef = db.collection("debtPayments").doc();
      debtPaymentId = debtPaymentRef.id;
      batch.set(debtPaymentRef, {
        ownerId,
        transactionDocId,
        debtAmountPaidKobo: Math.round(debtAmountReducedNGN * 100),
        debtAmountPaidNGN: debtAmountReducedNGN,
        payoutAmountNGN,
        netTransferAmountNGN: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentType: "debt_only_deduction"
      });

      // Update user's remaining outstanding debt
      batch.update(userSnap.ref, { totalOutstandingDebt: newRemainingDebtNGN });
    }

    // Update transaction
    batch.update(txRef, { 
      escrowStatus: "Processing_Transfer",
      debtCollected: totalOutstandingDebt,
      netPayoutAmount: netPayoutAmountNGN,
      debtPaymentId
    });
    
    const ownerTxRef = db.doc(`payments/${ownerId}/transactions/${transactionDocId}`);
    batch.update(ownerTxRef, { escrowStatus: "Processing_Transfer" });
    
    await batch.commit();

    const responseMessage = transferInitiated 
      ? `Transfer initiated for ${netPayoutAmountNGN} NGN. Debt of ${totalOutstandingDebt} NGN collected.`
      : `No transfer. Payout fully applied to debt reduction (${payoutAmountNGN} NGN collected). Remaining debt: ${totalOutstandingDebt - payoutAmountNGN} NGN`;

    return res.json({ status: true, message: responseMessage });

  } catch (err) {
    return res.status(500).json({ status: false, message: err.response?.data?.message || err.message });
  }
});

router.post("/refund", verifyAdmin, async (req, res) => {
  try {
    const { transactionDocId, faultParty } = req.body;
    
    if (!transactionDocId || !faultParty) {
      return res.status(400).json({ status: false, message: "transactionDocId and faultParty required" });
    }

    // Validate fault party
    const validFaultParties = ['ruumie', 'owner', 'mutual'];
    if (!validFaultParties.includes(faultParty)) {
      return res.status(400).json({ 
        status: false, 
        message: "Invalid faultParty. Must be one of: ruumie, owner, mutual" 
      });
    }

    const txRef = db.collection("paymentEntries").doc(transactionDocId);
    const txSnap = await txRef.get();
    
    if (!txSnap.exists) {
      return res.status(404).json({ status: false, message: "Transaction not found" });
    }

    const txData = txSnap.data();
    
    // Validate transaction has required data
    if (!txData.reference || !txData.metadata?.rentAmount) {
      return res.status(400).json({ 
        status: false, 
        message: "Transaction missing required data for refund" 
      });
    }

    if (txData.escrowStatus === "Refunded" || txData.escrowStatus === "Processing_Refund") {
      return res.status(400).json({ status: false, message: "This transaction is already refunded or processing" });
    }

    // Only allow refunds for transactions that are in escrow
    const allowedStatuses = ["Held", "Move_In_Confirmed", "Disputed"];
    if (!allowedStatuses.includes(txData.escrowStatus)) {
      return res.status(400).json({ 
        status: false, 
        message: `Cannot refund transaction with status: ${txData.escrowStatus}` 
      });
    }

    const rentAmount = Number(txData.metadata?.rentAmount || txData.rentAmount);
    if (!rentAmount || rentAmount <= 0) {
      return res.status(400).json({ status: false, message: "Invalid rent amount for refund" });
    }

    let refundAmountKobo = Math.round(rentAmount * 100);
    let ownerDebtAmountKobo = 0;

    if (faultParty === "owner") {
      // Owner at fault: Ruumie gets 101%, Owner accumulates 1% debt
      refundAmountKobo = Math.round(rentAmount * ESCROW_RATES.ownerFaultyRefundRate * 100);
      ownerDebtAmountKobo = Math.round(rentAmount * ESCROW_RATES.ownerDebtRate * 100);
    } else if (faultParty === "ruumie") {
      // Ruumie at fault: Ruumie gets 5%, no service charge, no debt
      refundAmountKobo = Math.round(rentAmount * ESCROW_RATES.ruumieRefundRate * 100);
    } else if (faultParty === "mutual") {
      // Mutual fault: Ruumie gets 100%, Owner accumulates 1% debt
      refundAmountKobo = Math.round(rentAmount * ESCROW_RATES.mutualRefundRate * 100);
      ownerDebtAmountKobo = Math.round(rentAmount * ESCROW_RATES.ownerDebtRate * 100);
    }

    // Validate refund amount is reasonable (not more than owner faulty refund rate)
    const maxAllowedRefund = Math.round(rentAmount * ESCROW_RATES.ownerFaultyRefundRate * 100);
    if (refundAmountKobo > maxAllowedRefund) {
      return res.status(400).json({ 
        status: false, 
        message: "Calculated refund amount exceeds maximum allowed" 
      });
    }

    await initiateRefund({
      transactionRef: txData.reference, 
      amountKobo: refundAmountKobo,
      merchant_note: `Admin Refund for Property ID: ${txData.metadata?.propertyId || 'N/A'}`
    });

    const batch = db.batch();
    const ownerId = txData.receiverID;

    if (!ownerId) {
      return res.status(400).json({ status: false, message: "Transaction missing owner ID" });
    }

    batch.update(txRef, { 
      escrowStatus: "Processing_Refund", 
      refundInitiatedAt: admin.firestore.FieldValue.serverTimestamp(),
      faultAssignedTo: faultParty,
      refundAmount: refundAmountKobo / 100,
      ownerDebtAmount: ownerDebtAmountKobo / 100
    });

    const ownerTxRef = db.doc(`payments/${ownerId}/transactions/${transactionDocId}`);
    batch.update(ownerTxRef, { escrowStatus: "Processing_Refund" });

    // Add debt record if owner is at fault or mutual fault
    if (ownerDebtAmountKobo > 0) {
      const debtRef = db.collection("ownerDebts").doc();
      batch.set(debtRef, {
        ownerId,
        transactionDocId,
        debtAmountKobo: ownerDebtAmountKobo,
        debtAmountNGN: ownerDebtAmountKobo / 100,
        reason: `${faultParty === "mutual" ? "Mutual fault" : "Owner at fault"} - Refund penalty`,
        faultParty,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending"
      });

      // Update user's total outstanding debt
      const userRef = db.collection("users").doc(ownerId);
      batch.update(userRef, {
        totalOutstandingDebt: admin.firestore.FieldValue.increment(ownerDebtAmountKobo / 100)
      });
    }

    await batch.commit();

    const propertyId = txData.metadata?.propertyId;
    if (propertyId) {
      try {
        const wpUrl = `${process.env.WP_BASE_URL}/wp-json/rummies-wp/v1/update-property`; 
        const credentials = Buffer.from(`${process.env.WP_ADMIN_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");
        
        const wpPayload = new URLSearchParams();
        wpPayload.append('id', propertyId);
        wpPayload.append('escrow_status', 'available');
        wpPayload.append('escrow_tenant_id', '');
        wpPayload.append('escrow_payment_date', '');
        wpPayload.append('escrow_release_date', '');
        wpPayload.append('occupancy_status', 0); 

        const wpResponse = await fetch(wpUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: wpPayload
        });

        if (!wpResponse.ok) {
          console.error(`Failed to update WordPress property ${propertyId} escrow status`);
        }
      } catch (wpError) {
        console.error("Error updating WordPress property status:", wpError);
        // Don't fail the refund if WP update fails
      }
    }

    return res.json({ 
      status: true, 
      message: "Refund initiated. Processing will complete via webhook.",
      refundAmount: refundAmountKobo / 100,
      faultParty
    });

  } catch (err) {
    console.error("Refund endpoint error:", err);
    return res.status(500).json({ status: false, message: err.response?.data?.message || err.message });
  }
});

export default router;