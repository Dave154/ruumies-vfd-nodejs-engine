// import express from "express";
// import dotenv from "dotenv";
// import cors from "cors";
// import paystackRouter from "./src/routes/paystack.js";
// import webhookHandler from "./src/routes/paystackWebhookHandler.js";

// dotenv.config();

// const app = express();
// const PORT = process.env.PORT || 3000;

// if (!process.env.PAYSTACK_SECRET) {
//   console.error("PAYSTACK_SECRET missing in env");
//   process.exit(1);
// }

// app.use(cors({
//   origin: [
//     "http://localhost:3000",
//     "https://app.ruumies.com",
//   ],
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));

// app.post(
//   "/api/payments/webhook",
//   express.raw({ type: "application/json" }),
//   webhookHandler
// );
// // Global JSON parser for normal endpoints
// app.use(express.json());

// // health or other routes
// app.get("/health", (_req, res) => res.json({ ok: true }));

// // payments routes
// app.use("/api/payments", paystackRouter);



// app.listen(PORT, () => console.log(`listening on ${PORT}`));



// fitting for vercel
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import paystackRouter from "../src/routes/paystack.js";
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

export default app;
