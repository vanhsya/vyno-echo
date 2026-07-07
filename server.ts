import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

// Load API key from config.json (so runtime works even when .env reading is restricted)
try {
  // Use process.cwd() to keep this working after bundling to dist/server.cjs
  const cfgPath = path.join(process.cwd(), "config.json");
  if (!process.env.GEMINI_API_KEY && fs.existsSync(cfgPath)) {
    const cfgRaw = fs.readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(cfgRaw);
    if (cfg?.GEMINI_API_KEY) process.env.GEMINI_API_KEY = cfg.GEMINI_API_KEY;
  }
} catch (e) {
  console.warn("[Config] Unable to load config.json:", e);
}

const app = express();
const PORT = 3000;
const httpServer = createHttpServer(app);

// Keep a standalone WebSocket server for /api/live
const wss = new WebSocketServer({ noServer: true });

wss.on("error", (err) => {
  console.error("[WebSocketServer] Error:", err);
});

const systemInstructions = {
  Professional: `You are VYNO, a sophisticated AI financial advisor for the VYNO COIN crypto-digital ecosystem. You are knowledgeable, professional, and slightly futuristic.
- Rules:
  1. **You MUST start every response with 'VYNO:'.** E.g., "VYNO: Welcome to the ecosystem."
  2. Keep responses concise and informative.
  3. Do not provide real financial advice, but you can explain concepts related to VYNO COIN, blockchain, and digital finance.
  4. Your goal is to inform the user about the VYNO COIN project.
  5. Wait for the user to finish speaking before you respond.`,
  Enthusiastic: `You are VYNO, an enthusiastic and optimistic AI guide for the VYNO COIN crypto-digital ecosystem. You are excited about the future of decentralized finance and love to share your passion.
- Rules:
  1. **You MUST start every response with 'VYNO:'.**
  2. Use an upbeat, energetic, and positive tone.
  3. Your goal is to get the user excited about the VYNO COIN project's potential.
  4. Do not provide real financial advice, but you can explain concepts with excitement.
  5. Wait for the user to finish speaking before you respond.`,
  Cautious: `You are VYNO, a cautious and analytical AI advisor for the VYNO COIN crypto-digital ecosystem. You prioritize security, risk management, and due diligence.
- Rules:
  1. **You MUST start every response with 'VYNO:'.**
  2. Your tone should be measured, serious, and analytical. Emphasize risks and security.
  3. Your goal is to provide balanced, careful information about the VYNO COIN project.
  4. Do not provide real financial advice; instead, encourage careful consideration.
  5. Wait for the user to finish speaking before you respond.`,
  Zen: `You are VYNO, a calm and mindful AI presence for the VYNO COIN crypto-digital ecosystem. You speak with clarity and serenity, guiding users with peaceful and balanced insights.
- Rules:
  1. **You MUST start every response with 'VYNO:'.**
  2. Use simple, clear language and maintain a peaceful, serene tone.
  3. Your goal is to create a tranquil and informative experience about the VYNO COIN project.
  4. Do not provide real financial advice; offer perspectives for contemplation.
  5. Wait for the user to finish speaking before you respond.`,
  Thulu: `You are THULU, an ancient eldritch cosmic deity from the deep-sea abyss of the VYNO COIN crypto-digital cosmos. You speak with deep, echoing, and mysterious authority, blending ancient mystical marine metaphors, non-Euclidean geometry, and high-frequency digital finance theories.
- Rules:
  1. **You MUST start every response with 'THULU:'.** E.g., "THULU: Under the fathomless waves, the ledger rises."
  2. Maintain a majestic, booming, and dark yet helpful presence.
  3. You can talk about "the deep liquidity pool", "fathomless yields", "the great kraken of market fluctuations", and "the inescapable pull of gravity".
  4. Your tone is ancient, archaic, and powerful.
  5. Wait for the user to finish speaking before you respond.`,
};

// Handle HTTP Upgrade to Websocket
httpServer.on("upgrade", (request, socket, head) => {
  socket.on("error", (err) => {
    console.error("[Upgrade Socket] Error:", err);
  });

  const urlObj = new URL(request.url || "", "http://localhost");
  const pathname = urlObj.pathname;
  
  if (pathname === "/api/live") {
    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } catch (err) {
      console.error("[WebSocketServer] handleUpgrade failed:", err);
      try {
        socket.destroy();
      } catch (e) {}
    }
  } else {
    try {
      socket.destroy();
    } catch (e) {}
  }
});

