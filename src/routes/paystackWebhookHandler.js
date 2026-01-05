// src/routes/paystackWebhookHandler.js
import crypto from "crypto";
import { verifyTransaction } from "../services/paystackService.js";
import { db, admin } from "../../firebase.js";

// Helper: save payment history (server-side)
async function savePaymentHistoryServer(myUid, receiverID, paymentResponse) {
  if (!myUid || !receiverID || !paymentResponse) return;

  const reference = paymentResponse.reference;
  try {
    await db
      .doc(`payments/${receiverID}/transactions/${reference}`)
      .set({
        ...paymentResponse,
        released: false,
        userId: myUid,
        receiverID,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // Use reference as id in paymentEntries to avoid duplicates
    await db.collection("paymentEntries").doc(reference).set({
      ...paymentResponse,
      released: false,
      userId: myUid,
      receiverID,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log("Payment history saved successfully (server)");
  } catch (err) {
    console.error("Error saving payment history server-side:", err);
    throw err;
  }
}

// Confirm payment server-side using the message chat path pattern your frontend uses
export async function confirmPayment({ myUserID, chatUserId, chatId, status = "Agreed" }) {
  if (!myUserID || !chatUserId || !chatId) {
    console.warn("confirmPayment missing args", { myUserID, chatUserId, chatId });
    return;
  }

  // Build conversation id the same way your frontend does
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
    isConfirmed: isClosed ? false : true,
    isRejected: isClosed ? true : false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const chatDocRef = db
    .collection("messages")
    .doc(conversationId)
    .collection("chat")
    .doc(chatId);

  try {
    await chatDocRef.update(updatePayload);
    console.log("Message updated with confirm status", { conversationId, chatId, status });
    return { ok: true, created: false, conversationId, chatId };
  } catch (err) {
    // fallback to set with merge to avoid failing webhook on missing doc
    try {
      await chatDocRef.set(updatePayload, { merge: true });
      console.log("Message doc created (merge) with confirm status", { conversationId, chatId, status });
      return { ok: true, created: true, conversationId, chatId };
    } catch (err2) {
      console.error("confirmPayment error", err, err2);
      throw err2;
    }
  }
}

// Helper: add notification for a user by email
async function sendNotificationServer(email, message) {
  if (!email || !message) return;
  try {
    const usersRef = db.collection("users");
    const q = usersRef.where("email", "==", email).limit(1);
    const snap = await q.get();
    if (!snap.empty) {
      const uid = snap.docs[0].id;
      await db.collection("notifications").add({
        userId: uid,
        message,
        unread: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("Notification created for", email);
    } else {
      console.warn("No user found for notification email:", email);
    }
  } catch (err) {
    console.error("Error sending notification server-side:", err);
  }
}

// Helper: increment pendingAmount on a user doc
async function incrementPendingAmount(userId, amountNumber) {
  if (!userId || amountNumber == null) return;
  try {
    const userRef = db.doc(`users/${userId}`);
    await userRef.update({
      pendingAmount: admin.firestore.FieldValue.increment(Number(amountNumber)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("Pending amount incremented for", userId);
  } catch (err) {
    console.error("Error incrementing pendingAmount:", err);
  }
}

export default async function webhookHandler(req, res) {
<<<<<<< HEAD
  console.log("webhookHandler called");
=======
>>>>>>> 8b981f200a76b3e4ee23001dc73ceb10e98e677f
  try {
    const WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;
    const signature = req.headers["x-paystack-signature"];

    if (!signature || !WEBHOOK_SECRET) {
      console.warn("Missing signature header or webhook secret not set");
      return res.status(400).send("bad request");
    }

    // Expect req.body to be a Buffer because route is mounted with express.raw({ type: "application/json" })
    const raw = Buffer.isBuffer(req.body) ? req.body : req.rawBody || null;
    if (!raw) {
      console.warn("No raw body found. Ensure this route is mounted with express.raw({ type: 'application/json' })");
      return res.status(400).send("raw body required");
    }

    // Verify HMAC signature
    const computedHash = crypto.createHmac("sha512", WEBHOOK_SECRET).update(raw).digest("hex");
    // if (computedHash !== signature) {
    //   console.warn("Invalid webhook signature", { computedHash, signature });
    //   return res.status(401).send("invalid signature");
    // }

    // Parse payload after verification
    const payload = JSON.parse(raw.toString("utf8"));
    const event = payload.event;
    const eventData = payload.data;

    if (event === "charge.success" || event === "transaction.success") {
      const reference = eventData.reference;
      console.log("Webhook received for reference:", reference);

      // double check with Paystack verify for safety
      const verified = await verifyTransaction(reference);
      if (!verified) {
        console.warn("verifyTransaction returned falsy for", reference);
        return res.status(400).send("verification failed");
      }

      // depending on your verifyTransaction implementation it may return { status, amount, metadata, ... }
      // ensure we check the inner structure if needed. Adjust below if your service returns { data: {...} }.
      const verificationData = verified.data ? verified.data : verified;
      if (verificationData.status !== "success") {
        console.warn("Transaction status not success for", reference, verificationData.status);
        return res.status(200).send("ignored non-success status");
      }

      const amount = verificationData.amount; // in kobo
      const metadata = verificationData.metadata || {};
      const myUid = metadata.myUserID;
      const receiverID = metadata.uid
      const messageId = metadata.messageId 
      const payEmail = verificationData.customer.email
      const chatEmail = metadata.email
      const amountForDisplay = amount / 100;
      console.log(verificationData)
      // Save payment history (idempotent on reference)
      await savePaymentHistoryServer(myUid, receiverID, {
        ...verificationData,
        reference,
        amount: amountForDisplay,
      });

      // Confirm message using mirror logic
      try {
        await confirmPayment({
          myUserID: myUid,
          chatUserId: receiverID,
          chatId: messageId,
          status: "Agreed",
        });
      } catch (err) {
        console.warn("confirmPayment failed", err);
      }

      // Notifications
      const receiverEmail = chatEmail 
      const payerFirst = metadata.payerFirstName || metadata.first_name || metadata.payerFirst || "";
      const payerLast = metadata.payerLastName || metadata.last_name || metadata.payerLast || "";

      await sendNotificationServer(receiverEmail, `You have received a payment of ${amountForDisplay} from ${payerFirst} ${payerLast}`);
      await sendNotificationServer(payEmail, `You have made a payment of ${amountForDisplay} to ${metadata.receiverFirstName || ""} ${metadata.receiverLastName || ""}`);

      // Increment pending amount
      await incrementPendingAmount(receiverID, amountForDisplay);

      console.log("Webhook processed successfully for", reference);
      return res.status(200).send("ok");
    }

    console.log("Ignoring event:", event);
    return res.status(200).send("ignored");
  } catch (err) {
    console.error("webhook handler error", err);
    return res.status(500).send("server error");
  }
}
