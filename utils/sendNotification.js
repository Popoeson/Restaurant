// utils/sendNotification.js
import axios from "axios";

export const sendNotification = async (title, message, url = "https://tastybite.vercel.app/admin-dashboard.html") => {
  try {
    const res = await axios.post(
      "https://onesignal.com/api/v1/notifications",
      {
        app_id: process.env.ONESIGNAL_APP_ID,
        included_segments: ["All"], // send to all subscribed users
        headings: { en: title },
        contents: { en: message },
        url,
      },
      {
        headers: {
          Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Notification sent:", res.data.id);
  } catch (err) {
    console.error("❌ Error sending notification:", err.response?.data || err.message);
  }
};
