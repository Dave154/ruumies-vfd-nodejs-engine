// src/routes/paystack.js
import express from "express";
import crypto from "crypto";
import { initializeTransaction, resolveAccount, verifyTransaction } from "../services/paystackService.js";

const router = express.Router();

router.get("/banks", async (req, res) => {
  try {
    const response = await fetch("https://api.paystack.co/bank", {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`
      }
    });

    const data = await response.json();
    res.json(data.data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch banks" });
  }
});

// POST /api/payments/initialize
router.post("/initialize", async (req, res) => {
  try {
    const { email, amount, metadata } = req.body;
    console.log("metas",metadata)
    if (!email || !amount) return res.status(400).json({ status: false, message: "email and amount required" });

    const data = await initializeTransaction({ email, amount, metadata });
    return res.json({
      status: true,
      access_code: data.access_code,
      authorization_url: data.authorization_url,
      reference: data.reference
    });
  } catch (err) {
    console.error("initialize error", err?.message || err);
    return res.status(500).json({ status: false, message: err.message || "server error" });
  }
});

// POST /api/payments/verify
router.post("/verify", async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ status: false, message: "reference required" });

    const data = await verifyTransaction(reference);
    return res.json({ status: true, data });
  } catch (err) {
    console.error("verify error", err?.message || err);
    return res.status(500).json({ status: false, message: err.message || "server error" });
  }
});

router.post("/resolve-account", async (req, res) => {
  try {
    const { account_number, bank_code } = req.body || {};
    if (!account_number || !bank_code) {
      return res.status(400).json({ status: false, message: "account_number and bank_code are required" });
    }

    // call Paystack via service
    const { account_name, raw } = await resolveAccount({ account_number, bank_code });

    return res.json({ status: true, data: { account_name, raw } });
  } catch (err) {
    console.error("resolve-account error", err?.message || err, err?.response || "");
    // If Paystack returns helpful message, use it
    const message = err?.response?.message || err?.message || "Failed to resolve account";
    return res.status(502).json({ status: false, message });
  }
});



export default router;
