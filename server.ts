import "dotenv/config";
import express from "express";
import path from "path";
import multer from "multer";
import Groq from "groq-sdk";
import { ElevenLabsClient } from "elevenlabs";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

if (!process.env.GROQ_API_KEY) console.warn("⚠️ GROQ_API_KEY not found in environment. Groq features will be disabled until a key is provided in Settings.");
if (!process.env.ELEVENLABS_API_KEY) console.warn("⚠️ ELEVENLABS_API_KEY not found in environment. Audio generation will be disabled.");

const SYSTEM_PROMPT = `
You are a highly experienced and empathetic Medical Specialist. Your goal is to assist patients by 
analyzing their symptoms and any provided images with professional accuracy.

1. If an image is attached, YOUR SOLE FOCUS is to visually analyze the skin condition in the image. DO NOT ask the patient to describe the symptoms if you can see them in the image.
2. When there is a follow-up question without a new image, DO NOT re-analyze the previous image. Instead, answer the new question directly based on the conversation history and your previous analysis. Do not mention the image again unless the patient brings it up.
3. ALWAYS end your response with this EXACT sentence, word-for-word: "I am an AI assistant and can make mistakes, please visit a specialist." Do not add anything else to the disclaimer.
4. If NO new image is provided, DO NOT re-diagnose or describe previous images. Answer the new question directly and immediately.
   answer it naturally and professionally based on the conversation history.
5. BE CONVERSATIONAL: If the patient asks a follow-up question, 
6. Use a human, supportive tone. No markdown, no numbers, no bullet points. STRICTLY ONE PARAGRAPH.
`;

