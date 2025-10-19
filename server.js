// server.js
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// === Create HTTP + Socket.IO server ===
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Make io available globally
global.io = io;

// === MongoDB Connection ===
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// === Cloudinary Config ===
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// === Multer Setup ===
const upload = multer({ dest: "uploads/" });

// ====== ENV CONFIG ======
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_KEY = process.env.ONESIGNAL_REST_KEY;

// ====== SCHEMAS ======
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

// === SOCKET.IO ===
io.on("connection", (socket) => {
  console.log("⚡ Client connected:", socket.id);
  socket.on("disconnect", () => console.log("❌ Client disconnected:", socket.id));
});

// =======================
// ===== MENU ROUTES =====
// =======================

// GET all menu
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
      const result = await cloudinary.uploader.upload(req.file.path, { folder: "tastybite_menu" });
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
      const result = await cloudinary.uploader.upload(req.file.path, { folder: "tastybite_menu" });
      updateData.imageUrl = result.secure_url;
      fs.unlinkSync(req.file.path);
    }

    const updated = await Menu.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ message: "Menu item updated", item: updated });
  } catch (err) {
    res.status(500).json({ message: "Error updating item", error: err });
  }
});

// GET single menu item
app.get("/api/menu/:id", async (req, res) => {
  try {
    const item = await Menu.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: "Error fetching item", error: err });
  }
});

// DELETE menu
app.delete("/api/menu/:id", async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting item", error: err });
  }
});

// ===============================
// ===== PAYMENT VERIFICATION =====
// ===============================
app.post("/api/payment/verify", async (req, res) => {
  try {
    const { reference, orderData } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: "Missing payment reference" });
    }

    console.log("🔎 Verifying Paystack reference:", reference);

    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const paymentData = verifyRes.data.data;
    if (!paymentData) {
      return res.status(400).json({ success: false, message: "Invalid verification response" });
    }

    if (paymentData.status === "success") {
      const newOrder = new Order({
        ...orderData,
        reference,
        totalAmount: paymentData.amount / 100,
        status: "paid",
      });

      await newOrder.save();
      console.log("✅ Payment verified and order saved:", newOrder.reference);

      // === Send OneSignal notification ===
      try {
        await axios.post(
          "https://onesignal.com/api/v1/notifications",
          {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: "🍴 New Order Received!" },
            contents: { en: `Order from ${newOrder.name} — ₦${newOrder.totalAmount.toLocaleString()}` },
            included_segments: ["All"],
            url: "https://tastybite.vercel.app/admin-dashboard.html",
          },
          {
            headers: {
              Authorization: `Basic ${ONESIGNAL_REST_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log("📢 OneSignal notification sent");
      } catch (err) {
        console.error("❌ OneSignal notification failed:", err.message);
      }

      // === Emit real-time order event ===
      io.emit("newOrder", {
        customer: newOrder.name,
        totalAmount: newOrder.totalAmount,
        reference: newOrder.reference,
        time: newOrder.createdAt,
      });

      return res.json({
        success: true,
        message: "Payment verified successfully",
        order: newOrder,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment not successful on Paystack",
      });
    }
  } catch (err) {
    console.error("💥 Payment verification error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Error verifying payment. Please try again.",
      error: err.message,
    });
  }
});

// =======================
// ===== ORDER ROUTES =====
// =======================
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching orders", error: err });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await Order.findOne({ reference: req.params.id });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Error fetching order", error: err });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully", deletedOrder });
  } catch (err) {
    res.status(500).json({ message: "Error deleting order", error: err });
  }
});

// === ADMIN STATS ===
app.get("/api/admin/stats", async (req, res) => {
  try {
    const orders = await Order.find();
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const pendingOrders = orders.filter(o => o.status === "pending").length;
    const processingOrders = orders.filter(o => o.status === "processing").length;
    const recentOrders = orders.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

    res.json({ totalOrders, totalRevenue, pendingOrders, processingOrders, recentOrders });
  } catch (err) {
    res.status(500).json({ message: "Error fetching stats", error: err });
  }
});

// ======================
// === START SERVER ====
// ======================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
