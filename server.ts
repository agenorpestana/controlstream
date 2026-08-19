import "dotenv/config";
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
import {
  initDatabase,
  getDb,
  saveDb,
  writeSportsFiles,
  dbAddCamera,
  dbUpdateCamera,
  dbDeleteCamera,
  dbAddVideo,
  dbDeleteVideo,
  dbAddLogo,
  dbDeleteLogo,
  isDatabaseMySql,
  findUserByCredentials
} from "./db";

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

// Font downloader & system font locator for sports scoreboard overlay in FFmpeg
const customFontPath = path.join(process.cwd(), "sportsfont.ttf");

function getAvailableFontFile(): string | null {
  if (fs.existsSync(customFontPath)) {
    try {
      if (fs.statSync(customFontPath).size > 1000) return customFontPath;
    } catch (e) {}
  }

  const systemFonts = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "/System/Library/Fonts/Helvetica.ttc"
  ];

  for (const f of systemFonts) {
    try {
      if (fs.existsSync(f) && fs.statSync(f).size > 1000) {
        if (!fs.existsSync(customFontPath)) {
          try { fs.copyFileSync(f, customFontPath); } catch (e) {}
        }
        return f;
      }
    } catch (e) {}
  }
  return null;
}

// Ensure font is available or downloaded
if (!getAvailableFontFile()) {
  console.log("Tentando baixar fonte TTF para o overlay do painel...");
  const fontFile = fs.createWriteStream(customFontPath);
  https.get("https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/master/resources/ttf/DejaVuSans-Bold.ttf", (response) => {
    response.pipe(fontFile);
    fontFile.on("finish", () => {
      fontFile.close();
      try {
        const stats = fs.statSync(customFontPath);
        if (stats.size < 1000) {
          console.error("Fonte baixada é muito pequena ou inválida, removendo...");
          fs.unlinkSync(customFontPath);
        } else {
          console.log("Fonte TTF baixada e salva com sucesso.");
        }
      } catch (err) {
        console.error("Erro ao validar tamanho da fonte:", err);
      }
    });
  }).on("error", (err) => {
    console.error("Aviso ao baixar fonte TTF:", err.message);
    try { fontFile.close(); fs.unlinkSync(customFontPath); } catch (ex) {}
  });
}

// Narration Audio Streamer (PCM 16-bit 44.1kHz Stereo) with Clean Streaming for Zero Robotic Artifacts
class NarrationAudioStreamer {
  private clients: ((chunk: Buffer) => void)[] = [];
  private lastChunkTime: number = 0;
  private ringBuffer: Buffer[] = [];
  private totalRingBytes: number = 0;
  private maxRingBytes: number = 35280; // ~200ms of 44.1kHz 16-bit stereo PCM audio

  constructor() {
    // Generate silence ONLY if no client chunks have arrived for > 350ms (mic muted or disconnected)
    // This completely prevents interleaving silence between real voice chunks which was causing robotic sound!
    setInterval(() => {
      if (this.clients.length > 0 && Date.now() - this.lastChunkTime > 350) {
        const silenceChunk = Buffer.alloc(3528, 0); // ~40ms silence
        this.broadcast(silenceChunk);
      }
    }, 40);
  }

  public pushChunk(buf: Buffer, isSilence = false) {
    if (!isSilence) {
      this.lastChunkTime = Date.now();
    }
    
    // Store in circular buffer for instant priming on camera switch
    this.ringBuffer.push(buf);
    this.totalRingBytes += buf.length;
    while (this.totalRingBytes > this.maxRingBytes && this.ringBuffer.length > 1) {
      const removed = this.ringBuffer.shift();
      if (removed) this.totalRingBytes -= removed.length;
    }

    this.broadcast(buf);
  }

  private broadcast(chunk: Buffer) {
    for (let i = this.clients.length - 1; i >= 0; i--) {
      try {
        this.clients[i](chunk);
      } catch (e) {
        this.clients.splice(i, 1);
      }
    }
  }