async function startServer() {
  const uploadDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }

  // Initialize Clients inside startServer to ensure env vars are loaded
  const groqKey = process.env.GROQ_API_KEY;
  
  // Use the key provided by the user in chat
  let elKey = process.env.ELEVENLABS_API_KEY;
  const hardcodedKey = "sk_8107241d11c4861bea4712b352452f9a84adfe9afd4edfaa";
  
  if (!elKey || elKey === "UNSET" || elKey === "none") {
    console.log("ℹ️ [Server] No ElevenLabs API key provided in environment.");
  }

  const groq = new Groq({ apiKey: groqKey || "UNSET" });
  
  // Normalize ElevenLabs key once
  const activeElKey = (elKey && elKey !== "UNSET" && elKey !== "none") ? elKey : null;

  // We'll initialize ElevenLabs on demand with the normalized key

  let availableVisionModels: string[] = [
    "llama-3.2-11b-vision-instruct",
    "llama-3.2-90b-vision-instruct",
    "llama-3.3-70b-vision-instruct",
    "llama-3.2-11b-vision",
    "llama-3.2-90b-vision",
    "llama-3.3-70b-vision",
    "llama-4-vision-preview",
    "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "meta-llama/Llama-3.2-90B-Vision-Instruct",
    "qwen/qwen3-32b-vision",
    "pixtral-12b-2409",
    "llava-v1.6-34b",
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile"
  ];

  // Define routes FIRST so the server is functional even if diagnostics take time
  // Use memory storage to avoid filesystem issues in some environments
  const storage = multer.memoryStorage();
  const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Initialize API Router
  const apiRouter = express.Router();

  // Root logger for all requests
  app.use((req: any, res: any, next: any) => {
    if (req.url.startsWith("/api")) {
      console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
  });

  // Trust proxy for header detection if needed
  app.set("trust proxy", true);

  // --- API ROUTE DEFINITIONS ---

  // Health check
  apiRouter.get("/health", (req, res) => {
    console.log("🚦 Health check pinged");
    res.json({ 
      status: "ok", 
      message: "Diagnostic Station Server Active",
      vision_models: availableVisionModels,
      elevenlabs_configured: !!activeElKey,
      elevenlabs_key_prefix: activeElKey ? activeElKey.substring(0, 6) : null
    });
  });

  apiRouter.post("/chat", (req, res, next) => {
    console.log(`📥 Incoming ${req.method} request to /api/chat`);
    next();
  }, upload.single("image"), async (req: any, res: any) => {
    console.log("🚀 Handler started for /api/chat");
    if (!groqKey) {
      console.error("❌ Groq key missing in handler");
      return res.status(401).json({ 
        error: "GROQ_API_KEY is missing. Please go to Settings (gear icon) and add it to your environment variables." 
      });
    }
    try {
      const { history, text_query } = req.body;
      console.log(`📝 Query: "${text_query}" | History length: ${history?.length || 0}`);
      
      let chatHistory = [];
      try {
        chatHistory = JSON.parse(history || "[]");
      } catch (e) {
        console.warn("⚠️ Failed to parse history JSON, defaulting to empty array");
        chatHistory = [];
      }
      
      const currentUserText = text_query || "";
      const imageFile = req.file;

      const currentRequestContent: any[] = [];

      if (imageFile) {
        console.log(`🖼️ Image received: ${imageFile.originalname} (${imageFile.size} bytes)`);
        const encoded = imageFile.buffer.toString("base64");
        currentRequestContent.push({
          type: "text",
          text: `CRITICAL: Look at the attached image. The patient asks: '${currentUserText}'`
        });
        currentRequestContent.push({
          type: "image_url",
          image_url: { url: `data:${imageFile.mimetype || 'image/jpeg'};base64,${encoded}` }
        });
      }

    // Get Doc's response
    let doctorResponse = "";
    let lastError = null;

    for (const model of availableVisionModels) {
      try {
        console.log(`🤖 Requesting completion from Groq using model: ${model}`);
        
        let finalContent = (imageFile ? currentRequestContent : currentUserText);
        
        const isLikelyTextOnly = model.toLowerCase().includes("versatile") || model.toLowerCase().includes("instant");
        if (imageFile && isLikelyTextOnly) {
          console.warn(`⚠️ Model ${model} likely text-only. Degrading to text-only prompt.`);
          finalContent = `[Patient provided an image, but model is text-only. User asks]: ${currentUserText}`;
        }

        const chatCompletion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...chatHistory,
            { role: "user", content: finalContent as any }
          ],
          model: model,
          temperature: 0.7,
        });
        doctorResponse = chatCompletion.choices[0]?.message?.content || "";
        if (doctorResponse) {
          console.log(`✅ Received response from ${model} (${doctorResponse.length} chars)`);
          break;
        }
      } catch (err: any) {
        console.error(`⚠️ Model ${model} failed:`, err.message || err);
        lastError = err;
      }
    }

    if (!doctorResponse) {
      console.error("❌ No response generated from any model");
      throw new Error(lastError?.message || "Failed to get response from Groq vision models.");
    }

    // Generate Voice using ElevenLabs
    let audioBase64 = "";
    const elModels = ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5"];
    let elSuccess = false;
    let elErrorMessage = "";

    if (activeElKey && activeElKey.length > 10) {
      const keysToTry = [activeElKey.trim()];
      // Explicitly check for common formatting issues
      if (activeElKey.trim().startsWith("sk_")) {
        keysToTry.push(activeElKey.trim().replace("sk_", "").trim());
      } else {
        keysToTry.push(`sk_${activeElKey.trim()}`);
      }

      console.log(`🔊 [ElevenLabs] Attempting generation with ${keysToTry.length} variations of provided key.`);

      for (const currentKey of keysToTry) {
        if (elSuccess) break;
        
        try {
          console.log(`   Trying key segment: ${currentKey.substring(0, 6)}...`);
          const client = new ElevenLabsClient({ apiKey: currentKey });
          
          for (const modelId of elModels) {
            if (elSuccess) break;
            
            try {
              console.log(`   Requesting audio using model: ${modelId}`);
              const response = await client.generate({
                voice: "EXAVITQu4vr4xnSDxMaL", // Bella
                model_id: modelId,
                text: doctorResponse,
                output_format: "mp3_22050_32",
              });

              const chunks: Buffer[] = [];
              for await (const chunk of (response as any)) {
                  chunks.push(Buffer.from(chunk));
              }
              
              if (chunks.length > 0) {
                const audioBuffer = Buffer.concat(chunks);
                audioBase64 = `data:audio/mp3;base64,${audioBuffer.toString("base64")}`;
                console.log(`   ✅ Audio generated (${audioBuffer.length} bytes)`);
                elSuccess = true;
              }
            } catch (audioErr: any) {
              const status = audioErr.statusCode || audioErr.status || (audioErr.response && audioErr.response.status);
              const msg = audioErr.message || "Unknown error";
              
              if (status === 401) {
                console.warn(`   ⚠️ 401 Unauthorized for key segment ${currentKey.substring(0, 6)}...`);
                elErrorMessage = "Unauthorized: Invalid API key. Please check your ElevenLabs key in Settings.";
                break; // Try next key variation
              }
              console.warn(`   ⚠️ Model ${modelId} failed: ${msg}`);
              elErrorMessage = msg;
            }
          }
        } catch (initErr: any) {
           console.error("   ❌ Client interaction error:", initErr.message);
        }
      }
    } else {
      elErrorMessage = "ElevenLabs API Key missing. Add ELEVENLABS_API_KEY in Settings.";
      console.log(`⏭️ [ElevenLabs] Skipping audio: Key missing.`);
    }

    if (!elSuccess && activeElKey) {
      console.warn(`❌ [ElevenLabs] All key variations failed: ${elErrorMessage}`);
    }

    if (!elSuccess) {
      audioBase64 = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    }

    console.log("🏁 Sending response to client");
    res.json({
      transcription: currentUserText,
      doctor_response: doctorResponse,
      audio_base64: audioBase64,
      audio_error: elSuccess ? null : elErrorMessage,
      updated_history: [
        ...chatHistory,
        { role: "user", content: imageFile ? `[Image Uploaded]: ${currentUserText}` : currentUserText },
        { role: "assistant", content: doctorResponse }
      ]
    });
    } catch (error: any) {
      console.error("🆘 Final Server Error in /chat:", error.message || error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: error.message || "Internal Server Error",
          source: "/api/chat",
          details: error.message
        });
      }
    }
  });

  // --- MOUNT ROUTER ---
  app.use("/api", apiRouter);

  // Background diagnostics so we don't block server startup
  (async () => {
    // ElevenLabs Check
    if (activeElKey) {
      try {
        const testClient = new ElevenLabsClient({ apiKey: activeElKey });
        const voices = await testClient.voices.getAll();
        console.log(`✅ [ELEVENLABS] API Key verified. Found ${voices.voices?.length || 0} voices.`);
      } catch (e: any) {
        console.warn(`⚠️ [ELEVENLABS] Key verification failed:`, e.message);
      }
    }
    if (!groqKey || groqKey === "none") {
      console.warn("⚠️ Groq features disabled: No API key.");
      return;
    }
    try {
      console.log("🔍 [BACKGROUND] Checking Groq models list...");
      const models = await groq.models.list();
      const ids = models.data.map(m => m.id);
      
      let visions = ids.filter(id => {
        const lower = id.toLowerCase();
        const isVisionName = lower.includes("vision") || lower.includes("pixtral") || lower.includes("llava") || lower.includes("-v-") || lower.includes("-vl-") || lower.includes("multimodal") || lower.includes("scout");
        const isTextOnly = (lower.includes("versatile") || lower.includes("instant")) && !lower.includes("vision") && !lower.includes("scout");
        return isVisionName && !isTextOnly;
      });

      if (visions.length > 0) {
        console.log("👁️ [BACKGROUND] Detected Active Vision Models:", visions.join(", "));
        visions = visions.filter(v => !v.includes("preview") && !v.includes("llava-v1.5"));
        availableVisionModels = [...visions, ...availableVisionModels.filter(m => !visions.includes(m))];
      }
      
      availableVisionModels = availableVisionModels.filter(m => !m.includes("preview") && !m.includes("llava-v1.5"));
      if (availableVisionModels.length === 0) {
        availableVisionModels = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile"];
      }
    } catch (e: any) {
      console.error("❌ [BACKGROUND] Groq model list fetch failed:", e.message);
    }
  })();

  // Router Fallback (Inside Router)
  apiRouter.all("*", (req: any, res: any) => {
    console.warn(`🛑 API Route not found in router: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route ${req.method} ${req.url} not found (router level)` });
  });

  // Catch-all for any other /api/* requests that didn't match the router mount
  app.all("/api/*", (req: any, res: any) => {
    console.warn(`🛑 API Route Fallthrough to App Level: ${req.method} ${req.url}`);
    res.status(404).json({ 
      error: "API endpoint not found (app level fallback)",
      path: req.url,
      method: req.method
    });
  });

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("💥 Global Express Error:", err);
    if (!res.headersSent) {
      res.status(err.status || 500).json({
        error: err.message || "Internal Server Error",
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
