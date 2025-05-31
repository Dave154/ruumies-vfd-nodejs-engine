import 'dotenv/config';
import cron from 'node-cron';
import { db } from './firebase.js';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
// const admin = require('firebase-admin');




const generateSignature = (from, to) => {
  const data = from + to;
  return createHash('sha512').update(data).digest('hex');
};




const getAccessToken = async () => {
  const response = await fetch(
    `https://api-devapps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth/token`,
    {
      method: "POST",
      headers:{
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        consumerKey: "gYbSHVMameAqM1BhsDGSOS1jOtpM",
        consumerSecret: "mYihTL9kaLSbDdCiSnNujkD6iBzX",
        validityTime: "-1",
      }),
    }
  );
  const data = await response.json();
  return data.data.access_token;
};
const generateReference = () => {
  const timestamp = Date.now(); 
  const randomPart = Math.random().toString(36).substring(2, 8); // random 6-character string
  return `TestWallet-${timestamp}-${randomPart}`;
};

(async () => {
  const token = await getAccessToken();
  
  const accountEnquiry = async () => {
    try {
      const response = await fetch(`https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/account/enquiry`, {
        headers: {
          'Content-Type': 'application/json',
          'AccessToken': token,
        },
      });
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.log('Account Enquiry Error:', error);
    }
  };

  const transferEnquiry = async (accountNo) => {
    try {
      const response = await fetch(`https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2/transfer/recipient?accountNo=${accountNo}&bank=999999&transfer_type=intra`, {
        headers: {
          'Content-Type': 'application/json',
          'AccessToken': token,
        },
      });
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.log('Transfer Enquiry Error:', error);
    }
  };

  const initiateTransfer = async (accountNo, amount) => {
    try {
      const acctdetails = await accountEnquiry();
      const details2 = await transferEnquiry(accountNo);
       const signature = generateSignature(acctdetails.accountNo, accountNo);
      console.log(acctdetails, details2)
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
          signature: signature,
          amount: amount,
          remark: 'trf download',
          transferType: 'inter',
          reference: generateReference(),
        }),
      });

      const transferResult = await response.json();
      console.log('Transfer response:', transferResult);
      return transferResult;
    } catch (error) {
      console.warn('Transfer Failed:', error);
    }
  };

  // Runs every day at midnight
  cron.schedule('* * * * *', async () => {
    console.log('Running scheduled disbursement check...');

    const now = Date.now();
    const cutoff = now - 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    try {
      const snapshot = await db.collection('paymentEntries')
        .where('released', '==', false)
      //   .where('createdAt', '<=', cutoff)
        .get();

      if (snapshot.empty) {
        console.log('No disbursements to process.');
        return;
      }

      snapshot.forEach(async doc => {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate();
       
        
              if (!createdAt) return;

              const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
              const timeSinceCreation = now - createdAt;

              if (timeSinceCreation >= sevenDaysInMs) {
              console.log(`Ready for disbursement:`, doc.id);
             
              const transferResult = await initiateTransfer( '1000074944 ', data.amount);
              console.log('Transfer Result:', transferResult);
            }
        // Update Firestore
        await db.collection('paymentEntries').doc(doc.id).update({
          released: true,
          releasedAt: Date.now()
        });
      });

    } catch (error) {
      console.error('Disbursement job failed:', error);
    }
  });
})();
