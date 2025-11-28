// src/services/paystackService.js
import axios from "axios";

const PAYSTACK_SECRET = "sk_test_4f9d3626833831e3275caee340bec37af77b1f1c"
// process.env.PAYSTACK_SECRET;
console.log(PAYSTACK_SECRET)
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