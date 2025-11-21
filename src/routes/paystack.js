// src/routes/paystack.js
import express from "express";
import crypto from "crypto";
import { initializeTransaction, verifyTransaction } from "../services/paystackService.js";

const router = express.Router();

// POST /api/payments/initialize
router.post("/initialize", async (req, res) => {
  try {
    const { email, amount, metadata } = req.body;
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

// webhook handler function exported for mounting with express.raw
export async function webhookHandler(req, res) {
  try {
    const WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;
    const signature = req.headers["x-paystack-signature"];

    if (!signature || !WEBHOOK_SECRET) {
      console.warn("missing signature or webhook secret");
      return res.status(400).send("bad request");
    }
    const payload = req.body
    const event = payload.event;
    const data = payload.data;

    // handle relevant events
    if (event === "charge.success" || event === "transaction.success") {
      const reference = data.reference;
      const status = data.status;
      const amount = data.amount;
      const metadata = data.metadata || {};
      // TODO: reconcile with DB using metadata or reference
      console.log("paystack webhook success", { reference, status, amount, metadata });
      // mark order paid if amounts match etc
      return res.status(200).send("ok");
    }

    console.log("unhandled event", event);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("webhook handler error", err);
    return res.status(500).send("server error");
  }
}

export default router;
