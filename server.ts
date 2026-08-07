import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cors from "cors";
import multer from "multer";
import https from "https";
import NodeMediaServer from "node-media-server";

// Start RTMP server for receiving push cameras
if (process.env.DISABLE_RTMP_SERVER !== "true") {
  try {
    const rtmpPort = parseInt(process.env.RTMP_PORT || "1935", 10);
    const rtmpHttpPort = parseInt(process.env.RTMP_HTTP_PORT || "8000", 10);
    const nms = new NodeMediaServer({
      rtmp: {
        port: rtmpPort,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
      },
      http: {
        port: rtmpHttpPort,
        allow_origin: "*"
      }
    });
    
    // Catch uncaught errors on nms server so EADDRINUSE doesn't crash app
    nms.on('error', (err: any) => {
      console.error("Erro no servidor RTMP (NodeMediaServer):", err?.message || err);
    });

    nms.run();
    console.log(`Servidor RTMP iniciado na porta ${rtmpPort} para recepção de câmeras push`);
  } catch (err: any) {
    console.error("Aviso ao iniciar servidor RTMP:", err?.message || err);
  }
} else {
  console.log("Servidor RTMP interno desativado via DISABLE_RTMP_SERVER=true");
}

// Font downloader for sports scoreboard overlay in FFmpeg
const fontPath = path.join(process.cwd(), "sportsfont.ttf");
if (!fs.existsSync(fontPath)) {
  console.log("Baixando fonte TTF para o overlay do painel...");
  const fontFile = fs.createWriteStream(fontPath);
  https.get("https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/master/resources/ttf/DejaVuSans-Bold.ttf", (response) => {
    response.pipe(fontFile);
    fontFile.on("finish", () => {
      fontFile.close();
      try {
        const stats = fs.statSync(fontPath);
        if (stats.size < 1000) {
          console.error("Fonte baixada é muito pequena ou inválida, removendo...");
          fs.unlinkSync(fontPath);
        } else {
          console.log("Fonte TTF baixada e salva com sucesso.");
        }
      } catch (err) {
        console.error("Erro ao validar tamanho da fonte:", err);
      }
    });
  }).on("error", (err) => {
    console.error("Erro ao baixar fonte TTF:", err.message);
    try { fontFile.close(); fs.unlinkSync(fontPath); } catch (ex) {}
  });
} else {
  try {
    const stats = fs.statSync(fontPath);
    if (stats.size < 1000) {
      console.log("Removendo arquivo de fonte inválido ou corrompido...");
      fs.unlinkSync(fontPath);
    }
  } catch (e) {}
}

const writeSportsFiles = (status: any) => {
  try {
    fs.writeFileSync("./teama.txt", (status.team_a_name || "TIME A").toUpperCase());
    fs.writeFileSync("./teamb.txt", (status.team_b_name || "TIME B").toUpperCase());
    fs.writeFileSync("./scorea.txt", String(status.score_a ?? 0));
    fs.writeFileSync("./scoreb.txt", String(status.score_b ?? 0));
    const mins = Math.floor((status.timer_seconds || 0) / 60);
    const secs = (status.timer_seconds || 0) % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    fs.writeFileSync("./timer.txt", timeStr);
  } catch (err) {
    console.error("Erro ao gravar arquivos do painel esportivo:", err);
  }
};

// Mock Database for Preview (In production, use MySQL)
const DB_FILE = path.join(process.cwd(), "data.json");
let dbCache: any = null;

const initDb = () => {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: [
        { id: 1, username: "admin", password: bcrypt.hashSync("admin123", 10), role: "admin" },
        { id: 2, username: "suporte@unityautomacoes.com.br", password: bcrypt.hashSync("200616", 10), role: "admin" }
      ],
      cameras: [
        { id: 1, name: "Câmera 01", rtsp_url: "rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mp4", is_active: true },
        { id: 2, name: "Câmera 02", rtsp_url: "rtsp://demo:demo@static.cartesian.io:554/live/ch0", is_active: true }
      ],
      videos: [],
      stream_status: { 
        current_source_type: "none", 
        current_source_id: null, 
        is_streaming: false, 
        youtube_key: "", 
        system_domain: "",
        loop_video: false,
        scoreboard_enabled: false,
        timer_enabled: false,
        team_a_name: "TIME A",
        team_b_name: "TIME B",
        score_a: 0,
        score_b: 0,
        timer_seconds: 0,
        timer_running: false
      }
    }, null, 2));
  }
  dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  
  // Ensure default stream status fields exist for sports overlay and domain
  let updated = false;
  if (!dbCache.stream_status) {
    dbCache.stream_status = {};
  }
  if (dbCache.stream_status.system_domain === undefined || dbCache.stream_status.system_domain === "centralitl.unityautomacoes.com.br") {
    dbCache.stream_status.system_domain = "";
    updated = true;
  }
  if (dbCache.stream_status.scoreboard_enabled === undefined) {
    dbCache.stream_status.scoreboard_enabled = false;
    dbCache.stream_status.timer_enabled = false;
    dbCache.stream_status.team_a_name = "TIME A";
    dbCache.stream_status.team_b_name = "TIME B";
    dbCache.stream_status.score_a = 0;
    dbCache.stream_status.score_b = 0;
    dbCache.stream_status.timer_seconds = 0;
    dbCache.stream_status.timer_running = false;
    updated = true;
  }
  if (updated) {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2));
  }
  
  writeSportsFiles(dbCache.stream_status);
};
initDb();

