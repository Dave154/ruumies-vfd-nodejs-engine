// src/services/paystackService.js
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET
const API_BASE = "https://api.paystack.co";

if (!PAYSTACK_SECRET) throw new Error("PAYSTACK_SECRET not set");

export async function initializeTransaction({ email, amount, metadata = {} }) {
  const payload = { email, amount: Math.round(amount), metadata };
  const resp = await axios.post(`${API_BASE}/transaction/initialize`, payload, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json"
    }
  });
  if (!resp.data?.status) throw new Error(resp.data?.message || "initialize failed");
  return resp.data.data; // contains access_code, authorization_url, reference
}

export async function verifyTransaction(reference) {
  const resp = await axios.get(`${API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  });
  if (!resp.data) throw new Error("verify failed");
  return resp.data.data;
}

export async function resolveAccount({ account_number, bank_code }) {
  if (!account_number || !bank_code) {
    throw new Error("account_number and bank_code are required");
  }

  const url = `${API_BASE}/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`;

  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.data || !resp.data.status) {
    const msg = resp.data?.message || "Paystack resolve failed";
    const err = new Error(msg);
    err.response = resp.data;
    throw err;
  }

  const accountName = resp.data.data?.account_name || "";
  return { account_name: accountName, raw: resp.data };
}
export async function createSubaccountOnPaystack({
  business_name,
  bank_code,
  account_number,
  account_name,
  percentage_charge = 0,
  metadata = {},
}) {
  if (!business_name || !bank_code || !account_number) {
    throw new Error("business_name, bank_code and account_number are required");
  }

  // Build payload. If Paystack expects settlement_bank instead of bank_code adjust here.
  const payload = {
    business_name,
    settlement_bank: bank_code, // commonly accepted param
    account_number,
    percentage_charge: Number(percentage_charge) || 0,
    metadata,
  };

  // Include account_name if provided - Paystack may or may not use this field
  if (account_name) payload.business_name = account_name;

  const url = `${API_BASE}/subaccount`;

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.data || !resp.data.status) {
    const msg = resp.data?.message || "Failed to create subaccount on Paystack";
    const err = new Error(msg);
    err.response = resp.data;
    throw err;
  }

  // resp.data.data is the subaccount object
  return resp.data.data;
}

export async function createTransferRecipient({ name, account_number, bank_code, metadata = {} }) {
  if (!name || !account_number || !bank_code) throw new Error("name account_number bank_code required");
  const payload = {
    type: "nuban",
    name,
    account_number: String(account_number),
    bank_code,
    currency: "NGN",
    metadata,
  };
  const res = await axios.post(`${API_BASE}/transferrecipient`, payload, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
  });
  if (!res.data || !res.data.status) {
    const err = new Error(res.data?.message || "Failed to create transfer recipient");
    err.response = res.data;
    throw err;
  }
  return res.data.data; // recipient_code, details
}

export async function initiateTransfer({ amountKobo, recipient_code, reason = "", reference = null, metadata = {} }) {
  if (!amountKobo || !recipient_code) throw new Error("amountKobo and recipient_code required");
  const payload = {
    source: "balance",
    amount: Number(amountKobo),
    recipient: recipient_code,
    reason,
    metadata,
  }; 
  if (reference) payload.reference = reference;
  const res = await axios.post(`${API_BASE}/transfer`, payload, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
  });

  if (!res.data || !res.data.status) {
    const err = new Error(res.data?.message || "Failed to initiate transfer");
    err.response = res.data;
    throw err;
  }
  console.log("initiateTransfer response:", res.data);
  return res.data;
}

export async function verifyTransfer(paystackTransferIdOrCode) {
  if (!paystackTransferIdOrCode) throw new Error("id required");
  const res = await axios.get(`${API_BASE}/transfer/${encodeURIComponent(paystackTransferIdOrCode)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });
  if (!res.data || !res.data.status) {
    const err = new Error(res.data?.message || "Failed to verify transfer");
    err.response = res.data;
    throw err;
  }
  return res.data.data;
}