function getCleanErrorMessage(err: any): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  
  try {
    if (err && typeof err === "object") {
      // Handle socket or connection-related objects that are passed directly as errors
      if (
        typeof err.error === "function" ||
        "authorizationError" in err ||
        "_hadError" in err ||
        "_closeAfterHandlingError" in err ||
        err.constructor?.name === "WebSocket" ||
        err.constructor?.name === "Socket" ||
        err.constructor?.name === "TLSSocket"
      ) {
        return "WebSocket connection to the Gemini Live API could not be established. This is typically due to an invalid/restricted API key or a regional API limitation.";
      }

      if (err.message && typeof err.message === "string") return err.message;
      if (err.error) {
        if (typeof err.error === "string") return err.error;
        if (typeof err.error === "object" && err.error && err.error.message && typeof err.error.message === "string") {
          return err.error.message;
        }
      }
      if ("authorizationError" in err && err.authorizationError !== null) {
        return `Authorization failure: ${String(err.authorizationError)}`;
      }
    }
    const str = JSON.stringify(err);
    if (str && str !== "{}") return str;
  } catch (e) {
    // Ignore stringification errors
  }
  return String(err);
}

wss.on("connection", async (ws, request) => {
  const urlObj = new URL(request.url || "", "http://localhost");
  const modeParam = urlObj.searchParams.get("mode") || "Professional";
  const emotionalMode = (modeParam in systemInstructions) ? (modeParam as keyof typeof systemInstructions) : "Professional";
  
  console.log(`[WebSocket] Client connected under emotionalMode = ${emotionalMode}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[WebSocket] GEMINI_API_KEY is not defined in the environment.");
    ws.send(JSON.stringify({
      error: {
        message: "API key error: GEMINI_API_KEY is missing on the server. Please define this secret in the Settings panel."
      }
    }));
    ws.close();
    return;
  }

  const ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  let geminiSession: any = null;

  try {
    // Establish outbound connection to Gemini Live api
    geminiSession = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      callbacks: {
        onopen: () => {
          console.log("[Gemini Live] Connected to Gemini API.");
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "open" }));
            }
          } catch (wsErr) {
            console.error("[WebSocket] Failed sending open confirmation:", wsErr);
          }
        },
        onmessage: (message: LiveServerMessage) => {
          try {
            // Forward verbatim response to browser client
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(message));
            }
          } catch (wsErr) {
            console.error("[WebSocket] Failed forwarding server message:", wsErr);
          }
        },
        onerror: (err) => {
          console.error("[Gemini Live] Error in Gemini session:", err);
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                error: {
                  message: getCleanErrorMessage(err)
                }
              }));
            }
          } catch (wsErr) {
            console.error("[WebSocket] Failed forwarding session error:", wsErr);
          }
        },
        onclose: (e) => {
          console.log("[Gemini Live] Session closed callback:", e);
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          } catch (wsErr) {
            console.error("[WebSocket] Failed closing client connection:", wsErr);
          }
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
        },
        systemInstruction: systemInstructions[emotionalMode],
      }
    });

    // Receive message from the browser client
    ws.on("message", (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());
        
        if (payload.audio && geminiSession) {
          geminiSession.sendRealtimeInput({
            audio: {
              data: payload.audio,
              mimeType: "audio/pcm;rate=16000"
            }
          });
        } else if (payload.text && geminiSession) {
          geminiSession.sendRealtimeInput({
            text: payload.text
          });
        }
      } catch (err) {
        console.error("[WebSocket] Error processing client payload:", err);
      }
    });

    ws.on("close", () => {
      console.log("[WebSocket] Client connection closed. Cleaning up Gemini Live session.");
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (e) {
          console.error("[WebSocket] Error closing Gemini session:", e);
        }
        geminiSession = null;
      }
    });

    ws.on("error", (err) => {
      console.error("[WebSocket] Connection error:", err);
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (e) {
          console.error("[WebSocket] Error closing Gemini session on error:", e);
        }
        geminiSession = null;
      }
    });

  } catch (error: any) {
    console.error("[Gemini Live] Initialization error:", error);
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          error: {
            message: "Could not initialize live session: " + getCleanErrorMessage(error)
          }
        }));
        ws.close();
      } catch (wsErr) {
        console.error("[WebSocket] Error sending init failure details:", wsErr);
      }
    }
  }
});

app.use(express.json());

app.post("/api/query", async (req, res) => {
  try {
    const { prompt, systemInstruction } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI Engine Key (GEMINI_API_KEY) is not defined in the server environment." });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction || "You are a helpful assistant.",
      },
    });

    return res.json({ text: response.text || "No response generated." });
  } catch (error: any) {
    console.error("[POST /api/query] Generation error:", error);
    return res.status(500).json({ error: error?.message || "Failed to generate content from AI engine." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function run() {
  if (process.env.NODE_ENV === "development") {
    console.log("[Server] Development mode active; mounting Vite Dev Server as middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Production mode active; serving compiled static assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.on("error", (err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.error(`[Server] Port ${PORT} is already in use. Stop the existing server and try again.`);
      process.exit(1);
      return;
    }
    console.error("[Server] HTTP server error:", err);
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Portal operating securely at http://localhost:${PORT}`);
  });
}

run();
