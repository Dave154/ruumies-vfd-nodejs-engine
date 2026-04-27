import { db, admin } from "../../firebase.js";

export default async function checkEscrowExpiry(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const snapshot = await db.collection("paymentEntries")
      .where("escrowStatus", "==", "Held")
      .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(sevenDaysAgo))
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ message: "No expired escrows found." });
    }

    const batch = db.batch();
    let updatedCount = 0;

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const reference = docSnap.id;
      const ownerId = data.receiverID;

      const globalRef = db.collection("paymentEntries").doc(reference);
      batch.update(globalRef, { escrowStatus: "Move_In_Confirmed" });

      if (ownerId) {
        const ownerTxRef = db.doc(`payments/${ownerId}/transactions/${reference}`);
        batch.update(ownerTxRef, { escrowStatus: "Move_In_Confirmed" });
      }

      updatedCount++;
    });

    await batch.commit();

    return res.status(200).json({ message: `Successfully released ${updatedCount} escrows.` });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}