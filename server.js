// server.js
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// ====== MongoDB Connection ======
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB error:", err));

// ====== Cloudinary Config ======
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ====== Multer Setup ======
const upload = multer({ dest: "uploads/" });

// ====== Menu Schema ======
const menuSchema = new mongoose.Schema({
  name: String,
  description: String,
  category: String, // Food, Snacks, Extras, Drinks, Shawarma, Asun
  price: Number,
  imageUrl: String,
  featured: Boolean,
  createdAt: { type: Date, default: Date.now },
});

const Menu = mongoose.model("Menu", menuSchema);

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

// POST new menu item (with image upload)
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

    const newItem = new Menu({
      name,
      description,
      category,
      price,
      imageUrl,
      featured: featured === "true",
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
    const updateData = { name, description, category, price, featured: featured === "true" };

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

// DELETE menu item
app.delete("/api/menu/:id", async (req, res) => {
  try {
    await Menu.findByIdAndDelete(req.params.id);
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting item", error: err });
  }
});

// ====== Server Start ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
