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
import sendNewOrderNotification from "./utils/sendNotification.js";


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

//======================
// ====== SCHEMAS ======
//=======================

// =====Menu Schema ========
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

//====== Order Schema ============
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
  dispatchedAt: Date,
  deliveredAt: Date,
  createdAt: { type: Date, default: Date.now },
});
const Order = mongoose.model("Order", orderSchema);

//===== User Schema ======
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  role: {
    type: String,
    enum: ["admin", "dispatcher"],
    default: "dispatcher",
  },
  password: {
    type: String,
    required: true,
  },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);


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
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const paymentData = verifyRes.data.data;
    if (!paymentData) {
      return res.status(400).json({ success: false, message: "Invalid verification response" });
    }

    if (paymentData.status === "success") {
      // ✅ Save new order
      const newOrder = new Order({
        ...orderData,
        reference,
        totalAmount: paymentData.amount / 100,
        status: "paid",
      });

      await newOrder.save();
      console.log("✅ Payment verified and order saved:", newOrder.reference);

      // ✅ Send push notification via OneSignal
      await sendNewOrderNotification(
        "🍔 New Order Received!",
        `A new order has been placed for ₦${newOrder.totalAmount.toLocaleString()}.`,
        "https://tastybite.vercel.app/admin-dashboard.html"
      );

      // ✅ Emit real-time update via Socket.io
      io.emit("newOrder", {
        customer: newOrder.name,
        totalAmount: newOrder.totalAmount,
        reference: newOrder.reference,
        createdAt: newOrder.createdAt,
        status: newOrder.status,
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

// ✅ Update Order Status Route with Timestamp
app.patch("/api/orders/update/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const { status } = req.body;

    const updates = { status };

    // Automatically add timestamps based on status
    if (status.toLowerCase() === "delivered") {
      updates.deliveredAt = new Date();
    } else if (status.toLowerCase() === "dispatched") {
      updates.dispatchedAt = new Date();
    }

    const order = await Order.findOneAndUpdate(
      { reference },
      updates,
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "❌ Order not found" });
    }

    res.json({
      message: `✅ Order ${reference} updated successfully`,
      updatedOrder: order,
    });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});


// =======================
// ===== USERR ROUTES =====
// =======================

// ========REGISTER USER======
app.post("/api/users/register", async (req, res) => {
  try {
    const { name, username, role, password } = req.body;

    if (!name || !username || !role || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const user = new User({ name, username, role, password });
    await user.save();

    res.json({ message: "User registered successfully", user });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ===== USER LOGIN ROUTE =====
app.post("/api/users/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Find the user by username
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Compare password (plain text for now)
    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid password" });
    }

    // Successful login
    res.json({
      message: "✅ Login successful",
      user: {
        name: user.name,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
