// server.js
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import axios from "axios";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// ====== OneSignal Notification Helper ======
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID; 
const ONESIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

async function sendOneSignalNotification(title, message) {
  try {
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: message },
      included_segments: ["Subscribed Users"],
    };
    const response = await axios.post("https://onesignal.com/api/v1/notifications", payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${ONESIGNAL_REST_KEY}`,
      },
    });
    console.log("✅ OneSignal notification sent:", response.data);
  } catch (err) {
    console.error("❌ Error sending OneSignal notification:", err.message);
  }
}

// ====== MongoDB Connection ======
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ====== Cloudinary Config ======
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ====== PAYSTACK CONFIG ======
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// ====== TERMII CONFIG ======
const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || "TastyBite";
const TERMII_API_URL = "https://api.ng.termii.com/api/sms/send";

// ====== Multer Setup ======
const upload = multer({ dest: "uploads/" });

// ====== Menu Schema ======
const menuSchema = new mongoose.Schema({
  name: String,
  description: String,
  category: [String],
  price: Number,
  imageUrl: String,
  featured: Boolean,
  createdAt: { type: Date, default: Date.now },
});
const Menu = mongoose.model("Menu", menuSchema);

// ====== Order Schema ======
const orderSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  address: String,
  junction: String,
  items: Array,
  totalAmount: Number,
  reference: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
});
const Order = mongoose.model("Order", orderSchema);

// ====== ROUTES ======

// GET all menu items
app.get("/api/menu", async (req, res) => {
  try {
    const menu = await Menu.find().sort({ createdAt: -1 });
    res.json(menu);
  } catch (err) {
    res.status(500).json({ message: "Error fetching menu", error: err });
  }
});

// POST new menu item
app.post("/api/menu", upload.single("image"), async (req, res) => {
  try {
    const { name, description, category, price, featured } = req.body;
    let imageUrl = "";

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "tastybite_menu",
      });
      imageUrl = result.secure_url;
      fs.unlinkSync(req.file.path);
    }

    const categories = Array.isArray(category) ? category : JSON.parse(category);

    const newItem = new Menu({
      name,
      description,
      category: categories,
      price,
      imageUrl,
      featured: featured === "Yes" || featured === "true",
    });

    await newItem.save();
    res.json({ message: "Menu item added successfully", item: newItem });
  } catch (err) {
    res.status(500).json({ message: "Error adding menu item", error: err });
  }
});

// PUT update menu item
app.put("/api/menu/:id", upload.single("image"), async (req, res) => {
  try {
    const { name, description, category, price, featured } = req.body;
    const categories = Array.isArray(category) ? category : JSON.parse(category);

    const updateData = {
      name,
      description,
      category: categories,
      price,
      featured: featured === "Yes" || featured === "true",
    };

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "tastybite_menu",
      });
      updateData.imageUrl = result.secure_url;
      fs.unlinkSync(req.file.path);
    }

    const updated = await Menu.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ message: "Menu item updated", item: updated });
  } catch (err) {
    res.status(500).json({ message: "Error updating item", error: err });
  }
});

// GET single menu item by ID
app.get("/api/menu/:id", async (req, res) => {
  try {
    const item = await Menu.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: "Error fetching item", error: err });
  }
});

// DELETE menu item
app.delete("/api/menu/:id", async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting item", error: err });
  }
});

// ====== Create HTTP server & Socket.IO ======
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  console.log("⚡ Admin connected via WebSocket:", socket.id);
  socket.on("disconnect", () => console.log("⚡ Admin disconnected:", socket.id));
});

function notifyAdminsNewOrder(order) {
  io.emit("newOrder", {
    orderId: order.reference,
    customer: order.name,
    amount: order.totalAmount,
    status: order.status,
    createdAt: order.createdAt,
  });
}

// ====== Verify Paystack Payment + Save Order + Notify ======
app.post("/api/payment/verify", async (req, res) => {
  try {
    const { reference, orderData } = req.body;

    // Validate request body
    if (!reference || !orderData) {
      return res.status(400).json({ success: false, message: "Missing payment reference or order data." });
    }

    console.log("🔎 Verifying Paystack reference:", reference);

    // 1️⃣ Verify payment with Paystack
    const verifyRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` },
    });

    if (!verifyRes.data || !verifyRes.data.status) {
      console.error("⚠️ Paystack verification failed:", verifyRes.data);
      return res.status(400).json({ success: false, message: "Invalid Paystack response" });
    }

    const payment = verifyRes.data.data;

    if (payment.status !== "success") {
      console.log("❌ Payment not successful for reference:", reference);
      return res.status(400).json({ success: false, message: "Payment not successful" });
    }

    console.log("✅ Payment verified successfully for:", payment.customer.email);

    // 2️⃣ Save order to database
    const order = new Order({
      name: orderData.name,
      email: orderData.email,
      phone: orderData.phone,
      address: orderData.address,
      junction: orderData.junction,
      items: orderData.items,
      totalAmount: orderData.totalAmount,
      reference,
      paymentStatus: "Paid",
      paymentChannel: payment.channel,
      createdAt: new Date(),
    });

    await order.save();
    console.log("🧾 Order saved:", order._id);

    // 3️⃣ Send SMS notification (Termii)
    try {
      await axios.post("https://api.ng.termii.com/api/sms/send", {
        to: order.phone,
        from: "TASTY",
        sms: `Hi ${order.name}, your order (${reference}) has been received successfully! 🍴`,
        type: "plain",
        channel: "generic",
        api_key: process.env.TERMII_API_KEY,
      });
      console.log("📱 SMS sent to:", order.phone);
    } catch (smsErr) {
      console.error("❌ Failed to send SMS:", smsErr.message);
    }

    // 4️⃣ Send OneSignal Notification (optional)
    try {
      await axios.post(
        "https://onesignal.com/api/v1/notifications",
        {
          app_id: process.env.ONESIGNAL_APP_ID,
          included_segments: ["All"],
          headings: { en: "New Order Received 🍔" },
          contents: { en: `${order.name} just placed an order (₦${order.totalAmount.toLocaleString()})` },
        },
        { headers: { Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}` } }
      );
      console.log("🔔 OneSignal notification sent.");
    } catch (notifErr) {
      console.error("❌ OneSignal error:", notifErr.message);
    }

    // 5️⃣ Emit real-time update via WebSocket (if using socket.io)
    if (global.io) {
      global.io.emit("new-order", order);
      console.log("📡 WebSocket: new order broadcasted.");
    }

    // 6️⃣ Send success response to frontend
    res.json({
      success: true,
      message: "Payment verified and order saved successfully",
      orderId: order._id,
    });
  } catch (err) {
    console.error("💥 Payment verification error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error verifying payment",
      error: err.message,
    });
  }
});

// ====== Get All Orders ======
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching orders", error: err });
  }
});

// Get single order by reference
app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await Order.findOne({ reference: req.params.id });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Delete an order by ID
app.delete("/api/orders/:id", async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully", deletedOrder });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ message: "Server error deleting order" });
  }
});

// Get admin stats
app.get("/api/admin/stats", async (req, res) => {
  try {
    const orders = await Order.find();
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const pendingOrders = orders.filter(o => o.status === "pending").length;
    const processingOrders = orders.filter(o => o.status === "processing").length;
    const recentOrders = orders
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    res.json({ totalOrders, totalRevenue, pendingOrders, processingOrders, recentOrders });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ message: "Server error" });
  }
});

//======= Save Admin Player ID======
app.post("/api/admin/save-player-id", async (req, res) => {
  try {
    const { playerId } = req.body;
    if (!req.session.adminId) return res.status(401).json({ message: "Not logged in" });

    await Admin.findByIdAndUpdate(req.session.adminId, { oneSignalPlayerId: playerId }, { new: true });
    res.json({ success: true, message: "Player ID saved" });
  } catch (err) {
    console.error("❌ Error saving player ID:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====== Start Server ======
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
