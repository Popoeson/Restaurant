
async function sendNewOrderNotification(order) {
  try {
    // 🧩 Debug logs for environment variables
    console.log("🔑 OneSignal Key Exists:", !!process.env.ONESIGNAL_REST_KEY);
    console.log("📱 OneSignal App ID Exists:", !!process.env.ONESIGNAL_APP_ID);

    // ✅ Correct endpoint for OneSignal notifications
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${process.env.ONESIGNAL_REST_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        headings: { en: "New Order Received 🍽️" },
        contents: { en: `Order ${order.reference} from ${order.name}` },
        included_segments: ["All"],
        url: "https://restaurant-plum.vercel.app/admin-dashboard.html"
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log("✅ Push notification sent:", data.id || data);
    } else {
      console.error("❌ OneSignal API error:", data);
    }
  } catch (err) {
    console.error("❌ Error sending notification:", err);
  }
}

export default sendNewOrderNotification;
