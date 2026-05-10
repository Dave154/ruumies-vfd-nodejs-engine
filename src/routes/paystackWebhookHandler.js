import crypto from "crypto";
import { verifyTransaction, REFUND_PROCESSING_RATES, ESCROW_RATES } from "../services/paystackService.js";
import { db, admin } from "../../firebase.js";
import { 
  sendEscrowSecuredEmail, 
  sendOwnerEscrowAlert, 
  sendPayoutApprovedEmail,
  sendRefundEmail
} from "../services/emailService.js";

async function savePaymentHistoryServer(myUid, receiverID, paymentResponse) {
  if (!myUid || !receiverID || !paymentResponse) return;
  const reference = paymentResponse.reference;
  
  try {
    await db.doc(`payments/${receiverID}/transactions/${reference}`).set({
      ...paymentResponse,
      released: false,
      userId: myUid,
      receiverID,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("paymentEntries").doc(reference).set({
      ...paymentResponse,
      released: false,
      userId: myUid,
      receiverID,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error("Error saving payment history:", err);
  }
}

export async function confirmPayment({ myUserID, chatUserId, chatId, status = "Agreed", propertyId }) {
  if (!myUserID || !chatUserId || !chatId) return;

  let conversationId;
  const aNum = Number(myUserID);
  const bNum = Number(chatUserId);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    conversationId = aNum > bNum ? `${myUserID}${chatUserId}` : `${chatUserId}${myUserID}`;
  } else {
    conversationId = String(myUserID) > String(chatUserId) ? `${myUserID}${chatUserId}` : `${chatUserId}${myUserID}`;
  }

  const isClosed = status === "Closed";
  const updatePayload = {
    isConfirmed: !isClosed,
    isRejected: isClosed,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const chatDocRef = db.collection("messages").doc(conversationId).collection("chat").doc(chatId);

  try {
    await chatDocRef.update(updatePayload);
  } catch (err) {
    await chatDocRef.set(updatePayload, { merge: true });
  }

  // Delete the active property request if propertyId is provided
  if (propertyId) {
    try {
      await db.collection("active_property_requests").doc(propertyId).delete();
    } catch (deleteErr) {
      console.error("Error deleting active property request:", deleteErr);
    }
  }
}

async function startEscrowOnProperty(propertyId, tenantEmail) {
  if (!propertyId) return;
  
  try {
    // Note: We are no longer using /wp/v2/property. We are using our custom endpoint!
    const wpUrl = `${process.env.WP_BASE_URL}/wp-json/rummies-wp/v1/update-property`;
    const credentials = Buffer.from(`${process.env.WP_ADMIN_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");

    const wpPayload = new URLSearchParams();
    wpPayload.append('id', propertyId);
    wpPayload.append('start_escrow', 'true');
    wpPayload.append('tenant_email', tenantEmail); 

    const response = await fetch(wpUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: wpPayload
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WordPress Escrow Update Failed: ${errorText}`); 
    }
  } catch (err) {
    console.error("Error updating WP property to Escrow:", err);
    throw err; 
  }
}
async function sendNotificationServer(email, message) {
  if (!email || !message) return;
  try {
    const snap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      await db.collection("notifications").add({
        userId: snap.docs[0].id,
        message,
        unread: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("Error sending notification:", err);
  }
}

async function handleIncomingPayment(eventData) {
  const reference = eventData.reference;
  const verified = await verifyTransaction(reference);
  if (!verified) return;

  const verificationData = verified.data || verified;
  
  if (verificationData.status !== "success") return;

  const amount = verificationData.amount;
  const metadata = verificationData.metadata;
  
  const myUid = metadata.myUserID;
  const receiverID = metadata.uid;
  const messageId = metadata.messageId;
  const propertyId = metadata.propertyId;
  const payEmail = verificationData.customer.email;
  const chatEmail = metadata.email;
  
  const rentAmountNaira = Number(metadata.rentAmount);
  const ownerServiceCharge = Math.round(rentAmountNaira * 0.01);
  const ownerPendingAmount = rentAmountNaira - ownerServiceCharge;
  const amountForDisplay = amount / 100;

  await savePaymentHistoryServer(myUid, receiverID, {
    ...verificationData,
    reference,
    amount: amountForDisplay,
    rentAmount: rentAmountNaira,
    ownerPendingAmount: ownerPendingAmount,
    escrowStatus: "Held",
  });

  try {
    await confirmPayment({ myUserID: myUid, chatUserId: receiverID, chatId: messageId, status: "Agreed", propertyId });
    if (propertyId) {
      await startEscrowOnProperty(propertyId, payEmail);
    }
  } catch (err) {
    throw err; 
  }

  await sendNotificationServer(chatEmail, `Escrow Secured: A payment for ₦${rentAmountNaira.toLocaleString()} has been held securely. The tenant has 7 days to move in.`);
  await sendNotificationServer(payEmail, `Payment Successful: Your rent of ₦${rentAmountNaira.toLocaleString()} is securely held in escrow until you confirm move-in.`);

  await sendEscrowSecuredEmail(payEmail, rentAmountNaira);
  await sendOwnerEscrowAlert(chatEmail, ownerPendingAmount);

  await db.doc(`users/${receiverID}`).update({
    pendingAmount: admin.firestore.FieldValue.increment(Number(ownerPendingAmount)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleTransferSuccess(eventData) {
  const metadata = eventData.metadata || eventData.recipient?.metadata || {};
  const transactionDocId = metadata.transactionDocId;
  const ownerId = metadata.ownerId;

  if (!transactionDocId || !ownerId) return;

  const txRef = db.collection("paymentEntries").doc(transactionDocId);
  const ownerTxRef = db.doc(`payments/${ownerId}/transactions/${transactionDocId}`);
  const userRef = db.doc(`users/${ownerId}`);
  
  const amountForDisplay = eventData.amount / 100;

  try {
    const batch = db.batch();
    
    batch.update(txRef, { 
      escrowStatus: "Completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      paystack_transfer_reference: eventData.reference
    });

    batch.update(ownerTxRef, { 
      escrowStatus: "Completed" 
    });

    batch.update(userRef, {
      pendingAmount: admin.firestore.FieldValue.increment(-Number(amountForDisplay)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const ownerEmail = userSnap.data().email;
      if (ownerEmail) {
        await sendPayoutApprovedEmail(ownerEmail, amountForDisplay);
        await sendNotificationServer(ownerEmail, `Payout Successful: ₦${amountForDisplay.toLocaleString()} has been transferred to your account.`);
      }
    }

  } catch (err) {
    console.error("Error processing transfer success:", err);
  }
}

async function handleTransferFailed(eventData) {
  const metadata = eventData.metadata || eventData.recipient?.metadata || {};
  const transactionDocId = metadata.transactionDocId;
  const ownerId = metadata.ownerId;

  if (!transactionDocId || !ownerId) return;

  const txRef = db.collection("paymentEntries").doc(transactionDocId);
  const ownerTxRef = db.doc(`payments/${ownerId}/transactions/${transactionDocId}`);

  try {
    const batch = db.batch();
    
    batch.update(txRef, { 
      escrowStatus: "Move_In_Confirmed",
      transferFailureReason: eventData.reason || "Bank rejection or timeout",
      transferFailedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    batch.update(ownerTxRef, { 
      escrowStatus: "Move_In_Confirmed" 
    });

    await batch.commit();
  } catch (err) {
    console.error("Error processing transfer failure:", err);
  }
}

async function handleRefundProcessed(eventData) {
  const reference = eventData.transaction_reference || eventData.reference;
  if (!reference) {
    console.error('Refund webhook missing transaction reference');
    return;
  }

  try {
    const snapshot = await db.collection("paymentEntries").where("reference", "==", reference).limit(1).get();
    if (snapshot.empty) {
      console.error(`No transaction found for refund reference: ${reference}`);
      return;
    }

    const txDoc = snapshot.docs[0];
    const txData = txDoc.data();
    const transactionDocId = txDoc.id;

    // Validate required transaction data
    const requiredFields = ['receiverID', 'userId', 'rentAmount', 'reference'];
    const missingFields = requiredFields.filter(f => txData[f] === undefined || txData[f] === null);
    if (missingFields.length > 0) {
      console.error(`Transaction ${transactionDocId} missing required fields for refund: ${missingFields.join(', ')}`);
      return;
    }

    // Validate expected refund amount matches processed amount
    const expectedRefundAmount = txData.refundAmount;
    const processedRefundAmount = eventData.amount / 100;
    if (expectedRefundAmount && Math.abs(expectedRefundAmount - processedRefundAmount) > 0.01) {
      console.error(`Refund amount mismatch for ${transactionDocId}: expected ${expectedRefundAmount}, got ${processedRefundAmount}`);
      // Continue processing but log the discrepancy
    }

    const ownerId = txData.receiverID;
    const tenantId = txData.userId;
    const faultParty = txData.faultAssignedTo;

    // Validate fault party
    const validFaultParties = ['ruumie', 'owner', 'mutual'];
    if (!faultParty || !validFaultParties.includes(faultParty)) {
      console.error(`Invalid or missing fault party for transaction ${transactionDocId}: ${faultParty}`);
      return;
    }

    console.log(`Processing refund for transaction ${transactionDocId}, fault party: ${faultParty}`);

    if (txData.escrowStatus === "Refunded" || txData.escrowStatus === "Refund_Split_Completed") {
      console.log(`Transaction ${transactionDocId} already processed, skipping`);
      return;
    }

    const txRef = db.collection("paymentEntries").doc(transactionDocId);
    const ownerTxRef = db.doc(`payments/${ownerId}/transactions/${transactionDocId}`);

    const batch = db.batch();
    const finalStatus = faultParty === "ruumie" ? "Refund_Split_Completed" : "Refunded";

    batch.update(txRef, {
      escrowStatus: finalStatus,
      refundProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      actualRefundAmount: processedRefundAmount
    });

    if (ownerId) {
      batch.update(ownerTxRef, { escrowStatus: finalStatus });

      let pendingDeduction = Number(txData.ownerPendingAmount || 0);

      if (faultParty === "ruumie") {
        const grossComp = Number(txData.rentAmount || 0) * REFUND_PROCESSING_RATES.ownerCompensationRate;
        const fee = grossComp * REFUND_PROCESSING_RATES.platformPenaltyFee;
        const netPayout = grossComp - fee;
        pendingDeduction = Number(txData.ownerPendingAmount || 0) - netPayout;
      }

      if (pendingDeduction !== 0) {
        batch.update(db.collection("users").doc(ownerId), {
          pendingAmount: admin.firestore.FieldValue.increment(-pendingDeduction),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // Handle cancellation strikes with validation
    if (faultParty === "ruumie" && tenantId) {
      batch.update(db.collection("users").doc(tenantId), {
        cancellationStrikes: admin.firestore.FieldValue.increment(1)
      });
    } else if (faultParty === "owner" && ownerId) {
      batch.update(db.collection("users").doc(ownerId), {
        cancellationStrikes: admin.firestore.FieldValue.increment(1)
      });
    }

    await batch.commit();

    // Safe email extraction with fallbacks
    const tenantEmail = txData.customer?.email || txData.metadata?.email;
    const amountRefunded = processedRefundAmount;
    const rentAmount = Number(txData.rentAmount || 0);

    if (tenantEmail) {
      await sendRefundEmail(tenantEmail, amountRefunded, "Escrow Cancelled / Refund Processed");

      // Send notification based on fault party
      let notificationMsg = "";
      if (faultParty === "owner") {
        notificationMsg = `Refund Approved: ₦${amountRefunded.toLocaleString()} has been refunded to you because the property owner was at fault.`;
      } else if (faultParty === "ruumie") {
        notificationMsg = `Partial Refund Processed: ₦${amountRefunded.toLocaleString()} has been refunded. You were at fault, so a portion was retained.`;
      } else if (faultParty === "mutual") {
        notificationMsg = `Full Refund Processed: ₦${amountRefunded.toLocaleString()} has been fully refunded due to mutual agreement.`;
      }

      if (notificationMsg) {
        await sendNotificationServer(tenantEmail, notificationMsg);
      }
    } else {
      console.warn(`No tenant email found for refund notification in transaction ${transactionDocId}`);
    }

    // Send owner notification about refund status
    if (ownerId) {
      const ownerSnap = await db.collection("users").doc(ownerId).get();
      if (ownerSnap.exists) {
        const ownerEmail = ownerSnap.data().email;
        if (ownerEmail) {
          let ownerMsg = "";
          if (faultParty === "owner") {
            const debtAmount = Number(txData.ownerDebtAmount || rentAmount * ESCROW_RATES.ownerDebtRate);
            ownerMsg = `Refund Processing: You were at fault. Owner penalty of ₦${debtAmount.toLocaleString()} has been added to your account debt.`;
          } else if (faultParty === "mutual") {
            const debtAmount = Number(txData.ownerDebtAmount || rentAmount * ESCROW_RATES.ownerDebtRate);
            ownerMsg = `Refund Processing: Mutual fault confirmed. A debt of ₦${debtAmount.toLocaleString()} has been applied to your account.`;
          } else if (faultParty === "ruumie") {
            const grossComp = rentAmount * REFUND_PROCESSING_RATES.ownerCompensationRate;
            const fee = grossComp * REFUND_PROCESSING_RATES.platformPenaltyFee;
            const netPayout = grossComp - fee;
            ownerMsg = `Refund Processing: Tenant was at fault. You have been compensated ₦${netPayout.toLocaleString()}.`;
          }

          if (ownerMsg) {
            await sendNotificationServer(ownerEmail, ownerMsg);
          }
        }
      }
    }

  } catch (err) {
    console.error("Error processing refund success:", err);
    // Consider adding retry logic or dead letter queue for failed refunds
  }
}

export default async function webhookHandler(req, res) {
  try {
    const WEBHOOK_SECRET = process.env.PAYSTACK_SECRET;
    const signature = req.headers["x-paystack-signature"];
    if (!signature || !WEBHOOK_SECRET) return res.status(400).send("bad request");

    const raw = Buffer.isBuffer(req.body) ? req.body : req.rawBody || null;
    if (!raw) return res.status(400).send("raw body required");

    const computedHash = crypto.createHmac("sha512", WEBHOOK_SECRET).update(raw).digest("hex");
    if (computedHash !== signature) return res.status(401).send("invalid signature");
    
    const payload = JSON.parse(raw.toString("utf8"));
    const event = payload.event;
    const eventData = payload.data;

    switch (event) {
      case "charge.success":
      case "transaction.success":
        await handleIncomingPayment(eventData);
        break;
      case "transfer.success":
        await handleTransferSuccess(eventData);
        break;
      case "transfer.failed":
      case "transfer.reversed":
        await handleTransferFailed(eventData);
        break;
      case "refund.processed":
        await handleRefundProcessed(eventData);
        break;
    }
    
    res.status(200).send("ok");

  } catch (err) {
    console.error("webhook handler error:", err);
    res.status(500).send("Webhook processing failed"); 
  }
}