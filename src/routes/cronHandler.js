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
    const wpUpdates = []; // Collect WordPress updates

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

      // Collect WordPress property update data
      const propertyId = data.metadata?.propertyId;
      if (propertyId) {
        wpUpdates.push(propertyId);
      }

      updatedCount++;
    });

    await batch.commit();

    // Release properties in WordPress
    const wpUrl = `${process.env.WP_BASE_URL}/wp-json/rummies-wp/v1/update-property`;
    const credentials = Buffer.from(`${process.env.WP_ADMIN_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");

    for (const propertyId of wpUpdates) {
      try {
        const wpPayload = new URLSearchParams();
        wpPayload.append('id', propertyId);
        wpPayload.append('escrow_status', 'available');
        wpPayload.append('escrow_tenant_id', '');
        wpPayload.append('escrow_payment_date', '');
        wpPayload.append('escrow_release_date', '');
        wpPayload.append('occupancy_status', 0);

        const response = await fetch(wpUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: wpPayload
        });

        if (!response.ok) {
          throw new Error(`WordPress responded with status ${response.status}`);
        }

        console.log(`Property ${propertyId} released in WordPress.`);
      } catch (wpErr) {
        console.error(`Error releasing property ${propertyId} in WordPress:`, wpErr.message);
      }
    }

    return res.status(200).json({ message: `Successfully released ${updatedCount} escrows.` });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}