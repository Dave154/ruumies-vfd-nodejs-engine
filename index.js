import 'dotenv/config';
import cron from 'node-cron';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import express from 'express';

import fs from 'fs';

const serviceAccount = JSON.parse(
  fs.readFileSync('./firebase-service-account.json', 'utf8')
);

// Initialize Firebase Admin
initializeApp({
  credential: cert(serviceAccount), // Or cert(serviceAccount) if using service account JSON
});

const db = getFirestore();
const app = express();
app.use(express.json());

// Generate signature hash
const generateSignature = (from, to) => {
  return createHash('sha512').update(from + to).digest('hex');
};

// Get access token
const getAccessToken = async () => {
  const res = await fetch(`https://api-devapps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consumerKey: process.env.CONSUMER_KEY,
      consumerSecret: process.env.CONSUMER_SECRET,
      validityTime: '-1',
    }),
  });
  const data = await res.json();
  return data.data.access_token;
};

// Generate unique reference
const generateReference = () => {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `TestWallet-${timestamp}-${randomPart}`;
};

// Send notification
const sendNotification = async (email, message) => {
  const userSnap = await db.collection('users').where('email', '==', email).get();
  if (!userSnap.empty) {
    await db.collection('notifications').add({
      userId: userSnap.docs[0].id,
      message,
      unread: true,
      createdAt: Timestamp.now(),
    });
  }
};

// Save payment history
const savePaymentHistory = async (myUid, receiverID, paymentResponse) => {
  if (!myUid || !receiverID || !paymentResponse) return;
  await db
    .collection('payments')
    .doc(receiverID)
    .collection('transactions')
    .doc(paymentResponse.reference)
    .set({
      ...paymentResponse,
      released: false,
      userId: myUid,
      receiverID,
    });
};

// Confirm payment
const confirmPayment = async (chatId, myUserID, chatUID, status) => {
  const id = myUserID > chatUID ? `${myUserID}${chatUID}` : `${chatUID}${myUserID}`;
  await db.collection('messages').doc(id).collection('chat').doc(chatId).update({
    isConfirmed: status !== 'Closed',
    isRejected: status === 'Closed',
  });
};

// Wallet functions
const accountEnquiry = async (token) => {
  const res = await fetch(`https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/account/enquiry`, {
    headers: {
      'Content-Type': 'application/json',
      'AccessToken': token,
    },
  });
  const data = await res.json();
  return data.data;
};

const transferEnquiry = async (token, accountNo) => {
  const res = await fetch(`https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/transfer/recipient?accountNo=${accountNo}&bank=999999&transfer_type=intra`, {
    headers: {
      'Content-Type': 'application/json',
      'AccessToken': token,
    },
  });
  const data = await res.json();
  return data.data;
};

const initiateTransfer = async (token, accountNo, amount) => {
  const acctdetails = await accountEnquiry(token);
  const details2 = await transferEnquiry(token, accountNo);
  const signature = generateSignature(acctdetails.accountNo, accountNo);

  const res = await fetch('https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'AccessToken': token,
    },
    body: JSON.stringify({
      fromAccount: acctdetails.accountNo,
      uniqueSenderAccountId: '',
      fromClientId: acctdetails.clientId,
      fromClient: acctdetails.client,
      fromSavingsId: acctdetails.accountId,
      fromBvn: '',
      toClientId: details2.clientId,
      toClient: details2.name,
      toSavingsId: details2.account.id,
      toSession: details2.account.id,
      toBvn: '',
      toAccount: accountNo,
      toBank: '999999',
      signature,
      amount,
      remark: 'trf download',
      transferType: 'inter',
      reference: generateReference(),
    }),
  });

  return res.json();
};

// Scheduled job
cron.schedule('* * * * *', async () => {
  console.log('Running scheduled disbursement check...');
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;

  try {
    const snapshot = await db.collection('paymentEntries').where('released', '==', false).get();
    if (snapshot.empty) {
      console.log('No disbursements to process.');
      return;
    }

    const token = await getAccessToken();

    snapshot.forEach(async (docSnap) => {
      const data = docSnap.data();
      const createdAt = data.createdAt?.toDate();

      if (createdAt && now - createdAt.getTime() >= 7 * 24 * 60 * 60 * 1000) {
        const transferResult = await initiateTransfer(token, '1000074944', data.amount);
        console.log('Transfer Result:', transferResult);

        await db.collection('paymentEntries').doc(docSnap.id).update({
          released: true,
          releasedAt: Date.now(),
        });

        await db.collection('users').doc(data.receiverID).update({
          pendingAmount: FieldValue.increment(-data.amount),
        });
      }
    });
  } catch (error) {
    console.error('Disbursement job failed:', error);
  }
});

// Webhook handler
app.post('/payment-webhook', async (req, res) => {
  const payload = req.body;
  console.log("Webhook received:", payload);

  await db.collection("payments").doc(payload.reference).set({
    ...payload,
    receivedAt: Date.now(),
  });

  res.status(200).send("OK");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