  public subscribe(cb: (chunk: Buffer) => void) {
    // When a newly spawned FFmpeg process connects during a camera switch,
    // immediately prime it with clean audio buffer
    if (this.ringBuffer.length > 0) {
      for (const chunk of this.ringBuffer) {
        try {
          cb(chunk);
        } catch (e) {}
      }
    } else {
      cb(Buffer.alloc(7056, 0));
    }

    this.clients.push(cb);
    return () => {
      const idx = this.clients.indexOf(cb);
      if (idx !== -1) this.clients.splice(idx, 1);
    };
  }
}

const narrationStreamer = new NarrationAudioStreamer();

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
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const handleUpload = (fieldName: string) => {
  return (req: any, res: any, next: any) => {
    upload.single(fieldName)(req, res, (err: any) => {
      if (err) {
        console.error(`[SERVER] Erro no upload (${fieldName}):`, err);
        return res.status(400).json({ error: `Erro ao processar o arquivo enviado: ${err.message || err}` });
      }
      next();
    });
  };
};

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

async function startServer() {
  // Initialize database (MySQL if credentials configured, or local fallback)
  await initDatabase();

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use('/uploads', express.static(uploadsDir));
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

    socket.on("narration_pcm_chunk", (data) => {
      try {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buffer.length > 0) {
          narrationStreamer.pushChunk(buffer);
        }
      } catch (e) {
        console.error("Erro ao processar chunk de áudio da narração:", e);
      }
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

  let manualStop = false;
  const stopStream = (isSwitching = false) => {
    console.log(`[SERVER] stopStream chamado (isSwitching=${isSwitching})`);
    if (!isSwitching) {
      manualStop = true;
    }
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
  const camAudioCache: Record<number | string, boolean> = {};

  const startStream = async (type: "camera" | "video" | "web", id: number | string) => {
    manualStop = false;
    // If a probe is already running, cancel it so the new request can execute immediately
    if (activeProbeProc) {
      try { activeProbeProc.kill("SIGKILL"); } catch (e) {}
      activeProbeProc = null;
    }
    isStarting = true;
    const msg = `[SERVER] startStream chamado: type=${type}, id=${id}`;
    console.log(msg);
    
    try {
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
      let nextInputIndex = 0;
      let mainInputIndex = 0;
      let hasAudio = false;
      
      if (type === "camera") {
        const cam = db.cameras.find((c: any) => c.id === id);
        if (!cam) return;

        // Store last active camera ID for auto-returning after video commercials
        db.stream_status.last_camera_id = id;
        saveDb(db);

        const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));

        // Fast probe or use cached audio presence to avoid delay during camera switches
        let probedAudio = cam.has_audio;
        if (probedAudio === undefined && camAudioCache[cam.id] !== undefined) {
          probedAudio = camAudioCache[cam.id];
        }

        if (probedAudio === undefined) {
          probedAudio = await new Promise<boolean>((resolve) => {
            const probeArgs = [
              ...(isRtmp ? [] : ["-rtsp_transport", "tcp", "-stimeout", "3000000"]),
              "-v", "error",
              "-analyzeduration", "1500000",
              "-probesize", "1500000",
              "-show_entries", "stream=codec_type,codec_name",
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
            }, 2500);
            proc.on("close", () => {
              clearTimeout(timer);
              if (activeProbeProc === proc) activeProbeProc = null;
              resolve(out.toLowerCase().includes("audio"));
            });
            proc.on("error", () => {
              clearTimeout(timer);
              if (activeProbeProc === proc) activeProbeProc = null;
              resolve(false);
            });
          });
          camAudioCache[cam.id] = probedAudio;
          if (probedAudio) {
            cam.has_audio = true;
            saveDb(db);
          }
        }
        hasAudio = Boolean(probedAudio || cam.has_audio);

        if (isRtmp) {
          inputArgs.push(
            "-thread_queue_size", "4096",
            "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
            "-fpsprobesize", "0",
            "-analyzeduration", "1000000", 
            "-probesize", "1000000", 
            "-i", cam.rtsp_url
          );
        } else {
          inputArgs.push(
            "-thread_queue_size", "4096",
            "-rtsp_transport", "tcp", 
            "-stimeout", "5000000",
            "-flags", "+low_delay",
            "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
            "-fpsprobesize", "0",
            "-analyzeduration", "1000000", 
            "-probesize", "1000000", 
            "-i", cam.rtsp_url
          );
        }
        mainInputIndex = nextInputIndex++;
      } else if (type === "video") {
        const vid = db.videos.find((v: any) => v.id === id);
        if (!vid) return;
        const videoPath = path.join(process.cwd(), vid.file_path);
        
        if (db.stream_status.loop_video) {
          inputArgs.push("-stream_loop", "-1");
        }
        inputArgs.push("-re", "-fflags", "+genpts", "-i", videoPath);
        mainInputIndex = nextInputIndex++;
        hasAudio = true;
      } else if (type === "web") {
        inputArgs.push(
          "-use_wallclock_as_timestamps", "1",
          "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
          "-thread_queue_size", "16384",
          "-probesize", "5M",
          "-analyzeduration", "5M",
          "-f", "webm",
          "-i", "pipe:0"
        );
        mainInputIndex = nextInputIndex++;
        hasAudio = true;
      }

      // Add Narration Audio input if enabled
      let narrationInputIndex = -1;
      if (db.stream_status.mic_narration_enabled && type !== "web") {
        const narrationUrl = `http://127.0.0.1:${PORT}/internal/narration-audio-pcm`;
        inputArgs.push(
          "-thread_queue_size", "4096",
          "-use_wallclock_as_timestamps", "1",
          "-f", "s16le",
          "-ar", "44100",
          "-ac", "2",
          "-i", narrationUrl
        );
        narrationInputIndex = nextInputIndex++;
      }

      // Add Logo image input if enabled
      let logoInputIndex = -1;
      const logoEnabled = db.stream_status.logo_enabled;
      const activeLogoId = db.stream_status.active_logo_id;
      const logoPosition = db.stream_status.logo_position || 'top_right';
      const activeLogo = (db.logos || []).find((l: any) => l.id === activeLogoId);
      let logoPath = activeLogo ? path.join(process.cwd(), activeLogo.file_path) : null;
      if (logoPath && !fs.existsSync(logoPath)) logoPath = null;

      if (logoEnabled && logoPath) {
        inputArgs.push("-i", logoPath);
        logoInputIndex = nextInputIndex++;
      }

      // Add Silent audio generator if camera has no audio AND narration is not enabled
      let silenceInputIndex = -1;
      if (!hasAudio && narrationInputIndex === -1 && type !== "web") {
        inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
        silenceInputIndex = nextInputIndex++;
      }

      // Build -filter_complex for unified video and audio pipelines
      let filterComplexParts: string[] = [];
      let videoFilters: string[] = ["fps=30,format=yuv420p"];

      if ((type === "camera" || type === "video") && (db.stream_status.scoreboard_enabled || db.stream_status.timer_enabled)) {
        writeSportsFiles(db.stream_status);
        const resolvedFont = getAvailableFontFile();
        const escFFmpeg = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
        const fontFileOpt = resolvedFont ? `:fontfile='${escFFmpeg(resolvedFont)}'` : "";

        const cwd = process.cwd();
        const teamAFile = escFFmpeg(path.resolve(cwd, "teama.txt"));
        const scoreAFile = escFFmpeg(path.resolve(cwd, "scorea.txt"));
        const scoreBFile = escFFmpeg(path.resolve(cwd, "scoreb.txt"));
        const teamBFile = escFFmpeg(path.resolve(cwd, "teamb.txt"));
        const timerFile = escFFmpeg(path.resolve(cwd, "timer.txt"));

        if (db.stream_status.scoreboard_enabled) {
          videoFilters.push("drawbox=x=40:y=40:w=320:h=42:color=black@0.85:t=fill");
          videoFilters.push("drawbox=x=40:y=40:w=4:h=42:color=0xEAB308:t=fill");
          videoFilters.push(`drawtext=textfile='${teamAFile}':reload=1:x=75:y=52:fontcolor=white:fontsize=15${fontFileOpt}`);
          videoFilters.push(`drawtext=textfile='${scoreAFile}':reload=1:x=160:y=50:fontcolor=white:fontsize=18:box=1:boxcolor=white@0.12:boxborderw=4${fontFileOpt}`);
          videoFilters.push(`drawtext=text='-':x=198:y=52:fontcolor=white@0.4:fontsize=16${fontFileOpt}`);
          videoFilters.push(`drawtext=textfile='${scoreBFile}':reload=1:x=224:y=50:fontcolor=white:fontsize=18:box=1:boxcolor=white@0.12:boxborderw=4${fontFileOpt}`);
          videoFilters.push(`drawtext=textfile='${teamBFile}':reload=1:x=265:y=52:fontcolor=white:fontsize=15${fontFileOpt}`);
        }
        if (db.stream_status.timer_enabled) {
          if (db.stream_status.scoreboard_enabled) {
            videoFilters.push("drawbox=x=366:y=40:w=80:h=42:color=0xEAB308:t=fill");
            videoFilters.push(`drawtext=textfile='${timerFile}':reload=1:x=384:y=52:fontcolor=black:fontsize=16${fontFileOpt}`);
          } else {
            videoFilters.push("drawbox=x=40:y=40:w=90:h=42:color=0xEAB308:t=fill");
            videoFilters.push(`drawtext=textfile='${timerFile}':reload=1:x=63:y=52:fontcolor=black:fontsize=17${fontFileOpt}`);
          }
        }
      }

      let videoOutLabel = "[v_base]";
      filterComplexParts.push(`[${mainInputIndex}:v]${videoFilters.join(",")}${videoOutLabel}`);

      if (logoInputIndex !== -1) {
        let overlayPos = "main_w-overlay_w-30:30";
        if (logoPosition === "top_left") overlayPos = "30:30";
        else if (logoPosition === "bottom_left") overlayPos = "30:main_h-overlay_h-30";
        else if (logoPosition === "bottom_right") overlayPos = "main_w-overlay_w-30:main_h-overlay_h-30";

        filterComplexParts.push(`[${logoInputIndex}:v]scale=140:-1[scaled_logo]`);
        filterComplexParts.push(`[v_base][scaled_logo]overlay=${overlayPos}[v_out]`);
        videoOutLabel = "[v_out]";
      }

      // Audio filtering (Zero Slow-Motion, Clean Resampling)
      let audioOutLabel = "[a_out]";
      const narrationVolume = Math.max(0, (db.stream_status.mic_narration_volume ?? 100) / 100);

      if (type === "web") {
        filterComplexParts.push(`[${mainInputIndex}:a]aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo[a_out]`);
      } else if (narrationInputIndex !== -1) {
        if (db.stream_status.mic_narration_mode === "mix" && hasAudio) {
          addLog(`[SERVER] ÁUDIO MISTO: Misturando voz do narrador (Ganho: ${Math.round(narrationVolume * 100)}%) com o som da câmera.\n`);
          filterComplexParts.push(`[${mainInputIndex}:a]aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo[cam_a]`);
          filterComplexParts.push(`[${narrationInputIndex}:a]aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${narrationVolume.toFixed(2)}[mic_a]`);
          filterComplexParts.push(`[cam_a][mic_a]amix=inputs=2:duration=longest:dropout_transition=2,aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo[a_out]`);
        } else {
          addLog(`[SERVER] ÁUDIO NARRAÇÃO: Transmitindo apenas voz do narrador (Ganho: ${Math.round(narrationVolume * 100)}%).\n`);
          filterComplexParts.push(`[${narrationInputIndex}:a]aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${narrationVolume.toFixed(2)}[a_out]`);
        }
      } else if (hasAudio) {
        addLog("[SERVER] ÁUDIO NATIVO: Transmitindo som ambiente da câmera IP para o YouTube.\n");
        filterComplexParts.push(`[${mainInputIndex}:a]aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo[a_out]`);
      } else {
        addLog("[SERVER] ÁUDIO SILENCIOSO: Câmera sem microfone embutido. Enviando faixa silenciosa para o YouTube.\n");
        filterComplexParts.push(`[${silenceInputIndex}:a]aresample=44100:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo[a_out]`);
      }

      const mappingArgs = ["-map", videoOutLabel, "-map", audioOutLabel];
      const filterArgs = ["-filter_complex", filterComplexParts.join(";")];

      const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${youtubeKey}`;
      const args = [
        ...inputArgs,
        ...mappingArgs,
        ...filterArgs,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-g", "30",
        "-keyint_min", "30",
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
        "-flush_packets", "1",
        "-rtmp_buffer", "100",
        "-rtmp_live", "live",
        "-max_muxing_queue_size", "4096",
        "-threads", "0",
        rtmpUrl
      ];

      console.log("Iniciando FFmpeg:", args.join(" "));
      addLog(`Comando: ffmpeg ${args.join(" ")}\n`);

      // Kill previous ffmpeg process RIGHT BEFORE spawning the new one to minimize stream offline window
      stopStream(true);

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

        // Auto-reconnect if it was a camera and not stopped manually
        if (!manualStop && type === "camera" && currentDb.stream_status.is_streaming) {
          addLog(`[SERVER] Reconectando automaticamente à câmera ID ${id} em 2s...\n`);
          stopStream(true);
          setTimeout(() => {
            const freshDb = getDb();
            if (freshDb.stream_status.is_streaming && freshDb.stream_status.current_source_type === "camera") {
              startStream("camera", id);
            }
          }, 2000);
          return;
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
  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    console.log(`[AUTH] Tentativa de login para: "${username}"`);
    
    if (!username || !password) {
      return res.status(400).json({ error: "Informe o usuário e a senha." });
    }

    const user = await findUserByCredentials(username, password);
    if (!user) {
      console.warn(`[AUTH] Falha no login para: "${username}"`);
      return res.status(401).json({ error: "Credenciais inválidas. Verifique o usuário e a senha." });
    }

    console.log(`[AUTH] Login efetuado com sucesso para: "${user.username}" (ID: ${user.id})`);
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
    const CACHE_TTL = 1500; // 1.5s cache TTL for lightweight, responsive snapshots without server overload

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

    // If stale cache exists, serve it immediately to client while refreshing in background if expired
    if (cache.data.length > 0) {
      deliverBuffer(cache.data);
      if (now - cache.timestamp < CACHE_TTL || cache.isFetching) {
        return;
      }
    }

    if (cache.isFetching) {
      cache.pendingResolvers.push(deliverBuffer);
      return;
    }

    // Capture new snapshot in background
    cache.isFetching = true;

    const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));
    const transportOpts = isRtmp ? [] : ["-rtsp_transport", "tcp", "-stimeout", "3000000"];

    const args = [
      "-thread_queue_size", "2048",
      "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
      ...transportOpts,
      "-probesize", "500000",
      "-analyzeduration", "500000",
      "-i", cam.rtsp_url,
      "-vf", "scale=480:-1",
      "-frames:v", "1",
      "-an",
      "-f", "image2",
      "-vcodec", "mjpeg",
      "-q:v", "6",
      "pipe:1"
    ];

    const ffmpeg = spawn("ffmpeg", args);
    const chunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      try { ffmpeg.kill("SIGKILL"); } catch (e) {}
    }, 3500);

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
    const fpsRate = isPreview ? "15" : "30";
    const qualityVal = isPreview ? "8" : "4";

    const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));
    const transportOpts = isRtmp 
      ? [] 
      : ["-rtsp_transport", "tcp", "-stimeout", "5000000", "-flags", "+low_delay"];

    const args = [
      "-thread_queue_size", "4096",
      "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
      "-fpsprobesize", "0",
      ...transportOpts,
      "-probesize", "500000",
      "-analyzeduration", "500000",
      "-i", cam.rtsp_url,
      "-r", fpsRate,
      "-vf", scaleFilter,
      "-an",
      "-c:v", "mjpeg",
      "-q:v", qualityVal,
      "-g", "15",
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

  // Dedicated Camera Audio Monitoring Endpoint for Local Audio Return / Fones
  app.get("/api/cameras/:id/audio", authenticate, (req, res) => {
    const db = getDb();
    const camId = parseInt(req.params.id);
    const cam = db.cameras.find((c: any) => c.id === camId);
    if (!cam) return res.status(404).json({ error: "Câmera não encontrada" });

    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "close",
      "Pragma": "no-cache",
      "X-Accel-Buffering": "no"
    });

    const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith("rtmp://") || cam.rtsp_url.startsWith("rtmps://"));
    const transportOpts = isRtmp ? [] : ["-rtsp_transport", "tcp", "-flags", "+low_delay"];

    const args = [
      "-thread_queue_size", "4096",
      "-fflags", "+nobuffer+genpts+igndts+discardcorrupt",
      ...transportOpts,
      "-probesize", "500000",
      "-analyzeduration", "500000",
      "-i", cam.rtsp_url,
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      "-f", "mp3",
      "-"
    ];

    const ff = spawn("ffmpeg", args);
    ff.stdout.pipe(res);

    let killed = false;
    const cleanup = () => {
      if (killed) return;
      killed = true;
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
    });
  });

  app.get("/api/database/status", authenticate, (req, res) => {
    const db = getDb();
    res.json({
      isMySql: isDatabaseMySql(),
      camerasCount: db.cameras.length,
      videosCount: db.videos.length,
      logosCount: (db.logos || []).length
    });
  });

  app.post("/api/cameras", authenticate, async (req, res) => {
    const newCam = { id: Date.now(), ...req.body };
    await dbAddCamera(newCam);
    io.emit("cameras", getDb().cameras);
    res.json(newCam);
  });

  app.put("/api/cameras/:id", authenticate, async (req, res) => {
    const camId = parseInt(req.params.id);
    const { name, rtsp_url } = req.body;
    const updated = await dbUpdateCamera(camId, { name, rtsp_url });
    if (!updated) return res.status(404).json({ error: "Câmera não encontrada" });
    io.emit("cameras", getDb().cameras);
    res.json(updated);
  });

  app.delete("/api/cameras/:id", authenticate, async (req, res) => {
    const camId = parseInt(req.params.id);
    await dbDeleteCamera(camId);
    io.emit("cameras", getDb().cameras);
    res.json({ success: true });
  });

  app.get("/api/videos", authenticate, (req, res) => {
    res.json(getDb().videos);
  });

  app.post("/api/videos", authenticate, handleUpload("video"), async (req, res) => {
    console.log("Recebendo requisição de upload de vídeo...");
    if (!req.file) {
      console.log("Nenhum arquivo recebido na requisição.");
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }
    console.log("Arquivo recebido:", req.file.originalname, "Salvo em:", req.file.path);
    
    const newVideo = {
      id: Date.now(),
      title: req.file.originalname,
      file_path: `uploads/${req.file.filename}`,
      created_at: new Date()
    };
    await dbAddVideo(newVideo);
    console.log("Vídeo salvo no banco de dados:", newVideo.id);
    io.emit("videos", getDb().videos);
    res.json(newVideo);
  });

  app.delete("/api/videos/:id", authenticate, async (req, res) => {
    const videoId = parseInt(req.params.id);
    const db = getDb();
    const video = db.videos.find((v: any) => v.id === videoId);
    if (video) {
      const fullPath = path.join(process.cwd(), video.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await dbDeleteVideo(videoId);
      io.emit("videos", getDb().videos);
    }
    res.json({ success: true });
  });

  // Logos Endpoints
  app.get("/api/logos", authenticate, (req, res) => {
    res.json(getDb().logos || []);
  });

  app.post("/api/logos/upload", authenticate, handleUpload("logo"), async (req, res) => {
    console.log("[SERVER] Recebendo requisição de upload de logo...");
    if (!req.file) {
      console.log("[SERVER] Nenhum arquivo recebido na requisição de logo.");
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }
    console.log("[SERVER] Logo recebida com sucesso:", req.file.originalname, "Salva em:", req.file.path);

    const newLogo = {
      id: Date.now(),
      name: req.file.originalname,
      file_path: `uploads/${req.file.filename}`,
      created_at: new Date()
    };
    await dbAddLogo(newLogo);
    const db = getDb();
    if (!db.stream_status.active_logo_id) {
      db.stream_status.active_logo_id = newLogo.id;
      saveDb(db);
    }

    // Se a transmissão estiver ativa e a logo habilitada, reinicia a transmissão para aplicar
    if (db.stream_status.is_streaming && db.stream_status.logo_enabled && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video")) {
      console.log("[SERVER] Reiniciando transmissão para exibir a nova logomarca enviada");
      startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
    }

    io.emit("stream_status", db.stream_status);
    res.json({ success: true, logo: newLogo, logos: db.logos });
  });

  app.delete("/api/logos/:id", authenticate, async (req, res) => {
    const logoId = parseInt(req.params.id);
    const db = getDb();
    const logo = (db.logos || []).find((l: any) => l.id === logoId);
    if (logo) {
      const fullPath = path.join(process.cwd(), logo.file_path);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (e) {}
      }
      await dbDeleteLogo(logoId);
      if (db.stream_status.active_logo_id === logoId) {
        db.stream_status.active_logo_id = db.logos[0]?.id || null;
        saveDb(db);
      }
      io.emit("stream_status", db.stream_status);

      if (db.stream_status.is_streaming && db.stream_status.logo_enabled && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video")) {
        console.log("[SERVER] Reiniciando transmissão devido a exclusão da logo ativa");
        startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
      }
    }
    res.json({ success: true, logos: db.logos || [] });
  });

  app.post("/api/status/logo", authenticate, (req, res) => {
    const { enabled, logo_id, position } = req.body;
    const db = getDb();
    const wasEnabled = db.stream_status.logo_enabled;
    const wasLogoId = db.stream_status.active_logo_id;
    const wasPosition = db.stream_status.logo_position;

    if (enabled !== undefined) db.stream_status.logo_enabled = enabled;
    if (logo_id !== undefined) db.stream_status.active_logo_id = logo_id;
    if (position !== undefined) db.stream_status.logo_position = position;

    saveDb(db);

    let needsRestart = false;
    if (db.stream_status.is_streaming && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video")) {
      if (enabled !== undefined && enabled !== wasEnabled) needsRestart = true;
      if (logo_id !== undefined && logo_id !== wasLogoId) needsRestart = true;
      if (position !== undefined && position !== wasPosition) needsRestart = true;
    }

    if (needsRestart && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video" || db.stream_status.current_source_type === "web")) {
      console.log("[SERVER] Reiniciando transmissão para aplicar alteração da logomarca");
      startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
    }

    io.emit("stream_status", db.stream_status);
    res.json({ success: true, status: db.stream_status });
  });

  app.post("/api/status/block-offline", authenticate, (req, res) => {
    const { block_offline_switch } = req.body;
    const db = getDb();
    if (block_offline_switch !== undefined) {
      db.stream_status.block_offline_switch = Boolean(block_offline_switch);
    }
    saveDb(db);
    io.emit("stream_status", db.stream_status);
    console.log(`[SERVER] Opção de bloqueio de troca de câmera offline alterada para: ${db.stream_status.block_offline_switch}`);
    res.json({ success: true, status: db.stream_status });
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
    
    if (needsRestart && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video" || db.stream_status.current_source_type === "web")) {
      console.log("[SERVER] Reiniciando transmissão devido a alteraçao dos filtros de overlay");
      startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
    }
    
    io.emit("stream_status", db.stream_status);
    res.json({ success: true, status: db.stream_status });
  });

  // Internal PCM audio stream endpoint for FFmpeg
  app.get("/internal/narration-audio-pcm", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "audio/l16; rate=44100; channels=2",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "close"
    });

    const unsubscribe = narrationStreamer.subscribe((chunk) => {
      if (!res.writableEnded) {
        try {
          res.write(chunk);
        } catch (e) {}
      }
    });

    req.on("close", () => {
      unsubscribe();
      if (!res.writableEnded) res.end();
    });
  });

  app.post("/api/status/narration", authenticate, (req, res) => {
    const { enabled, mode, volume } = req.body;
    const db = getDb();
    const wasEnabled = db.stream_status.mic_narration_enabled;
    const wasMode = db.stream_status.mic_narration_mode;

    if (enabled !== undefined) db.stream_status.mic_narration_enabled = Boolean(enabled);
    if (mode !== undefined) db.stream_status.mic_narration_mode = mode; // "replace" | "mix"
    if (volume !== undefined) db.stream_status.mic_narration_volume = Number(volume);

    saveDb(db);
    io.emit("stream_status", db.stream_status);

    // Se estiver transmitindo e a opção de narração mudou, reinicia a transmissão para aplicar o canal de áudio
    if (db.stream_status.is_streaming && (db.stream_status.current_source_type === "camera" || db.stream_status.current_source_type === "video")) {
      if (enabled !== undefined && enabled !== wasEnabled) {
        console.log("[SERVER] Reiniciando transmissão devido a alteração do áudio de narração");
        startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
      } else if (mode !== undefined && mode !== wasMode) {
        console.log("[SERVER] Reiniciando transmissão devido a alteração do modo de mixagem de áudio");
        startStream(db.stream_status.current_source_type, db.stream_status.current_source_id);
      }
    }

    res.json({ success: true, status: db.stream_status });
  });

  const checkCameraOnline = (rtspUrl: string, camId?: number): Promise<boolean> => {
    if (!rtspUrl) return Promise.resolve(false);
    
    const db = getDb();
    // Se esta câmera for a que está ativa na transmissão, ela está online com certeza!
    if (db.stream_status.is_streaming && db.stream_status.current_source_type === "camera" && db.stream_status.current_source_id === camId) {
      return Promise.resolve(true);
    }

    // Se a câmera estiver com preview ativo ou snapshot recente (< 15s)
    if (camId && activeHighQualityCamId === camId) {
      return Promise.resolve(true);
    }
    if (camId && snapshotCaches[camId] && snapshotCaches[camId].data.length > 0 && (Date.now() - snapshotCaches[camId].timestamp < 15000)) {
      return Promise.resolve(true);
    }

    const isRtmp = rtspUrl.startsWith("rtmp://") || rtspUrl.startsWith("rtmps://");
    const transportOpts = isRtmp ? [] : ["-rtsp_transport", "tcp", "-stimeout", "2500000"];
    const probeArgs = [
      ...transportOpts,
      "-v", "error",
      "-analyzeduration", "500000",
      "-probesize", "500000",
      "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1",
      rtspUrl
    ];

    return new Promise<boolean>((resolve) => {
      let proc: any = null;
      let out = "";
      try {
        proc = spawn("ffprobe", probeArgs);
      } catch (e) {
        return resolve(false);
      }

      const timer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch (e) {}
        const ok = out.toLowerCase().includes("video") || out.toLowerCase().includes("audio");
        resolve(ok);
      }, 3000);

      if (proc.stdout) {
        proc.stdout.on("data", (d: any) => { out += d.toString(); });
      }
      proc.on("close", (code: number) => {
        clearTimeout(timer);
        const ok = (code === 0) || out.toLowerCase().includes("video") || out.toLowerCase().includes("audio");
        resolve(ok);
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  };

  app.post("/api/stream/switch", authenticate, async (req, res) => {
    const { type, id } = req.body;
    const db = getDb();

    if (type === "camera") {
      const cam = db.cameras.find((c: any) => c.id === id);
      if (!cam) {
        return res.status(404).json({ error: "Câmera não encontrada." });
      }

      const shouldBlockOffline = db.stream_status.block_offline_switch !== false;
      if (shouldBlockOffline) {
        addLog(`[SERVER] Verificando sinal da câmera "${cam.name}" (ID ${cam.id})...\n`);
        const isOnline = await checkCameraOnline(cam.rtsp_url, cam.id);
        if (!isOnline) {
          addLog(`[SERVER] RECUSADO: Câmera "${cam.name}" está OFFLINE ou sem sinal de vídeo.\n`);
          return res.status(400).json({ error: `A câmera "${cam.name}" está OFFLINE ou sem sinal de vídeo. A transmissão não foi alterada.` });
        }
      } else {
        addLog(`[SERVER] Troca para a câmera "${cam.name}" permitida (Bloqueio de câmera offline DESATIVADO).\n`);
      }
    }

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
