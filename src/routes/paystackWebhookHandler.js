import crypto from "crypto";
import { verifyTransaction } from "../services/paystackService.js";
import { db, admin } from "../../firebase.js";

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

export async function confirmPayment({ myUserID, chatUserId, chatId, status = "Agreed" }) {
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
}

async function markPropertyAsOccupied(propertyId) {
  if (!propertyId) return;
  
  try {
    const wpUrl = `${process.env.WP_BASE_URL}/wp-json/wp/v2/property/${propertyId}`;
    const credentials = Buffer.from(`${process.env.WP_ADMIN_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");

    const response = await fetch(wpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: JSON.stringify({
        fields: {
          occupancy_status: true
        }
      })
    });

    if (!response.ok) {
      console.error("WP Property update failed:", await response.text());
      return;
    }

    const responseData = await response.json();
    console.log(`Success! WP Property ${propertyId} updated. Current ACF status:`, responseData.acf?.occupancy_status);
    
  } catch (err) {
    console.error("Error updating WP property:", err);
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

  console.log("metadat",verificationData.metadata)

  const amount = verificationData.amount;
  const metadata = verificationData.metadata || {};
  const myUid = metadata.myUserID;
  const receiverID = metadata.uid;
  const messageId = metadata.messageId;
  const propertyId = metadata.propertyId;
  const payEmail = verificationData.customer?.email;
  const chatEmail = metadata.email;
  const amountForDisplay = amount / 100;

  await savePaymentHistoryServer(myUid, receiverID, {
    ...verificationData,
    reference,
    amount: amountForDisplay,
  });

  try {
    await confirmPayment({ myUserID: myUid, chatUserId: receiverID, chatId: messageId, status: "Agreed" });
    if (propertyId) {
      await markPropertyAsOccupied(propertyId);
    }else{
      console.warn("No property ID found in metadata, skipping property occupancy update.");
    }
  } catch (err) {
    console.warn("confirmPayment failed", err);
  }

  const payerFirst = metadata.payerFirstName || metadata.first_name || metadata.payerFirst || "";
  const payerLast = metadata.payerLastName || metadata.last_name || metadata.payerLast || "";

  await sendNotificationServer(chatEmail, `You have received a payment of ${amountForDisplay} from ${payerFirst} ${payerLast}`);
  await sendNotificationServer(payEmail, `You have made a payment of ${amountForDisplay} to ${metadata.receiverFirstName || ""} ${metadata.receiverLastName || ""}`);

  await db.doc(`users/${receiverID}`).update({
    pendingAmount: admin.firestore.FieldValue.increment(Number(amountForDisplay)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleTransferSuccess(eventData) {
  const metadata = eventData.metadata || eventData.recipient?.metadata || {};
  const withdrawalId = metadata.withdrawalId;

  if (!withdrawalId) return;

  const withdrawalRef = db.collection("withdrawals").doc(withdrawalId);
  const snap = await withdrawalRef.get();
  
  if (snap.exists && snap.data().status !== "successful") {
    await withdrawalRef.update({
      status: "successful",
      paystack_reference: eventData.reference,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function handleTransferFailed(eventData) {
  const metadata = eventData.metadata || eventData.recipient?.metadata || {};
  const withdrawalId = metadata.withdrawalId;
  const userId = metadata.userId;

  if (!withdrawalId || !userId) return;

  const withdrawalRef = db.collection("withdrawals").doc(withdrawalId);
  const userRef = db.doc(`users/${userId}`);
  const amountForDisplay = eventData.amount / 100;

  try {
    await db.runTransaction(async (transaction) => {
      const withdrawalSnap = await transaction.get(withdrawalRef);
      if (!withdrawalSnap.exists) return;
      
      const data = withdrawalSnap.data();
      if (data.status === "failed" || data.status === "cancelled") return;

      transaction.update(withdrawalRef, {
        status: "failed",
        failureReason: eventData.reason || "Bank rejection or timeout",
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(userRef, {
        pendingAmount: admin.firestore.FieldValue.increment(Number(amountForDisplay)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    console.error("Error processing transfer failure:", err);
  }
}

export default async function webhookHandler(req, res) {
  try {
    console.log("Received Paystack webhook")
    const WEBHOOK_SECRET = process.env.PAYSTACK_SECRET;
    const signature = req.headers["x-paystack-signature"];

    if (!signature || !WEBHOOK_SECRET) return res.status(400).send("bad request");

    const raw = Buffer.isBuffer(req.body) ? req.body : req.rawBody || null;
    if (!raw) return res.status(400).send("raw body required");

    const computedHash = crypto.createHmac("sha512", WEBHOOK_SECRET).update(raw).digest("hex");
    if (computedHash !== signature) return res.status(401).send("invalid signature");
     console.log("signature verified successfully");
    res.status(200).send("ok");

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
    }
  } catch (err) {
    console.error("webhook handler error:", err);
  }
}