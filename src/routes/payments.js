import express from "express";
import { createTransferRecipient, initiateTransfer } from "../services/paystackService.js";
import { db, admin } from "../../firebase.js";



// Find subaccount by userId or fallback search
export async function findSubaccount(userId, account_number) {
  if (userId) {
    const doc = await db.collection("subaccounts").doc(String(userId)).get();
    if (doc.exists) return { id: doc.id, data: doc.data() };

    const q = await db.collection("subaccounts")
      .where("userId", "==", String(userId))
      .limit(1)
      .get();

    if (!q.empty) return { id: q.docs[0].id, data: q.docs[0].data() };
  }

  if (account_number) {
    const q2 = await db.collection("subaccounts")
      .where("account_number", "==", String(account_number))
      .limit(1)
      .get();

    if (!q2.empty) return { id: q2.docs[0].id, data: q2.docs[0].data() };
  }

  return null;
}

// Ensure Paystack recipient exists (write back to Firestore)
export async function ensureRecipient(subId, subData) {
  if (subData.recipient_code) {
    return { recipient_code: subData.recipient_code, cached: true };
  }
  console.log(subData)

  const account_number =
    subData.account_number || subData.accountNumber;
  const bank_code =
    subData.bank_code || subData.settlement_bank || subData.bankCode;
  const name =
    subData.account_name ||
    subData.accountName ||
    subData.business_name ||
    subData.businessName;

  if (!account_number || !bank_code || !name) {
    throw new Error("Missing bank details in subaccount");
  }

  const created = await createTransferRecipient({
    name,
    account_number,
    bank_code,
    metadata: { subaccountId: subId }
  });

  const recipient_code = created.recipient_code;
  console.log(recipient_code)
  const subRef = db.collection("subaccounts").doc(String(subId));

  await db.runTransaction(async tx => {
    const snap = await tx.get(subRef);
    const existing = snap.data();

    if (existing && existing.recipient_code) return;

    tx.set(subRef, {
      recipient_code,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { recipient_code, cached: false };
}
