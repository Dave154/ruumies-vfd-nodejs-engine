import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import checkEscrowExpiry from "../src/routes/cronHandler.js";
import paystackRouter from "../src/routes/paystack.js";
import emailRouter from "../src/routes/emails.js";
import adminRouter from "../src/routes/admin.js";
import otpRouter from "../src/routes/otp.js";

import webhookHandler from "../src/routes/paystackWebhookHandler.js";

dotenv.config();

const app = express();


if (!process.env.PAYSTACK_SECRET) {
  console.error("PAYSTACK_SECRET missing in env");
  throw new Error("Missing PAYSTACK_SECRET");
}

/**
 * CORS
 */
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://app.ruumies.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler
);

app.use(express.json());


app.get("/health", (_req, res) => {
  res.json({ ok: true });
});


app.use("/api/payments", paystackRouter);
app.use("/api/emails", emailRouter);
app.use("/api/admin", adminRouter);
app.use("/api/auth", otpRouter);

app.get('/api/cron/release-escrow', checkEscrowExpiry);

export default app;
