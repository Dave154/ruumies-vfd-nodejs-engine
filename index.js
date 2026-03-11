import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import paystackRouter from "./src/routes/paystack.js";
import webhookHandler from "./src/routes/paystackWebhookHandler.js";
import adminRouter from "./src/routes/admin.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.PAYSTACK_SECRET) {
  console.error("PAYSTACK_SECRET missing in env");
  process.exit(1);
}

// Allow requests from your frontend
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://localhost:3005",
    "http://localhost:3006",
    "http://localhost:3007",
    "http://localhost:3008",
    "http://localhost:3009",
    "http://localhost:3010",
    "https://app.ruumies.com",
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler
);
// Global JSON parser for normal endpoints
app.use(express.json());

// health or other routes
app.get("/health", (_req, res) => res.json({ ok: true }));

// payments routes
app.use("/api/payments", paystackRouter);


app.use("/api/admin", adminRouter);



app.listen(PORT, () => console.log(`listening on ${PORT}`));
