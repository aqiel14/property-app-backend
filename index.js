import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL, // e.g. "https://property-app-amber.vercel.app"
];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (e.g. mobile apps, curl, or same-origin)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const upload = multer({ storage: multer.memoryStorage() });

// app.post("/api/send-login-link", async (req, res) => {
//   const { email } = req.body;
//   if (!email) return res.status(400).json({ error: "Email is required" });
//   console.log("✨ FRONTEND_URL is:", process.env.FRONTEND_URL);

//   const { error } = await supabase.auth.signInWithOtp({
//     email,
//     options: { emailRedirectTo: `${process.env.FRONTEND_URL}/dashboard` },
//   });

//   if (error) return res.status(400).json({ error: error.message });
//   res.json({ message: "Check your email for the magic link." });
// });

app.post("/api/send-login-link", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  console.log("✨ FRONTEND_URL:", process.env.FRONTEND_URL);

  const { error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    redirectTo: `${process.env.FRONTEND_URL}/dashboard`,
  });

  if (error) {
    console.error("Magic link error:", error);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "Check your email for the magic link." });
});

app.get("/api/properties", async (req, res) => {
  try {
    const { data, error } = await supabase.from("properties").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user)
      return res.status(401).json({ error: "Invalid token" });

    req.user = data.user;
    next();
  } catch (err) {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.post(
  "/api/properties",
  authenticate,
  upload.single("image"),
  async (req, res) => {
    try {
      const { title, price, lat, lng } = req.body;
      const userId = req.user.id;

      let imageUrl = "";

      if (req.file) {
        const fileExt = req.file.originalname.split(".").pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `public/${fileName}`;

        // Upload buffer to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("property-images")
          .upload(filePath, req.file.buffer, {
            contentType: req.file.mimetype,
          });

        if (uploadError) {
          return res
            .status(500)
            .json({ error: "Image upload failed: " + uploadError.message });
        }

        const { data: publicUrlData } = supabase.storage
          .from("property-images")
          .getPublicUrl(filePath);

        imageUrl = publicUrlData.publicUrl;
      }

      const newProperty = {
        user_id: userId,
        title,
        price: price ? parseInt(price) : null,
        image_url: imageUrl,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
      };

      const { data, error } = await supabase
        .from("properties")
        .insert([newProperty])
        .select();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ message: "Property added", property: data[0] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get a single property
app.get("/api/properties/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return res.status(404).json({ error: "Property not found" });
  res.json(data);
});

// Update a property
app.put("/api/properties/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, price } = req.body;
  const { data, error } = await supabase
    .from("properties")
    .update({ title, price })
    .eq("id", id)
    .select();
  if (error) {
    console.log("data", data);
    return res.status(500).json({ error: `ERROR::::${error.message}` });
  }
  res.json(data[0]);
});

app.delete("/api/properties/:id", authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id; // from authenticate middleware

  // Optional: check ownership if needed
  const { data: existing, error: findError } = await supabase
    .from("properties")
    .select("user_id")
    .eq("id", id)
    .single();

  if (findError || !existing) {
    return res.status(404).json({ error: "Property not found" });
  }
  if (existing.user_id !== userId) {
    return res
      .status(403)
      .json({ error: "Not authorized to delete this property" });
  }

  const { error } = await supabase.from("properties").delete().eq("id", id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ message: "Property deleted" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