const getDb = () => {
  if (!dbCache) initDb();
  return dbCache;
};

const saveDb = (data: any) => {
  dbCache = data;
  // Async write to not block
  fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), (err) => {
    if (err) console.error("Erro ao salvar DB:", err);
  });
};

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'], // Use polling first, with automatic websocket upgrade for maximum robustness on Cloud Run
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8
  });

  // FFmpeg Management
  let ffmpegProcess: ChildProcess | null = null;
  let ffmpegLogs: string[] = [];

  const addLog = (data: string) => {
    ffmpegLogs.push(data);
    if (ffmpegLogs.length > 100) ffmpegLogs.shift();
    io.emit("ffmpeg_log", data);
  };

  // Server-side connection error logging
  io.on("connection_error", (err) => {
    console.error("Erro de conexão Socket.io no servidor:", err.message);
    console.error("Contexto do erro:", err.context);
  });

  io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id, "Transporte:", socket.conn.transport.name);
    socket.emit("stream_status", getDb().stream_status);
    
    // Enviar logs existentes para o novo cliente
    ffmpegLogs.forEach(log => socket.emit("ffmpeg_log", log));

    socket.on("web_data", (data) => {
      const db = getDb();
      const isAlive = ffmpegProcess && !ffmpegProcess.killed && ffmpegProcess.exitCode === null;
      
      if (isAlive && db.stream_status.current_source_type === "web") {
        if (ffmpegProcess!.stdin && ffmpegProcess!.stdin.writable) {
          try {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            
            if (Math.random() < 0.05) {
              const msg = `[SERVER] Recebido chunk web_data via Socket: ${buffer.length} bytes`;
              console.log(msg);
              // addLog(`${msg}\n`); // Don't flood the UI logs with every chunk
            }
            
            ffmpegProcess!.stdin.write(buffer, (err) => {
              if (err) console.error("Erro ao escrever no stdin do FFmpeg (Socket):", err);
            });
          } catch (e) {
            console.error("Erro ao processar chunk web_data (Socket):", e);
          }
        }
      }
    });

    socket.on("web_ready_to_start", () => {
      // Handshake is now handled globally in startStream to ensure FFmpeg is alive
    });

    socket.on("disconnect", () => {
      console.log("Cliente desconectado:", socket.id);
    });
  });

  // Server-side stopwatch timer ticking
  setInterval(() => {
    const db = getDb();
    let changed = false;
    if (db.stream_status.timer_running) {
      db.stream_status.timer_seconds = (db.stream_status.timer_seconds || 0) + 1;
      changed = true;
    }
    
    // Periodically update the dynamic txt files so FFmpeg drawtext reloads them correctly
    if (db.stream_status.scoreboard_enabled || db.stream_status.timer_enabled || changed) {
      writeSportsFiles(db.stream_status);
      if (changed) {
        saveDb(db);
        io.emit("stream_status", db.stream_status);
      }
    }
  }, 1000);

  const PORT = Number(process.env.PORT) || 3000;
  const JWT_SECRET = process.env.JWT_SECRET || "stream-control-secret-123";

  app.use(cors());
  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  const stopStream = (isSwitching = false) => {
    console.log(`[SERVER] stopStream chamado (isSwitching=${isSwitching})`);
    if (ffmpegProcess) {
      ffmpegProcess.removeAllListeners("close");
      ffmpegProcess.removeAllListeners("exit");
      ffmpegProcess.kill("SIGKILL");
      ffmpegProcess = null;
    }
    ffmpegLogs = [];
    if (!isSwitching) {
      const db = getDb();
      db.stream_status.is_streaming = false;
      db.stream_status.current_source_type = "none";
      db.stream_status.current_source_id = null;
      saveDb(db);
      io.emit("stream_status", db.stream_status);
    }
  };

  let isStarting = false;
  let activeProbeProc: any = null;
  let activeHighQualityMjpegProc: any = null;
  let activeHighQualityCamId: number | null = null;

  const startStream = async (type: "camera" | "video" | "web", id: number | string) => {
    // If a probe is already running, cancel it so the new request can execute immediately
    if (activeProbeProc) {
      try { activeProbeProc.kill("SIGKILL"); } catch (e) {}
      activeProbeProc = null;
    }
    isStarting = true;
    const msg = `[SERVER] startStream chamado: type=${type}, id=${id}`;
    console.log(msg);
    
    try {
      stopStream(true);
      
      // Limpar logs antigos no servidor e avisar clientes
      ffmpegLogs = [];
      io.emit("ffmpeg_log_clear");
      
      setTimeout(() => {
        addLog(`${msg}\n`);
      }, 100);

      const db = getDb();
      const youtubeKey = db.stream_status.youtube_key;
      if (!youtubeKey) {
        addLog("ERRO: Chave do YouTube não configurada nas configurações.\n");
        return;
      }

      let inputArgs: string[] = [];
      let mappingArgs: string[] = [];
      
      if (type === "camera") {
        const cam = db.cameras.find((c: any) => c.id === id);
        if (!cam) return;

        // Store last active camera ID for auto-returning after video commercials
        db.stream_status.last_camera_id = id;
        saveDb(db);

        const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));

        // Probe if camera stream has native audio track
        const hasAudio = await new Promise<boolean>((resolve) => {
          const probeArgs = isRtmp 
            ? [
                "-v", "error",
                "-analyzeduration", "3000000",
                "-probesize", "3000000",
                "-show_entries", "stream=codec_type",
                "-of", "default=noprint_wrappers=1",
                cam.rtsp_url
              ]
            : [
                "-rtsp_transport", "tcp",
                "-v", "error",
                "-analyzeduration", "3000000",
                "-probesize", "3000000",
                "-show_entries", "stream=codec_type",
                "-of", "default=noprint_wrappers=1",
                cam.rtsp_url
              ];
          
          const proc = spawn("ffprobe", probeArgs);
          activeProbeProc = proc;
          let out = "";
          proc.stdout.on("data", (d) => { out += d.toString(); });
          const timer = setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch (e) {}
            if (activeProbeProc === proc) activeProbeProc = null;
            resolve(out.toLowerCase().includes("audio"));
          }, 3500);
          proc.on("close", () => {
            clearTimeout(timer);
            if (activeProbeProc === proc) activeProbeProc = null;
            resolve(out.toLowerCase().includes("audio"));
          });
        });

        if (isRtmp) {
          inputArgs = [
            "-thread_queue_size", "4096",
            "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
            "-analyzeduration", "3000000", 
            "-probesize", "3000000", 
            "-i", cam.rtsp_url
          ];
        } else {
          inputArgs = [
            "-thread_queue_size", "4096",
            "-rtsp_transport", "tcp", 
            "-max_delay", "500000",
            "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
            "-analyzeduration", "3000000", 
            "-probesize", "3000000", 
            "-i", cam.rtsp_url
          ];
        }

        if (hasAudio) {
          addLog("Áudio detectado na câmera! Transmitindo áudio nativo resincronizado para AAC 44.1kHz Estéreo.\n");
          mappingArgs = [
            "-map", "0:v:0", 
            "-map", "0:a:0?", 
            "-af", "aresample=44100:async=1000:min_hard_comp=0.100000,aformat=sample_fmts=fltp:channel_layouts=stereo"
          ];
        } else {
          addLog("Nenhum canal de áudio detectado na câmera. Utilizando faixa de áudio silenciosa para o YouTube.\n");
          inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
          mappingArgs = ["-map", "0:v:0", "-map", "1:a:0"];
        }
      } else if (type === "video") {
        const vid = db.videos.find((v: any) => v.id === id);
        if (!vid) return;
        const videoPath = path.join(process.cwd(), vid.file_path);
        
        if (db.stream_status.loop_video) {
          inputArgs = ["-stream_loop", "-1"];
        }
        inputArgs.push("-re", "-fflags", "+genpts", "-i", videoPath);
        mappingArgs = ["-map", "0:v:0", "-map", "0:a:0?"];
      } else if (type === "web") {
        inputArgs = [
          "-use_wallclock_as_timestamps", "1",
          "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
          "-thread_queue_size", "16384",
          "-probesize", "5M", // Balanced for fast start but stable track metadata detection
          "-analyzeduration", "5M", // Balanced analyzeduration
          "-f", "webm",
          "-i", "pipe:0"
        ];
        mappingArgs = ["-map", "0:v:0", "-map", "0:a:0?"]; 
      }

      let vfFilters = "fps=30,format=yuv420p";
      
      if ((type === "camera" || type === "video") && (db.stream_status.scoreboard_enabled || db.stream_status.timer_enabled)) {
        writeSportsFiles(db.stream_status);
        
        const escFontPath = fontPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        const fontFileOpt = fs.existsSync(fontPath) && fs.statSync(fontPath).size > 1000 ? `:fontfile='${escFontPath}'` : "";
        let sportsFilters = [];
        
        if (db.stream_status.scoreboard_enabled) {
          // Semi-transparent dark background card (Width: 320, Height: 42)
          sportsFilters.push("drawbox=x=40:y=40:w=320:h=42:color=black@0.85:t=fill");
          // Yellow neon border on the left
          sportsFilters.push("drawbox=x=40:y=40:w=4:h=42:color=0xEAB308:t=fill");
          
          // Team A Name (drawn at fixed left position x=75, y=52, left-aligned)
          sportsFilters.push(`drawtext=textfile=teama.txt:reload=1:x=75:y=52:fontcolor=white:fontsize=15${fontFileOpt}`);
          // Score A Box & value (fixed x=160, y=50)
          sportsFilters.push(`drawtext=textfile=scorea.txt:reload=1:x=160:y=50:fontcolor=white:fontsize=18:box=1:boxcolor=white@0.12:boxborderw=4${fontFileOpt}`);
          
          // Visual Divider
          sportsFilters.push(`drawtext=text='-':x=198:y=52:fontcolor=white@0.4:fontsize=16${fontFileOpt}`);
          
          // Score B Box & value (fixed x=224, y=50)
          sportsFilters.push(`drawtext=textfile=scoreb.txt:reload=1:x=224:y=50:fontcolor=white:fontsize=18:box=1:boxcolor=white@0.12:boxborderw=4${fontFileOpt}`);
          // Team B Name (drawn at fixed position x=265, y=52)
          sportsFilters.push(`drawtext=textfile=teamb.txt:reload=1:x=265:y=52:fontcolor=white:fontsize=15${fontFileOpt}`);
        }
        
        if (db.stream_status.timer_enabled) {
          if (db.stream_status.scoreboard_enabled) {
            // Attached timer block on the right (x=366, width:80, height:42)
            sportsFilters.push("drawbox=x=366:y=40:w=80:h=42:color=0xEAB308:t=fill");
            // Timer text (drawn on the yellow box, centered around 406 - starting at 384)
            sportsFilters.push(`drawtext=textfile=timer.txt:reload=1:x=384:y=52:fontcolor=black:fontsize=16${fontFileOpt}`);
          } else {
            // Standalone timer block (x=40, width:90, height:42)
            sportsFilters.push("drawbox=x=40:y=40:w=90:h=42:color=0xEAB308:t=fill");
            // Timer text (centered around 85 - starting at 63)
            sportsFilters.push(`drawtext=textfile=timer.txt:reload=1:x=63:y=52:fontcolor=black:fontsize=17${fontFileOpt}`);
          }
        }
        
        vfFilters += "," + sportsFilters.join(",");
      }

      const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${youtubeKey}`;
      const args = [
        ...inputArgs,
        ...mappingArgs,
        "-vf", vfFilters,
        "-c:v", "libx264",
        "-preset", "superfast", // Superfast preset for optimal CPU usage and stability
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-g", "60",
        "-keyint_min", "60",
        "-sc_threshold", "0", 
        "-b:v", "4500k", // High quality 4.5 Mbps bitrate
        "-maxrate", "5000k",
        "-bufsize", "10000k",
        "-c:a", "aac",
        "-b:a", "128k", // High quality 128k audio
        "-ar", "44100",
        "-ac", "2", // Guarantee stereo audio channels for YouTube
        "-f", "flv",
        "-flvflags", "no_duration_filesize",
        "-rtmp_buffer", "2000",
        "-rtmp_live", "live",
        "-max_muxing_queue_size", "4096",
        "-threads", "0",
        rtmpUrl
      ];

      console.log("Iniciando FFmpeg:", args.join(" "));
      addLog(`Comando: ffmpeg ${args.join(" ")}\n`);

      try {
        ffmpegProcess = spawn("ffmpeg", args);
        console.log("Processo FFmpeg iniciado com PID:", ffmpegProcess.pid);
        addLog(`[SERVER] Processo FFmpeg iniciado com PID: ${ffmpegProcess.pid}\n`);
      } catch (e: any) {
        console.error("Erro ao iniciar FFmpeg:", e);
        addLog(`ERRO AO INICIAR FFMPEG: ${e.message}\n`);
        return;
      }

      ffmpegProcess.on("error", (err) => {
        console.error("Erro no processo FFmpeg:", err);
        addLog(`ERRO NO PROCESSO FFMPEG: ${err.message}\n`);
      });

      ffmpegProcess.on("exit", (code, signal) => {
        const msg = `[SERVER] FFmpeg parou (Código: ${code}, Sinal: ${signal})`;
        console.log(msg);
        addLog(`${msg}\n`);
        if (code !== 0 && code !== null) {
          addLog(`[SISTEMA] Dica: Verifique se a sua conexão de upload é estável e se a chave do YouTube não expirou.\n`);
        }

        // Auto-return to last active camera if a non-looping commercial finished naturally
        const currentDb = getDb();
        if (type === "video" && !currentDb.stream_status.loop_video && (code === 0 || code === null)) {
          let targetCamId = currentDb.stream_status.last_camera_id;
          let targetCam = currentDb.cameras.find((c: any) => c.id === targetCamId);
          if (!targetCam && currentDb.cameras.length > 0) {
            targetCam = currentDb.cameras.find((c: any) => c.is_active !== false) || currentDb.cameras[0];
          }

          if (targetCam) {
            const autoReturnMsg = `[SERVER] Comercial finalizado. Retornando automaticamente para a câmera '${targetCam.name}' (ID ${targetCam.id})`;
            console.log(autoReturnMsg);
            addLog(`${autoReturnMsg}\n`);
            stopStream(true);
            setTimeout(() => {
              startStream("camera", targetCam.id);
            }, 500);
            return;
          }
        }

        stopStream();
      });

      if (type === "web") {
        setTimeout(() => {
          io.emit("server_ready_for_web");
        }, 2000);
      }

      ffmpegProcess.on("close", (code) => {
        console.log(`Processo FFmpeg encerrado com código ${code}`);
        addLog(`FFmpeg encerrado com código ${code}\n`);
        if (ffmpegProcess) {
          stopStream();
        }
      });

      ffmpegProcess.stderr?.on("data", (data) => {
        const log = data.toString();
        // Log more aggressively during startup to catch errors
        addLog(log);
      });

      db.stream_status.is_streaming = true;
      db.stream_status.current_source_type = type;
      db.stream_status.current_source_id = id as any;
      saveDb(db);
      io.emit("stream_status", db.stream_status);
    } finally {
      isStarting = false;
    }
  };

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(" ")[1] || req.query.token;
    if (!token) return res.status(401).json({ error: "Não autorizado" });
    try {
      const decoded = jwt.verify(token as string, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (e) {
      res.status(401).json({ error: "Token inválido" });
    }
  };

  // Binary data endpoint for Web Local streaming
  app.post("/api/stream/web-data", authenticate, express.raw({ type: 'application/octet-stream', limit: '20mb' }), (req, res) => {
    const db = getDb();
    const isAlive = ffmpegProcess && !ffmpegProcess.killed && ffmpegProcess.exitCode === null;
    
    if (Math.random() < 0.05) {
      console.log(`[SERVER] Recebido chunk POST: ${req.body?.length || 0} bytes. FFmpeg: ${isAlive}, Type: ${db.stream_status.current_source_type}`);
    }

    if (isAlive && db.stream_status.current_source_type === "web") {
      if (ffmpegProcess!.stdin && ffmpegProcess!.stdin.writable) {
        try {
          const buffer = req.body;
          if (buffer && buffer.length > 0) {
            // Check for backpressure
            const canWrite = ffmpegProcess!.stdin.write(buffer, (err) => {
              if (err) {
                console.error("Erro ao escrever no stdin do FFmpeg:", err);
                if (!res.headersSent) res.status(500).send(`Error writing to FFmpeg: ${err.message}`);
              } else {
                if (!res.headersSent) res.status(200).send("OK");
              }
            });
            
            if (!canWrite) {
              console.warn("[SERVER] Backpressure detectado no stdin do FFmpeg");
            }
            return;
          } else {
            res.status(400).send("Empty chunk");
          }
        } catch (e: any) {
          console.error("Erro fatal ao escrever no stdin via POST:", e);
          if (!res.headersSent) res.status(500).send(`Fatal error: ${e.message}`);
          return;
        }
      } else {
        res.status(503).send("FFmpeg stdin not ready or pipe closed");
        return;
      }
    } else {
      res.status(400).send(`FFmpeg not running or not in web mode (Alive: ${isAlive})`);
      return;
    }
  });

  // API Routes
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const db = getDb();
    const user = db.users.find((u: any) => u.username === username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.get("/api/cameras", authenticate, (req, res) => {
    res.json(getDb().cameras);
  });

  interface SnapshotCacheItem {
    data: Buffer;
    timestamp: number;
    isFetching: boolean;
    pendingResolvers: ((buf: Buffer | null) => void)[];
  }
  const snapshotCaches: Record<number, SnapshotCacheItem> = {};

  app.get("/api/cameras/:id/snapshot", authenticate, (req, res) => {
    const db = getDb();
    const camId = parseInt(req.params.id);
    const cam = db.cameras.find((c: any) => c.id === camId);
    if (!cam) return res.status(404).json({ error: "Câmera não encontrada" });

    if (!snapshotCaches[camId]) {
      snapshotCaches[camId] = {
        data: Buffer.alloc(0),
        timestamp: 0,
        isFetching: false,
        pendingResolvers: []
      };
    }

    const cache = snapshotCaches[camId];
    const now = Date.now();
    const CACHE_TTL = 200; // 0.2s cache TTL for ultra fast snapshot refresh

    const FALLBACK_JPEG = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
      0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
      0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
      0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20,
      0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
      0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
      0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
      0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0x11, 0x10, 0x00, 0x02, 0x02, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xFF, 0xDA, 0x00,
      0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xD2, 0xCF, 0x20, 0xFF, 0xD9
    ]);

    const deliverBuffer = (buf: Buffer | null) => {
      if (res.headersSent) return;
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      if (buf && buf.length > 0) {
        res.end(buf);
      } else {
        res.end(FALLBACK_JPEG);
      }
    };

    // If cache is valid, serve immediately!
    if (cache.data.length > 0 && (now - cache.timestamp < CACHE_TTL)) {
      return deliverBuffer(cache.data);
    }

    // If already fetching, return stale cache immediately if we have it!
    // This makes the UI feel ultra smooth and responsive.
    if (cache.isFetching) {
      if (cache.data.length > 0) {
        return deliverBuffer(cache.data);
      }
      // If we don't have stale cache, queue the resolver
      cache.pendingResolvers.push(deliverBuffer);
      return;
    }

    // Capture new snapshot
    cache.isFetching = true;

    const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));
    const transportOpts = isRtmp ? [] : ["-rtsp_transport", "tcp"];

    const args = [
      "-thread_queue_size", "2048",
      "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
      ...transportOpts,
      "-probesize", "500000",
      "-analyzeduration", "500000",
      "-i", cam.rtsp_url,
      "-frames:v", "1",
      "-an",
      "-f", "image2",
      "-vcodec", "mjpeg",
      "pipe:1"
    ];

    const ffmpeg = spawn("ffmpeg", args);
    const chunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
    }, 4000);

    ffmpeg.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);
      cache.isFetching = false;
      
      const resolvers = [...cache.pendingResolvers];
      cache.pendingResolvers = [];

      if (chunks.length > 0) {
        const fullBuffer = Buffer.concat(chunks);
        cache.data = fullBuffer;
        cache.timestamp = Date.now();
        
        deliverBuffer(fullBuffer);
        resolvers.forEach(r => r(fullBuffer));
      } else {
        // Fallback to stale buffer if available
        if (cache.data.length > 0) {
          deliverBuffer(cache.data);
          resolvers.forEach(r => r(cache.data));
        } else {
          deliverBuffer(null);
          resolvers.forEach(r => r(null));
        }
      }
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timeout);
      cache.isFetching = false;
      
      const resolvers = [...cache.pendingResolvers];
      cache.pendingResolvers = [];

      if (cache.data.length > 0) {
        deliverBuffer(cache.data);
        resolvers.forEach(r => r(cache.data));
      } else {
        console.error("Erro no spawn do ffmpeg para snapshot:", err);
        deliverBuffer(null);
        resolvers.forEach(r => r(null));
      }
    });
  });

  app.get("/api/cameras/:id/mjpeg", authenticate, (req, res) => {
    const db = getDb();
    const camId = parseInt(req.params.id);
    const cam = db.cameras.find((c: any) => c.id === camId);
    if (!cam) return res.status(404).json({ error: "Câmera não encontrada" });

    const isPreview = req.query.quality === "preview";

    // Terminate old active high-quality stream ONLY if switching to a DIFFERENT camera ID
    if (!isPreview && activeHighQualityMjpegProc && activeHighQualityCamId !== camId) {
      try { activeHighQualityMjpegProc.kill("SIGKILL"); } catch (e) {}
      activeHighQualityMjpegProc = null;
      activeHighQualityCamId = null;
    }

    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "close",
      "Pragma": "no-cache",
      "X-Accel-Buffering": "no"
    });

    const scaleFilter = isPreview ? "scale=480:-1" : "scale=960:-1";
    const fpsRate = isPreview ? "15" : "25";
    const qualityVal = isPreview ? "8" : "6";

    const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));
    const transportOpts = isRtmp ? [] : ["-rtsp_transport", "tcp"];

    const args = [
      "-thread_queue_size", "2048",
      "-fflags", "+genpts+igndts",
      ...transportOpts,
      "-probesize", "1000000",
      "-analyzeduration", "1000000",
      "-i", cam.rtsp_url,
      "-r", fpsRate,
      "-vf", scaleFilter,
      "-an",
      "-c:v", "mjpeg",
      "-q:v", qualityVal,
      "-g", "1",
      "-f", "mpjpeg",
      "-boundary_tag", "ffmpeg",
      "-"
    ];

    const ff = spawn("ffmpeg", args);
    if (!isPreview) {
      activeHighQualityMjpegProc = ff;
      activeHighQualityCamId = camId;
    }

    ff.stdout.pipe(res);

    let killed = false;
    const cleanup = () => {
      if (killed) return;
      killed = true;
      if (activeHighQualityMjpegProc === ff) {
        activeHighQualityMjpegProc = null;
        activeHighQualityCamId = null;
      }
      try {
        ff.stdout.unpipe(res);
        ff.kill("SIGKILL");
      } catch (e) {}
      try {
        if (!res.writableEnded) res.end();
      } catch (e) {}
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    req.on("end", cleanup);
    req.on("error", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
    res.on("error", cleanup);
    if (req.socket) {
      req.socket.on("close", cleanup);
      req.socket.on("error", cleanup);
    }
    ff.on("close", () => {
      killed = true;
      if (activeHighQualityMjpegProc === ff) {
        activeHighQualityMjpegProc = null;
        activeHighQualityCamId = null;
      }
    });
  });

  app.post("/api/cameras", authenticate, (req, res) => {
    const db = getDb();
    const newCam = { id: Date.now(), ...req.body };
    db.cameras.push(newCam);
    saveDb(db);
    res.json(newCam);
  });

  app.put("/api/cameras/:id", authenticate, (req, res) => {
    const db = getDb();
    const camId = parseInt(req.params.id);
    const index = db.cameras.findIndex((c: any) => c.id === camId);
    if (index === -1) return res.status(404).json({ error: "Câmera não encontrada" });

    const { name, rtsp_url } = req.body;
    if (name) db.cameras[index].name = name;
    if (rtsp_url) db.cameras[index].rtsp_url = rtsp_url;

    saveDb(db);
    res.json(db.cameras[index]);
  });

  app.delete("/api/cameras/:id", authenticate, (req, res) => {
    const db = getDb();
    db.cameras = db.cameras.filter((c: any) => c.id !== parseInt(req.params.id));
    saveDb(db);
    res.json({ success: true });
  });

  app.get("/api/videos", authenticate, (req, res) => {
    res.json(getDb().videos);
  });

  app.post("/api/videos", authenticate, upload.single("video"), (req, res) => {
    console.log("Recebendo requisição de upload de vídeo...");
    if (!req.file) {
      console.log("Nenhum arquivo recebido na requisição.");
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }
    console.log("Arquivo recebido:", req.file.originalname, "Salvo em:", req.file.path);
    
    const db = getDb();
    const newVideo = {
      id: Date.now(),
      title: req.file.originalname,
      file_path: `uploads/${req.file.filename}`,
      created_at: new Date()
    };
    db.videos.push(newVideo);
    saveDb(db);
    console.log("Vídeo salvo no banco de dados:", newVideo.id);
    res.json(newVideo);
  });

  app.delete("/api/videos/:id", authenticate, (req, res) => {
    const db = getDb();
    const video = db.videos.find((v: any) => v.id === parseInt(req.params.id));
    if (video) {
      const fullPath = path.join(process.cwd(), video.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      db.videos = db.videos.filter((v: any) => v.id !== video.id);
      saveDb(db);
    }
    res.json({ success: true });
  });

  app.get("/api/status", authenticate, (req, res) => {
    const status = { ...getDb().stream_status };
    const currentHost = req.get("host")?.split(":")[0] || req.hostname;
    if (!status.system_domain || status.system_domain === "centralitl.unityautomacoes.com.br") {
      status.system_domain = currentHost;
    }
    res.json(status);
  });

  app.get("/api/status/logs", authenticate, (req, res) => {
    res.json({ logs: ffmpegLogs });
  });

  app.post("/api/status/key", authenticate, (req, res) => {
    const db = getDb();
    db.stream_status.youtube_key = req.body.key;
    saveDb(db);
    res.json({ success: true });
  });

  app.post("/api/status/domain", authenticate, (req, res) => {
    const db = getDb();
    const currentHost = req.get("host")?.split(":")[0] || req.hostname;
    db.stream_status.system_domain = req.body.domain ? req.body.domain.trim() : currentHost;
    saveDb(db);
    io.emit("stream_status", { ...db.stream_status, system_domain: db.stream_status.system_domain || currentHost });
    res.json({ success: true, domain: db.stream_status.system_domain });
  });

  app.post("/api/cameras/test-rtmp", authenticate, (req, res) => {
    const { stream_key } = req.body;
    if (!stream_key) return res.status(400).json({ error: "Stream key é obrigatória" });
    
    const url = `rtmp://127.0.0.1:1935/live/${stream_key}`;
    const ff = spawn("ffmpeg", ["-probesize", "32", "-analyzeduration", "0", "-i", url, "-frames:v", "1", "-f", "null", "-"]);
    let done = false;
    
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        ff.kill("SIGKILL");
        res.json({ status: "waiting", message: "Nenhum fluxo RTMP detectado até o momento. Verifique se a câmera física está transmitindo para o IP/Domínio do servidor na porta 1935." });
      }
    }, 4000);

    ff.on("close", (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (code === 0) {
          res.json({ status: "ok", message: "Sinal RTMP recebido com SUCESSO! A câmera está transmitindo corretamente." });
        } else {
          res.json({ status: "waiting", message: "Câmera ainda não conectada. Certifique-se de salvar a configuração na câmera física com a chave de fluxo correta." });
        }
      }
    });

    ff.on("error", () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        res.json({ status: "error", message: "Erro ao testar porta RTMP." });
      }
    });
  });

  app.post("/api/status/loop", authenticate, (req, res) => {
    const { loop } = req.body;
    const db = getDb();
    db.stream_status.loop_video = loop;
    saveDb(db);
    
    // Se estiver transmitindo um vídeo, reinicia para aplicar o loop
    if (db.stream_status.is_streaming && db.stream_status.current_source_type === "video") {
      startStream("video", db.stream_status.current_source_id!);
    }
    
    io.emit("stream_status", db.stream_status);
    res.json({ success: true });
  });

  app.post("/api/status/sports", authenticate, (req, res) => {
    const { 
      scoreboard_enabled, 
      timer_enabled, 
      team_a_name, 
      team_b_name, 
      score_a, 
      score_b, 
      timer_seconds, 
      timer_running 
    } = req.body;
    
    const db = getDb();
    const wasScoreboardEnabled = db.stream_status.scoreboard_enabled;
    const wasTimerEnabled = db.stream_status.timer_enabled;
    
    if (scoreboard_enabled !== undefined) db.stream_status.scoreboard_enabled = scoreboard_enabled;
    if (timer_enabled !== undefined) db.stream_status.timer_enabled = timer_enabled;
    if (team_a_name !== undefined) db.stream_status.team_a_name = team_a_name;
    if (team_b_name !== undefined) db.stream_status.team_b_name = team_b_name;
    if (score_a !== undefined) db.stream_status.score_a = score_a;
    if (score_b !== undefined) db.stream_status.score_b = score_b;
    if (timer_seconds !== undefined) db.stream_status.timer_seconds = timer_seconds;
    if (timer_running !== undefined) db.stream_status.timer_running = timer_running;
    
    // Write text files immediately for FFmpeg's drawtext filter to pick up
    writeSportsFiles(db.stream_status);
    saveDb(db);
    
    // Check if we need to restart the active stream because we toggled scoreboard/timer enabling state
    let needsRestart = false;
    if (db.stream_status.is_streaming && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video")) {
      if (scoreboard_enabled !== undefined && scoreboard_enabled !== wasScoreboardEnabled) {
        needsRestart = true;
      }
      if (timer_enabled !== undefined && timer_enabled !== wasTimerEnabled) {
        needsRestart = true;
      }
    }
    
    if (needsRestart) {
      console.log("[SERVER] Reiniciando transmissão devido a alteraçao dos filtros de overlay");
      startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
    }
    
    io.emit("stream_status", db.stream_status);
    res.json({ success: true, status: db.stream_status });
  });

  app.post("/api/stream/switch", authenticate, (req, res) => {
    const { type, id } = req.body;
    res.json({ success: true, message: "Troca de transmissão solicitada" });
    startStream(type, id);
  });

  app.post("/api/stream/stop", authenticate, (req, res) => {
    stopStream();
    res.json({ success: true });
  });

  // Vite middleware for development
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

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Erro não tratado no servidor:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({ error: "Erro interno no servidor", details: err.message });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer();
