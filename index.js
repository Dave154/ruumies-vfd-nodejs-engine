import 'dotenv/config';
import cron from 'node-cron';
import { db } from './firebase.js';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import express from 'express';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const app = express();
app.use(express.json());

// Firebase Admin Initialization (if not yet initialized)
try {
  initializeApp({
    credential: applicationDefault(), // or use cert() if you're passing service account
  });
} catch (err) {
  // ignore already-initialized error in dev
}

const firestore = getFirestore();

const generateSignature = (from, to) => {
  const data = from + to;
  return createHash('sha512').update(data).digest('hex');
};

const getAccessToken = async () => {
  const response = await fetch(
    `https://api-devapps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        consumerKey: process.env.VFD_CONSUMER_KEY,
        consumerSecret: process.env.VFD_CONSUMER_SECRET,
        validityTime: "-1"
      }),
    }
  );
  const data = await response.json();
  return data.data.access_token;
};

const generateReference = () => {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `TestWallet-${timestamp}-${randomPart}`;
};

const accountEnquiry = async (token) => {
  const res = await fetch(`https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/account/enquiry`, {
    headers: {
      'Content-Type': 'application/json',
      'AccessToken': token,
    }
  });
  const data = await res.json();
  return data.data;
};

const transferEnquiry = async (accountNo, token) => {
  const res = await fetch(`https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/transfer/recipient?accountNo=${accountNo}&bank=999999&transfer_type=intra`, {
    headers: {
      'Content-Type': 'application/json',
      'AccessToken': token,
    }
  });
  const data = await res.json();
  return data.data;
};

const initiateTransfer = async (accountNo, amount, token) => {
  try {
    const acctdetails = await accountEnquiry(token);
    const details2 = await transferEnquiry(accountNo, token);
    const signature = generateSignature(acctdetails.accountNo, accountNo);

    const response = await fetch('https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/transfer', {
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

    const result = await response.json();
    return result;
  } catch (err) {
    console.warn("Transfer Error:", err);
    return null;
  }
};

// 🔁 Cron Job: Every minute
cron.schedule('* * * * *', async () => {
  console.log('Running scheduled disbursement check...');

  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;

  const token = await getAccessToken();

  try {
    const snapshot = await firestore.collection('paymentEntries')
      .where('released', '==', false)
      .get();

    if (snapshot.empty) {
      console.log('No disbursements to process.');
      return;
    }

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate();
      if (!createdAt) continue;

      const timeSinceCreation = now - createdAt.getTime();

      if (timeSinceCreation >= 7 * 24 * 60 * 60 * 1000) {
        console.log(`Ready for disbursement:`, doc.id);

        const transferResult = await initiateTransfer('1000074944', data.amount, token);
        console.log('Transfer Result:', transferResult);

        if (transferResult && transferResult.responseCode === '00') {
          // ✅ Update Firestore only if transfer is successful
          await firestore.collection('paymentEntries').doc(doc.id).update({
            released: true,
            releasedAt: Date.now(),
          });

          await firestore.collection('users').doc(data.receiverID).update({
            pendingAmount: FieldValue.increment(-data.amount),
          });
        }
      }
    }

  } catch (err) {
    console.error('Disbursement job failed:', err);
  }
});

// ✅ Webhook endpoint
app.post('/payment-webhook', async (req, res) => {
  const payload = req.body;
  console.log("Webhook received:", payload);

  try {
    await firestore.collection("payments").doc(payload.reference).set({
      ...payload,
      receivedAt: Date.now(),
    });
    res.status(200).send("OK");
  } catch (error) {
    console.error('Error saving webhook:', error);
    res.status(500).send("Failed");
  }
});

// ✅ Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
