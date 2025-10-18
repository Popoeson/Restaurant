// server.js
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import axios from "axios"; // for verifying Paystack and sending Termii requests

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

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

// ====== Verify Paystack Payment + Send SMS ======
app.post("/api/payment/verify", async (req, res) => {
  try {
    const { reference, orderData } = req.body;

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });

    const data = response.data.data;

    if (data.status === "success") {
      // ✅ Save order
      const newOrder = new Order({
        name: orderData.name,
        email: orderData.email,
        phone: orderData.phone,
        address: orderData.address,
        junction: orderData.junction,
        items: orderData.items,
        totalAmount: orderData.totalAmount,
        reference,
        status: "paid",
      });

      await newOrder.save();

      // ✅ Send SMS using Termii
      const smsMessage = `Hello ${orderData.name}, your order has been received successfully! 🍴
Order ID: ${reference}.
Keep this ID safe — your dispatcher will confirm it at delivery.`;

      const smsPayload = {
        to: orderData.phone,
        from: TERMII_SENDER_ID,
        sms: smsMessage,
        type: "plain",
        api_key: TERMII_API_KEY,
        channel: "generic",
      };

      try {
        const smsResponse = await axios.post(TERMII_API_URL, smsPayload);
        console.log("📩 SMS sent:", smsResponse.data);
      } catch (smsErr) {
        console.error("❌ Error sending SMS:", smsErr.message);
      }

      res.json({ success: true, message: "Payment verified, order saved & SMS sent", order: newOrder });
    } else {
      res.status(400).json({ success: false, message: "Payment not successful" });
    }
  } catch (err) {
    console.error("❌ Payment verification error:", err.message);
    res.status(500).json({ success: false, message: "Error verifying payment", error: err.message });
  }
});

// ====== Get All Orders (Admin use) ======
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching orders", error: err });
  }
});

// ====== Server Start ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
