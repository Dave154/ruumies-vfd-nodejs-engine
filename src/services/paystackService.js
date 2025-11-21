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
