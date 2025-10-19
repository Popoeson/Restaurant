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

// Make io available globally (optional but handy)
global.io = io;

// === Mongoose Connection ===
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

// ====== PAYSTACK CONFIG ======
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

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

// === Order Schema ===
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

// === SOCKET.IO CONNECTION ===
io.on("connection", (socket) => {
  console.log("⚡ A client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

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

// === PAYSTACK PAYMENT VERIFICATION ===
app.post("/api/verify-payment", async (req, res) => {
  try {
    const { reference, orderDetails } = req.body;
    console.log("🔍 Verifying Paystack reference:", reference);

    // Verify payment
    const verifyRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const paymentData = verifyRes.data.data;

    if (paymentData.status === "success") {
      // Save order
      const newOrder = new Order({
        ...orderDetails,
        reference,
        totalAmount: paymentData.amount / 100,
        status: "paid",
      });

      await newOrder.save();

      console.log("✅ Payment verified and order saved:", newOrder);

      // === EMIT SOCKET EVENT ===
      io.emit("newOrder", {
        customer: newOrder.name,
        totalAmount: newOrder.totalAmount,
        reference: newOrder.reference,
        time: newOrder.createdAt,
      });

      res.json({ message: "Payment verified successfully", order: newOrder });
    } else {
      res.status(400).json({ message: "Payment verification failed" });
    }
  } catch (err) {
    console.error("💥 Payment verification error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
});

// === GET ALL ORDERS (for admin) ===
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


// === START SERVER ===
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
