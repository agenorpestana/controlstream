import React, { useState, useEffect, useRef } from 'react';
import { Camera, Video, Play, Square, Settings, Plus, Trash2, LogOut, Activity, Monitor, Upload, Repeat, RefreshCw, Mic, MicOff, Trophy, Pause, RotateCcw, Edit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io } from 'socket.io-client';

// Types
interface CameraData {
  id: number;
  name: string;
  rtsp_url: string;
  is_active: boolean;
}

interface VideoData {
  id: number;
  title: string;
  file_path: string;
  created_at: string;
}

interface StreamStatus {
  current_source_type: 'camera' | 'video' | 'web' | 'none';
  current_source_id: number | string | null;
  is_streaming: boolean;
  youtube_key: string;
  system_domain?: string;
  loop_video: boolean;
  scoreboard_enabled?: boolean;
  timer_enabled?: boolean;
  team_a_name?: string;
  team_b_name?: string;
  score_a?: number;
  score_b?: number;
  timer_seconds?: number;
  timer_running?: boolean;
}

const CameraPreview = ({ camId, className = '', isLive = true }: { camId: number, className?: string, isLive?: boolean, key?: string | number }) => {
  const token = localStorage.getItem('token');
  const [useMjpeg, setUseMjpeg] = useState(isLive);
  const [displayedSrc, setDisplayedSrc] = useState<string>(
    isLive ? `/api/cameras/${camId}/mjpeg?token=${token}&t=${Date.now()}` : `/api/cameras/${camId}/snapshot?token=${token}&t=${Date.now()}`
  );
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUseMjpeg(isLive);
  }, [camId, isLive]);

  useEffect(() => {
    if (useMjpeg) {
      setDisplayedSrc(`/api/cameras/${camId}/mjpeg?token=${token}&t=${Date.now()}`);
      setLoading(false);
      setError(false);
      return;
    }

    let active = true;
    const fetchNextFrame = () => {
      if (!active) return;
      const url = `/api/cameras/${camId}/snapshot?token=${token}&t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        if (active) {
          setDisplayedSrc(url);
          setLoading(false);
          setError(false);
        }
      };
      img.onerror = () => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      };
      img.src = url;
    };

    fetchNextFrame();
    const intervalTime = isLive ? 100 : 1000;
    const interval = setInterval(fetchNextFrame, intervalTime);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [camId, token, isLive, useMjpeg]);

  if (useMjpeg) {
    return (
      <div className={`relative bg-black/40 overflow-hidden ${className}`}>
        <img 
          key={`${camId}-${displayedSrc}`}
          src={displayedSrc} 
          alt="Live Camera Stream"
          className="w-full h-full object-contain"
          onError={() => {
            // Reconnect to 30fps MJPEG stream automatically after a brief moment
            setUseMjpeg(false);
            setTimeout(() => setUseMjpeg(true), 1500);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`relative bg-black/40 overflow-hidden ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
        </div>
      )}
      
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          <p className="text-red-400 text-[10px] font-bold uppercase mb-2">Erro de Conexão</p>
          <button 
            onClick={() => {
              setError(false);
              setLoading(true);
              setUseMjpeg(isLive);
            }}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-white" />
          </button>
        </div>
      ) : (
        <img 
          key={`${camId}-${displayedSrc}`}
          src={displayedSrc} 
          alt="Preview"
          className="w-full h-full object-contain"
        />
      )}
    </div>
  );
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cameras, setCameras] = useState<CameraData[]>([]);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'cameras' | 'videos' | 'settings'>('dashboard');
  const [newCam, setNewCam] = useState({ name: '', rtsp_url: '' });
  const [camProtocol, setCamProtocol] = useState<'rtsp' | 'rtmp'>('rtsp');
  const [rtmpStreamKey, setRtmpStreamKey] = useState(() => 'cam_' + Math.random().toString(36).substring(2, 8));

  // Edit Camera Modal State
  const [editingCam, setEditingCam] = useState<CameraData | null>(null);
  const [editCamName, setEditCamName] = useState('');
  const [editCamProtocol, setEditCamProtocol] = useState<'rtsp' | 'rtmp'>('rtsp');
  const [editCamRtspUrl, setEditCamRtspUrl] = useState('');
  const [editCamRtmpKey, setEditCamRtmpKey] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isTestingRtmp, setIsTestingRtmp] = useState(false);
  const [rtmpTestResult, setRtmpTestResult] = useState<{ type: string; message: string } | null>(null);
  const [systemDomainInput, setSystemDomainInput] = useState('');
  const [ytKey, setYtKey] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [ffmpegLogs, setFfmpegLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<any>(null);

  // Local Transmission State
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [requestAudioWithCamera, setRequestAudioWithCamera] = useState(true);
  const [isLocalStreaming, setIsLocalStreaming] = useState(false);
  const isLocalStreamingRef = useRef(false);
  
  const updateLocalStreaming = (val: boolean) => {
    setIsLocalStreaming(val);
    isLocalStreamingRef.current = val;
  };

  const errorCountRef = useRef(0);

  const processChunkQueue = async () => {
    if (isSendingChunkRef.current || chunkQueueRef.current.length === 0 || !isLocalStreamingRef.current) return;
    
    // WebM is a continuous stream, so we should avoid discarding packets unless absolutely necessary.
    // However, if the network is extremely slow and the queue grows excessively (e.g., > 15 chunks), we can trim it.
    if (chunkQueueRef.current.length > 15) {
      setFfmpegLogs(prev => [...prev.slice(-49), `[SISTEMA] Engarrafamento grave de rede (Fila: ${chunkQueueRef.current.length}). Limpando buffer para re-sincronizar...\n`]);
      chunkQueueRef.current = chunkQueueRef.current.slice(-3);
    }

    if (chunkQueueRef.current.length === 0) return;

    isSendingChunkRef.current = true;
    const buffer = chunkQueueRef.current[0]; // Peek first chunk

    // Prefer Socket.io if connected. Direct binary transfer is extremely fast & smooth!
    if (socketConnected && socketRef.current && socketRef.current.connected) {
      try {
        socketRef.current.emit("web_data", buffer);
        
        // Success! Remove from queue and schedule next
        chunkQueueRef.current.shift();
        errorCountRef.current = 0;
        isSendingChunkRef.current = false;
        
        if (Math.random() < 0.1) {
          setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Bloco enviado via Socket (Fila: ${chunkQueueRef.current.length})\n`]);
        }
        
        setTimeout(processChunkQueue, 10);
        return;
      } catch (err: any) {
        console.warn("[CLIENTE] Erro ao emitir via Socket, tentando POST fallback:", err);
      }
    }

    // Fallback: POST Request
    const token = localStorage.getItem('token');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch('/api/stream/web-data', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${token}`
        },
        body: buffer,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.status === 400) {
        const text = await res.text();
        if (text.includes("FFmpeg not running")) {
          console.error("[CLIENTE] Servidor informou que FFmpeg parou. Interrompendo envio local.");
          stopWebBroadcast();
          return;
        }
      }
      
      if (!res.ok) {
        const text = await res.text();
        const errorMsg = `HTTP ${res.status}: ${text}`;
        setFfmpegLogs(prev => [...prev.slice(-49), `[SISTEMA] Erro Servidor: ${errorMsg}\n`]);
        throw new Error(errorMsg);
      }
      
      chunkQueueRef.current.shift(); // Remove from queue on success
      errorCountRef.current = 0;
      
      if (Math.random() < 0.1) {
        setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Bloco enviado via Fallback POST (Fila: ${chunkQueueRef.current.length})\n`]);
      }
      
      isSendingChunkRef.current = false;
      setTimeout(processChunkQueue, 10);
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[CLIENTE] Erro ao enviar chunk via POST:", err);
      
      errorCountRef.current++;
      isSendingChunkRef.current = false;
      
      if (errorCountRef.current >= 3) {
        setFfmpegLogs(prev => [...prev.slice(-49), `[SISTEMA] Falhas repetidas: pulando bloco gago (Fila: ${chunkQueueRef.current.length})...\n`]);
        chunkQueueRef.current.shift(); // Remove the problematic chunk once it fails repeatedly
        errorCountRef.current = 0;
      }
      
      setTimeout(processChunkQueue, 1000);
    }
  };

  const [pipPosition, setPipPosition] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('bottom-right');

  // Sports Overlay States
  const [isScoreboardEnabled, setIsScoreboardEnabled] = useState(false);
  const [teamAName, setTeamAName] = useState('TIME A');
  const [teamBName, setTeamBName] = useState('TIME B');
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  
  const [isTimerEnabled, setIsTimerEnabled] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  // Sync refs so compositor loop can read instantly without dependency cycle
  const scoreboardEnabledRef = useRef(false);
  const teamANameRef = useRef('TIME A');
  const teamBNameRef = useRef('TIME B');
  const scoreARef = useRef(0);
  const scoreBRef = useRef(0);
  const timerEnabledRef = useRef(false);
  const timerSecondsRef = useRef(0);

  useEffect(() => { scoreboardEnabledRef.current = isScoreboardEnabled; }, [isScoreboardEnabled]);
  useEffect(() => { teamANameRef.current = teamAName; }, [teamAName]);
  useEffect(() => { teamBNameRef.current = teamBName; }, [teamBName]);
  useEffect(() => { scoreARef.current = scoreA; }, [scoreA]);
  useEffect(() => { scoreBRef.current = scoreB; }, [scoreB]);
  useEffect(() => { timerEnabledRef.current = isTimerEnabled; }, [isTimerEnabled]);
  useEffect(() => { timerSecondsRef.current = timerSeconds; }, [timerSeconds]);

  const updateSportsState = async (updates: Partial<{
    scoreboard_enabled: boolean;
    timer_enabled: boolean;
    team_a_name: string;
    team_b_name: string;
    score_a: number;
    score_b: number;
    timer_seconds: number;
    timer_running: boolean;
  }>) => {
    // Optimistic UI updates
    if (updates.scoreboard_enabled !== undefined) setIsScoreboardEnabled(updates.scoreboard_enabled);
    if (updates.timer_enabled !== undefined) setIsTimerEnabled(updates.timer_enabled);
    if (updates.team_a_name !== undefined) setTeamAName(updates.team_a_name);
    if (updates.team_b_name !== undefined) setTeamBName(updates.team_b_name);
    if (updates.score_a !== undefined) setScoreA(updates.score_a);
    if (updates.score_b !== undefined) setScoreB(updates.score_b);
    if (updates.timer_seconds !== undefined) setTimerSeconds(updates.timer_seconds);
    if (updates.timer_running !== undefined) setIsTimerRunning(updates.timer_running);

    const token = localStorage.getItem('token');
    try {
      await fetch('/api/status/sports', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error("Erro ao sincronizar placar esportivo com o servidor:", e);
    }
  };

  // Sports stopwatch timer tick
  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTimerRunning]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const standaloneMicStreamRef = useRef<MediaStream | null>(null);
  const chunkQueueRef = useRef<ArrayBuffer[]>([]);
  const isSendingChunkRef = useRef(false);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoggedIn) {
      fetchData();
      
      // Initialize socket with both polling and websocket fallback for supreme compatibility and zero dropouts
      const socket = io(window.location.origin, {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setSocketConnected(true);
        const transport = socket.io.engine.transport.name;
        setFfmpegLogs(prev => [...prev.slice(-49), `[SISTEMA] Socket Conectado via ${transport.toUpperCase()}\n`]);
      });

      socket.on('disconnect', (reason) => {
        setSocketConnected(false);
        setFfmpegLogs(prev => [...prev.slice(-49), `[SISTEMA] Socket Desconectado: ${reason}\n`]);
        if (reason === 'io server disconnect') {
          // the disconnection was initiated by the server, you need to reconnect manually
          socket.connect();
        }
      });

      socket.on('connect_error', (err) => {
        setSocketConnected(false);
        console.error("Socket connection error:", err);
        setFfmpegLogs(prev => [...prev.slice(-49), `[SISTEMA] Erro de Conexão Socket: ${err.message}. Usando fallback POST.\n`]);
      });

      socket.on('stream_status', (newStatus: StreamStatus) => {
        setStatus(newStatus);
        
        const activeEl = document.activeElement;
        const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        
        if (newStatus.scoreboard_enabled !== undefined) setIsScoreboardEnabled(newStatus.scoreboard_enabled);
        if (newStatus.timer_enabled !== undefined) setIsTimerEnabled(newStatus.timer_enabled);
        if (!isTyping) {
          if (newStatus.team_a_name !== undefined) setTeamAName(newStatus.team_a_name || 'TIME A');
          if (newStatus.team_b_name !== undefined) setTeamBName(newStatus.team_b_name || 'TIME B');
        }
        if (newStatus.score_a !== undefined) setScoreA(newStatus.score_a);
        if (newStatus.score_b !== undefined) setScoreB(newStatus.score_b);
        if (newStatus.timer_seconds !== undefined) setTimerSeconds(newStatus.timer_seconds);
        if (newStatus.timer_running !== undefined) setIsTimerRunning(newStatus.timer_running);

        // Use ref to avoid stale closure
        if (!newStatus.is_streaming && isLocalStreamingRef.current) {
          stopWebBroadcast();
        }
      });

      socket.on('ffmpeg_log', (log: string) => {
        setFfmpegLogs(prev => [...prev.slice(-49), log]);
      });

      socket.on('ffmpeg_log_clear', () => {
        setFfmpegLogs([]);
      });

    socket.on('server_ready_for_web', () => {
      setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] Recebido sinal de prontidão do servidor. Iniciando gravação...\n"]);
      // Use a small timeout to ensure state has propagated if needed, 
      // though we'll use the ref to be safe.
      setTimeout(() => startActualRecorder(), 100);
    });

      return () => {
        socket.disconnect();
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };
    }
  }, [isLoggedIn]);

  // Sync streams to video elements
  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
      screenVideoRef.current.play().catch(e => console.error("Erro ao dar play no vídeo da tela:", e));
    }
  }, [screenStream]);

  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      cameraVideoRef.current.srcObject = cameraStream;
      cameraVideoRef.current.play().catch(e => console.error("Erro ao dar play no vídeo da câmera:", e));
    }
  }, [cameraStream]);

  // Synchronize microphone mute/unmute state with stream tracks to support toggle during live streaming
  useEffect(() => {
    if (cameraStream) {
      cameraStream.getAudioTracks().forEach(track => {
        track.enabled = isMicEnabled;
      });
    }
    if (screenStream) {
      screenStream.getAudioTracks().forEach(track => {
        track.enabled = isMicEnabled;
      });
    }
  }, [isMicEnabled, cameraStream, screenStream]);

  // Compositor Loop with Web Worker fallback to prevent background throttling in browsers
  useEffect(() => {
    let active = true;
    let worker: Worker | null = null;

    if ((screenStream || cameraStream) && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d', { alpha: false });
      if (!ctx) return;

      const draw = () => {
        if (!active || !ctx || !canvasRef.current) return;
        
        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        // Draw Screen
        if (screenStream && screenVideoRef.current && screenVideoRef.current.readyState >= 2) {
          ctx.drawImage(screenVideoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        // Draw Camera PiP
        if (cameraStream && cameraVideoRef.current && cameraVideoRef.current.readyState >= 2) {
          const pipWidth = canvasRef.current.width / 5.2; // Slightly smaller camera frame size (approx 19.2% width instead of 25%)
          const videoRatio = cameraVideoRef.current.videoHeight / cameraVideoRef.current.videoWidth || 0.75;
          const pipHeight = videoRatio * pipWidth;
          let x = 20, y = 20;

          if (pipPosition === 'top-right') x = canvasRef.current.width - pipWidth - 20;
          if (pipPosition === 'bottom-left') y = canvasRef.current.height - pipHeight - 20;
          if (pipPosition === 'bottom-right') {
            x = canvasRef.current.width - pipWidth - 20;
            y = canvasRef.current.height - pipHeight - 20;
          }

          // Shadow/Border for PiP
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, pipWidth, pipHeight);
          ctx.drawImage(cameraVideoRef.current, x, y, pipWidth, pipHeight);
        }

        // Sports overlay drawing removed from local compositor loop since it is now implemented as an elegant floating HTML element over cameras and commercials in the control panel
      };

      // Native animation loop for smooth, stutter-free compositor drawing when the tab is visible
      const renderLoop = () => {
        if (!active) return;
        if (!document.hidden) {
          draw();
        }
        animationFrameRef.current = requestAnimationFrame(renderLoop);
      };
      animationFrameRef.current = requestAnimationFrame(renderLoop);

      // Inline Worker to tick dynamically even when minimized/active tab is backgrounded
      try {
        const workerCode = `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (timer) clearInterval(timer);
              timer = setInterval(() => {
                self.postMessage('tick');
              }, 40); // 25 frames per second
            } else if (e.data === 'stop') {
              if (timer) {
                clearInterval(timer);
                timer = null;
              }
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl);
        
        worker.onmessage = () => {
          if (active && document.hidden) {
            draw(); // Draw directly to the canvas in the background on worker tick
          }
        };
        worker.postMessage('start');
      } catch (err) {
        console.warn("Could not start Web Worker background loop. Relying on renderLoop only.", err);
      }
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      // Clear canvas if no streams
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    return () => {
      active = false;
      if (worker) {
        worker.postMessage('stop');
        worker.terminate();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [screenStream, cameraStream, pipPosition]);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [camsRes, vidsRes, statusRes] = await Promise.all([
        fetch('/api/cameras', { headers }),
        fetch('/api/videos', { headers }),
        fetch('/api/status', { headers })
      ]);
      
      if (camsRes.ok) setCameras(await camsRes.json());
      if (vidsRes.ok) setVideos(await vidsRes.json());
      if (statusRes.ok) {
        const s = await statusRes.json();
        setStatus(s);
        setYtKey(s.youtube_key);
        if (s.system_domain) {
          setSystemDomainInput(s.system_domain);
        }

        // Map scoreboard/timer states from server
        if (s.scoreboard_enabled !== undefined) setIsScoreboardEnabled(s.scoreboard_enabled);
        if (s.timer_enabled !== undefined) setIsTimerEnabled(s.timer_enabled);
        if (s.team_a_name !== undefined) setTeamAName(s.team_a_name);
        if (s.team_b_name !== undefined) setTeamBName(s.team_b_name);
        if (s.score_a !== undefined) setScoreA(s.score_a);
        if (s.score_b !== undefined) setScoreB(s.score_b);
        if (s.timer_seconds !== undefined) setTimerSeconds(s.timer_seconds);
        if (s.timer_running !== undefined) setIsTimerRunning(s.timer_running);

        // Watchdog: if server says it's not web anymore, but we are still streaming locally
        if (isLocalStreamingRef.current && s.current_source_type !== 'web' && !isSwitching) {
          console.warn("[CLIENTE] Servidor não está mais em modo web. Parando local...");
          stopWebBroadcast();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token);
        setIsLoggedIn(true);
      } else {
        alert('Falha no login');
      }
    } catch (e) {
      alert('Erro ao conectar com o servidor');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsLoggedIn(false);
  };

  const [isSwitching, setIsSwitching] = useState(false);

  const switchStream = async (type: 'camera' | 'video' | 'web', id: number | string) => {
    if (isSwitching) return;
    setIsSwitching(true);
    const token = localStorage.getItem('token');
    setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Solicitando troca de stream para: ${type} (${id})...\n`]);
    
    // Optimistic update to show immediate response
    if (status) {
      setStatus({ ...status, is_streaming: true, current_source_type: type, current_source_id: id });
    }

    try {
      const response = await fetch('/api/stream/switch', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ type, id })
      });
      if (!response.ok) {
        throw new Error(`Erro na API: ${response.statusText}`);
      }
      setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] API respondeu com sucesso.\n`]);
      
      // Se trocamos para web/local, ativamos um gatilho de seguranca
      // caso o evento socket 'server_ready_for_web' nao seja recebido (ex: socket bloqueado/desconectado)
      if (type === 'web' && id === 'local') {
        setTimeout(() => {
          if (isLocalStreamingRef.current) {
            const hasStarted = mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive';
            if (!hasStarted) {
              setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] Gatilho de segurança: Sinal Socket ausente. Iniciando gravação via fallback de rede...\n"]);
              startActualRecorder();
            }
          }
        }, 2500);
      }
    } catch (error: any) {
      setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] ERRO NA TROCA DE STREAM: ${error.message}\n`]);
    } finally {
      // Pequeno delay para o servidor salvar o DB antes de buscarmos
      setTimeout(() => {
        fetchData();
        setIsSwitching(false);
      }, 1000);
    }
  };

  const stopStream = async () => {
    const token = localStorage.getItem('token');
    
    // Optimistic
    if (status) {
      setStatus({ ...status, is_streaming: false, current_source_type: 'none', current_source_id: null });
    }

    if (isLocalStreaming) {
      stopWebBroadcast();
    }

    await fetch('/api/stream/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchData();
  };

  // Local Source Handlers
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      setScreenStream(stream);
      stream.getVideoTracks()[0].onended = () => setScreenStream(null);
    } catch (e) {
      console.error("Erro ao compartilhar tela:", e);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: requestAudioWithCamera 
      });
      setCameraStream(stream);
      // Sincronizar estado inicial de mutar/desmutar o áudio do microfone
      stream.getAudioTracks().forEach(track => {
        track.enabled = isMicEnabled;
      });
    } catch (e) {
      if (requestAudioWithCamera) {
        console.warn("Erro ao acessar câmera com áudio, tentando apenas vídeo:", e);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          setCameraStream(stream);
        } catch (e2) {
          console.error("Erro ao acessar câmera:", e2);
        }
      } else {
        console.error("Erro ao acessar câmera:", e);
      }
    }
  };

  const stopLocalSources = () => {
    screenStream?.getTracks().forEach(t => t.stop());
    cameraStream?.getTracks().forEach(t => t.stop());
    if (standaloneMicStreamRef.current) {
      try {
        standaloneMicStreamRef.current.getTracks().forEach(t => t.stop());
      } catch (e) {}
      standaloneMicStreamRef.current = null;
    }
    setScreenStream(null);
    setCameraStream(null);
  };

  const startWebBroadcast = async () => {
    if (!canvasRef.current) return;
    
    // Resume AudioContext on user gesture
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();

    updateLocalStreaming(true);
    await switchStream('web', 'local');
  };

  const startActualRecorder = () => {
    // Evitar iniciar múltiplos gravadores se já houver um rodando e ativo
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] Ignorando startActualRecorder duplicado (gravador já ativo).\n"]);
      return;
    }

    setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] Executando startActualRecorder...\n"]);
    
    // Reset queue and error counters
    chunkQueueRef.current = [];
    isSendingChunkRef.current = false;
    errorCountRef.current = 0;

    // Stop any existing recorder first
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.error("Erro ao parar recorder anterior:", e);
      }
    }

    if (!canvasRef.current || !isLocalStreamingRef.current) {
      setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] ABORTADO: canvas=${!!canvasRef.current}, isLocalStreaming=${isLocalStreamingRef.current}\n`]);
      return;
    }

    // Small extra delay to ensure FFmpeg pipe is fully open
    setTimeout(async () => {
      if (!canvasRef.current || !isLocalStreamingRef.current) {
        setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] ABORTADO no timeout (streaming parado).\n"]);
        return;
      }
      
      setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] Capturando stream do canvas (25 FPS)...\n"]);
      const canvasStream = canvasRef.current.captureStream(25);
      const videoTrack = canvasStream.getVideoTracks()[0];
      const streamTracks: MediaStreamTrack[] = [];
      if (videoTrack) {
        streamTracks.push(videoTrack);
      }
      
      // Determine if visual/screen or camera already has a microphone/audio tract
      let audioTrack = screenStream?.getAudioTracks()[0] || cameraStream?.getAudioTracks()[0];
      
      // Standalone Mic Fallback: If microphone is enabled but neither screen nor camera provided audio,
      // request direct microphone stream so the broadcaster can always speak on YouTube!
      if (!audioTrack && isMicEnabled) {
        setFfmpegLogs(prev => [...prev.slice(-49), "[SISTEMA] Solicitando acesso ao microfone para a transmissão...\n"]);
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          standaloneMicStreamRef.current = micStream;
          audioTrack = micStream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = isMicEnabled;
            setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] Áudio do microfone ativado com sucesso.\n"]);
          }
        } catch (e: any) {
          setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Falha ao recuperar microfone standalone: ${e.message}\n`]);
        }
      }
      
      if (audioTrack) {
        streamTracks.push(audioTrack);
      } else {
        // Create silent audio track if none exists
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const dst = ctx.createMediaStreamDestination();
        oscillator.connect(gain);
        gain.connect(dst);
        oscillator.start();
        const silentTrack = dst.stream.getAudioTracks()[0];
        if (silentTrack) {
          streamTracks.push(silentTrack);
        }
      }

      // Combine video and audio tracks from scratch to force browser to include both streams into the MediaRecorder container
      const combinedStream = new MediaStream(streamTracks);
      
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')
        ? 'video/webm;codecs=h264,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') 
          ? 'video/webm;codecs=vp8,opus' 
          : 'video/webm';
        
      setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Usando mimeType: ${mimeType}\n`]);
      setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Bitrate: 2500kbps (Recomendado pelo YouTube)\n`]);

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2500000, // Increased to match YouTube recommendation
        audioBitsPerSecond: 128000
      });

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && isLocalStreamingRef.current) {
          try {
            const buffer = await event.data.arrayBuffer();
            chunkQueueRef.current.push(buffer);
            processChunkQueue();
            
            if (Math.random() < 0.1) {
              setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] Chunk enfileirado: ${event.data.size} bytes (Fila: ${chunkQueueRef.current.length})\n`]);
            }
          } catch (err: any) {
            console.error("[CLIENTE] Erro ao processar chunk:", err);
          }
        }
      };

      recorder.onstart = () => {
        setFfmpegLogs(prev => [...prev.slice(-49), "[CLIENTE] MediaRecorder iniciado com sucesso.\n"]);
      };

      recorder.onerror = (e) => {
        setFfmpegLogs(prev => [...prev.slice(-49), `[CLIENTE] ERRO NO MediaRecorder: ${e}\n`]);
      };

      recorder.start(2000); // 2.0-second chunking for superb bandwidth balance and stable keyframes
      mediaRecorderRef.current = recorder;
    }, 500);
  };

  const stopWebBroadcast = () => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
      mediaRecorderRef.current = null;
    }
    if (standaloneMicStreamRef.current) {
      try {
        standaloneMicStreamRef.current.getTracks().forEach(t => t.stop());
      } catch (e) {}
      standaloneMicStreamRef.current = null;
    }
    updateLocalStreaming(false);
    chunkQueueRef.current = [];
    isSendingChunkRef.current = false;
    errorCountRef.current = 0;
  };

  const generateNewStreamKey = () => {
    const key = 'cam_' + Math.random().toString(36).substring(2, 8);
    setRtmpStreamKey(key);
    setRtmpTestResult(null);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const testRtmpSignal = async () => {
    setIsTestingRtmp(true);
    setRtmpTestResult(null);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch('/api/cameras/test-rtmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stream_key: rtmpStreamKey })
      });
      const data = await res.json();
      setRtmpTestResult({ type: data.status, message: data.message });
    } catch (err) {
      setRtmpTestResult({ type: 'error', message: 'Erro ao se comunicar com o servidor para testar recepção RTMP.' });
    } finally {
      setIsTestingRtmp(false);
    }
  };

  const saveSystemDomain = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch('/api/status/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain: systemDomainInput })
      });
      if (res.ok) {
        alert('Domínio do sistema atualizado com sucesso!');
        fetchData();
      }
    } catch (e) {
      alert('Erro ao salvar domínio');
    }
  };

  const addCamera = async () => {
    if (!newCam.name.trim()) {
      alert('Informe o nome identificador da câmera.');
      return;
    }

    const token = localStorage.getItem('token');
    let url = newCam.rtsp_url;
    
    if (camProtocol === 'rtmp') {
      const currentHost = window.location.hostname;
      const domain = (status?.system_domain && status.system_domain.trim() !== '' && status.system_domain !== 'centralitl.unityautomacoes.com.br') ? status.system_domain : (currentHost || 'localhost');
      url = `rtmp://${domain}:1935/live/${rtmpStreamKey}`;
    } else {
      if (!url.trim()) {
        alert('Informe a URL RTSP da câmera.');
        return;
      }
    }

    await fetch('/api/cameras', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ name: newCam.name, rtsp_url: url })
    });

    setNewCam({ name: '', rtsp_url: '' });
    generateNewStreamKey();
    fetchData();
  };

  const deleteCamera = async (id: number) => {
    const token = localStorage.getItem('token');
    await fetch(`/api/cameras/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchData();
  };

  const openEditCamModal = (cam: CameraData) => {
    setEditingCam(cam);
    setEditCamName(cam.name);
    const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith('rtmp://') || cam.rtsp_url.startsWith('rtmps://'));
    if (isRtmp) {
      setEditCamProtocol('rtmp');
      const parts = cam.rtsp_url.split('/');
      const key = parts[parts.length - 1] || '';
      setEditCamRtmpKey(key);
      setEditCamRtspUrl('');
    } else {
      setEditCamProtocol('rtsp');
      setEditCamRtspUrl(cam.rtsp_url);
      setEditCamRtmpKey('');
    }
  };

  const saveEditedCamera = async () => {
    if (!editingCam) return;
    if (!editCamName.trim()) {
      alert('Informe o nome da câmera.');
      return;
    }

    let finalUrl = editCamRtspUrl;
    if (editCamProtocol === 'rtmp') {
      const currentHost = window.location.hostname;
      const domain = (status?.system_domain && status.system_domain.trim() !== '' && status.system_domain !== 'centralitl.unityautomacoes.com.br') ? status.system_domain : (currentHost || 'localhost');
      finalUrl = `rtmp://${domain}:1935/live/${editCamRtmpKey}`;
    } else {
      if (!finalUrl.trim()) {
        alert('Informe a URL RTSP da câmera.');
        return;
      }
    }

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`/api/cameras/${editingCam.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: editCamName, rtsp_url: finalUrl })
      });
      if (res.ok) {
        setEditingCam(null);
        fetchData();
      } else {
        alert('Erro ao atualizar câmera.');
      }
    } catch (err) {
      alert('Erro de conexão ao atualizar câmera.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log("Arquivo selecionado:", file?.name);
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('video', file);

    const token = localStorage.getItem('token');
    console.log("Iniciando upload para /api/videos...");
    try {
      const res = await fetch('/api/videos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      console.log("Resposta do servidor:", res.status);
      if (res.ok) {
        console.log("Upload concluído com sucesso!");
        fetchData();
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error("Erro no upload:", errorData);
        alert('Erro ao enviar vídeo: ' + (errorData.error || res.statusText));
      }
    } catch (e) {
      console.error('Erro na conexão durante upload:', e);
      alert('Erro na conexão ao enviar vídeo');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteVideo = async (id: number) => {
    const token = localStorage.getItem('token');
    await fetch(`/api/videos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchData();
  };

  const saveYtKey = async () => {
    const token = localStorage.getItem('token');
    await fetch('/api/status/key', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ key: ytKey })
    });
    alert('Chave do YouTube Salva');
  };

  const toggleLoop = async () => {
    const token = localStorage.getItem('token');
    const newLoop = !status?.loop_video;
    
    // Optimistic update
    if (status) {
      setStatus({ ...status, loop_video: newLoop });
    }

    try {
      await fetch('/api/status/loop', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ loop: newLoop })
      });
    } catch (e) {
      console.error("Erro ao alternar loop:", e);
      // Revert on error
      fetchData();
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 font-sans text-white">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#151619] p-8 rounded-2xl border border-white/10 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
              <Activity className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">StreamControl</h1>
            <p className="text-white/50 text-sm mt-2 font-mono uppercase tracking-widest">Sistema de Gerenciamento de Transmissão</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-white/40 mb-2">Usuário</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="admin"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-white/40 mb-2">Senha</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="••••••••"
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
            >
              Acessar Painel
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col lg:flex-row font-sans">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 bg-[#151619] border-b lg:border-r border-white/10 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <Activity className="text-emerald-500 w-6 h-6" />
          <span className="text-xl font-bold tracking-tight">StreamControl</span>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:bg-white/5'}`}
          >
            <Monitor size={20} />
            <span className="font-medium">Painel</span>
          </button>
          <button 
            onClick={() => setActiveTab('cameras')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'cameras' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:bg-white/5'}`}
          >
            <Camera size={20} />
            <span className="font-medium">Câmeras</span>
          </button>
          <button 
            onClick={() => setActiveTab('videos')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'videos' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:bg-white/5'}`}
          >
            <Video size={20} />
            <span className="font-medium">Vídeos</span>
          </button>
          <button 
            onClick={() => setActiveTab('local')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'local' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:bg-white/5'}`}
          >
            <Monitor size={20} />
            <span className="font-medium">Transmissão Local</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:bg-white/5'}`}
          >
            <Settings size={20} />
            <span className="font-medium">Configurações</span>
          </button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
          >
            <LogOut size={20} />
            <span className="font-medium">Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-10">
        {/* Hidden elements for capture and composition - persistent across tabs */}
        <div className="fixed opacity-0 pointer-events-none w-0 h-0 overflow-hidden">
          <canvas 
            ref={canvasRef} 
            width={1280} 
            height={720} 
          />
          <video ref={screenVideoRef} autoPlay muted playsInline />
          <video ref={cameraVideoRef} autoPlay muted playsInline />
        </div>

        <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold capitalize">{activeTab === 'dashboard' ? 'Painel de Controle' : activeTab === 'cameras' ? 'Câmeras' : activeTab === 'videos' ? 'Vídeos Comerciais' : 'Configurações'}</h2>
            <p className="text-white/40 mt-1">Gerencie sua infraestrutura de transmissão ao vivo</p>
          </div>
          
          <div className="flex items-center gap-4 bg-[#151619] p-2 rounded-2xl border border-white/10">
            <div className={`w-3 h-3 rounded-full ${status?.is_streaming ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
            <span className="text-sm font-mono uppercase tracking-wider">
              {status?.is_streaming ? 'Ao Vivo' : 'Em Espera'}
            </span>
            {status?.is_streaming && (
              <button 
                onClick={stopStream}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
              >
                PARAR
              </button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="grid grid-cols-1 xl:grid-cols-3 gap-8"
            >
              {/* Live Preview / Program */}
              <div className="xl:col-span-2 space-y-6">
                <div className="bg-[#151619] rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
                    <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/20">
                      <span className="text-xs font-mono uppercase tracking-widest text-white/40">Saída do Programa</span>
                      <div className="flex items-center gap-3">
                        {status?.is_streaming && status.current_source_type === 'video' && isLocalStreaming && (
                          <button 
                            onClick={() => switchStream('web', 'local')}
                            className="bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded uppercase tracking-tight transition-all flex items-center gap-1"
                          >
                            <Monitor size={12} />
                            Voltar para Local
                          </button>
                        )}
                        {status?.is_streaming && (
                          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter">No Ar</span>
                        )}
                      </div>
                    </div>
                  <div className="aspect-video bg-black flex items-center justify-center relative">
                    {status?.is_streaming ? (
                      <div className="w-full h-full relative">
                        {status.current_source_type === 'video' ? (
                          <video 
                            key={status.current_source_id}
                            src={`/${videos.find(v => v.id === status.current_source_id)?.file_path}`}
                            autoPlay
                            muted
                            loop={status.loop_video}
                            className="w-full h-full object-contain"
                          />
                        ) : status.current_source_type === 'web' ? (
                          <div className="w-full h-full flex flex-col items-center justify-center">
                            <div className="w-full h-full max-h-[90%] relative">
                               <canvas 
                                 id="dashboard-preview-canvas"
                                 className="w-full h-full object-contain"
                                 ref={(el) => {
                                   if (el && canvasRef.current) {
                                     const ctx = el.getContext('2d');
                                     const sourceCanvas = canvasRef.current;
                                     let active = true;
                                     const render = () => {
                                       if (!active) return;
                                       if (ctx && sourceCanvas) {
                                         ctx.drawImage(sourceCanvas, 0, 0, el.width, el.height);
                                         requestAnimationFrame(render);
                                       }
                                     };
                                     render();
                                     // This is still a bit hacky but better with the 'active' flag if we could clean it up.
                                     // In React, it's better to use a dedicated component for this.
                                   }
                                 }}
                                 width={1280}
                                 height={720}
                               />
                            </div>
                            <p className="font-mono text-[10px] text-white/40 mt-2 uppercase tracking-widest">Transmissão Local Ativa</p>
                          </div>
                        ) : status.current_source_type === 'camera' ? (
                          <div className="w-full h-full relative">
                            <CameraPreview key={`main-cam-${status.current_source_id}`} camId={status.current_source_id as number} className="w-full h-full object-contain" isLive={true} />
                            <div className="absolute inset-0 bg-black/20 pointer-events-none" />
                            <div className="absolute bottom-4 left-4 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
                              <span className="text-[10px] font-mono text-white/60 uppercase tracking-widest">
                                Streaming: Câmera #{status.current_source_id}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full">
                            <Activity className="w-12 h-12 text-emerald-500 mx-auto mb-4 animate-pulse" />
                            <p className="font-mono text-sm text-white/60">Fonte Atual: Câmera #{status.current_source_id}</p>
                          </div>
                        )}
                        <div className="absolute top-4 right-4 flex gap-2">
                          {status.current_source_type === 'video' && isLocalStreaming && (
                            <button 
                              onClick={() => switchStream('web', 'local')}
                              className="bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded uppercase tracking-tight shadow-lg flex items-center gap-1"
                            >
                              <Square size={10} /> Parar Comercial
                            </button>
                          )}
                          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter">No Ar</span>
                          {status.loop_video && status.current_source_type === 'video' && (
                            <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter flex items-center gap-1">
                              <Repeat size={10} /> Loop
                            </span>
                          )}
                        </div>

                        {/* Sports Overlay (Placar e Cronômetro) - Only shown for cameras and commercials */}
                        {status.current_source_type !== 'web' && (isScoreboardEnabled || isTimerEnabled) && (
                          <div className="absolute top-4 left-4 z-40 flex items-center select-none scale-[0.3] sm:scale-[0.38] md:scale-[0.45] lg:scale-[0.5] origin-top-left pointer-events-none drop-shadow-lg font-sans">
                            {isScoreboardEnabled && (
                              <div className="flex bg-[#0f1117]/95 border-l-4 border-amber-500 rounded-l-md px-4 py-2 h-[42px] items-center gap-3 w-[280px] sm:w-[320px] md:w-[360px] justify-between">
                                {/* Team A */}
                                <span className="text-white font-bold text-xs md:text-sm tracking-wide uppercase truncate text-right flex-1 select-none pr-1">
                                  {teamAName || "TIME A"}
                                </span>
                                {/* Score A Box */}
                                <div className="bg-white/10 rounded px-2 md:px-2.5 py-0.5 min-w-[28px] md:min-w-[32px] text-center font-mono font-extrabold text-white text-xs md:text-base select-none">
                                  {scoreA}
                                </div>
                                {/* Divider */}
                                <div className="h-5 w-[1px] bg-white/20 select-none" />
                                {/* Score B Box */}
                                <div className="bg-white/10 rounded px-2 md:px-2.5 py-0.5 min-w-[28px] md:min-w-[32px] text-center font-mono font-extrabold text-white text-xs md:text-base select-none">
                                  {scoreB}
                                </div>
                                {/* Team B */}
                                <span className="text-white font-bold text-xs md:text-sm tracking-wide uppercase truncate text-left flex-1 select-none pl-1">
                                  {teamBName || "TIME B"}
                                </span>
                              </div>
                            )}

                            {isTimerEnabled && (
                              <div className={`font-mono font-extrabold text-xs md:text-base px-3 md:px-4 py-2 h-[42px] flex items-center justify-center min-w-[65px] md:min-w-[80px] text-black bg-amber-500 ${isScoreboardEnabled ? 'rounded-r-md' : 'rounded-md'}`}>
                                {String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:{String(timerSeconds % 60).padStart(2, '0')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center p-10">
                        <Monitor className="w-16 h-16 text-white/10 mx-auto mb-4" />
                        <p className="text-white/30 font-medium">Nenhuma transmissão ativa</p>
                        <p className="text-white/10 text-xs mt-2">Selecione uma câmera ou vídeo abaixo para iniciar</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {cameras.map(cam => (
                    <div key={cam.id} className={`bg-[#151619] rounded-2xl border transition-all overflow-hidden group ${status?.current_source_id === cam.id && status.current_source_type === 'camera' ? 'border-emerald-500 shadow-lg shadow-emerald-500/10' : 'border-white/10 hover:border-white/20'}`}>
                      <div className="aspect-video bg-black/40 relative">
                        <CameraPreview key={`dash-cam-${cam.id}`} camId={cam.id} className="w-full h-full opacity-40 group-hover:opacity-60 transition-opacity" isLive={true} />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60">
                          <button 
                            onClick={() => switchStream('camera', cam.id)}
                            className="bg-emerald-500 text-white p-4 rounded-full shadow-xl transform scale-90 group-hover:scale-100 transition-transform"
                          >
                            <Play fill="currentColor" size={24} />
                          </button>
                        </div>
                        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider">
                          CAM {cam.id}
                        </div>
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <h4 className="font-bold">{cam.name}</h4>
                          <p className="text-xs text-white/40 font-mono truncate max-w-[150px]">{cam.rtsp_url}</p>
                        </div>
                        {status?.current_source_id === cam.id && status.current_source_type === 'camera' && (
                          <div className="flex items-center gap-2 text-emerald-500">
                            <Activity size={16} className="animate-pulse" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Ativo</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sidebar Info */}
              <div className="space-y-6">
                <div className="bg-[#151619] rounded-3xl border border-white/10 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Activity size={18} className="text-emerald-500" />
                      Status do Sistema
                    </h3>
                    <button 
                      onClick={() => setShowLogs(!showLogs)}
                      className="text-[10px] font-bold text-emerald-500 hover:underline uppercase tracking-widest"
                    >
                      {showLogs ? 'Ocultar Logs' : 'Ver Logs FFmpeg'}
                    </button>
                  </div>
                  
                  {showLogs ? (
                    <div className="bg-black/40 rounded-xl p-3 font-mono text-[10px] h-64 overflow-y-auto space-y-1 border border-white/5">
                      {ffmpegLogs.length === 0 ? (
                        <p className="text-white/20">Aguardando logs...</p>
                      ) : (
                        ffmpegLogs.map((log, i) => (
                          <p key={i} className="text-white/60 break-all">{log}</p>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-3 bg-black/20 rounded-xl">
                        <span className="text-sm text-white/40">Uso de CPU</span>
                        <span className="text-sm font-mono">12%</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-black/20 rounded-xl">
                        <span className="text-sm text-white/40">Memória</span>
                        <span className="text-sm font-mono">450MB</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-black/20 rounded-xl">
                        <span className="text-sm text-white/40">FFmpeg</span>
                        <span className={`text-sm font-mono ${status?.is_streaming ? 'text-emerald-500' : 'text-white/20'}`}>
                          {status?.is_streaming ? 'EXECUTANDO' : 'OCIOSO'}
                        </span>
                      </div>
                      <div className="pt-2">
                        <button 
                          onClick={toggleLoop}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${status?.loop_video ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500' : 'bg-black/20 border-white/5 text-white/40 hover:border-white/20'}`}
                        >
                          <div className="flex items-center gap-3">
                            <Repeat size={16} />
                            <span className="text-sm font-medium">Repetir Vídeo (Loop)</span>
                          </div>
                          <div className={`w-8 h-4 rounded-full relative transition-colors ${status?.loop_video ? 'bg-emerald-500' : 'bg-white/10'}`}>
                            <div className={`absolute top-1 w-2 h-2 rounded-full bg-white transition-all ${status?.loop_video ? 'left-5' : 'left-1'}`} />
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-[#151619] rounded-3xl border border-white/10 p-6">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Video size={18} className="text-emerald-500" />
                    Comerciais Rápidos
                  </h3>
                  <div className="space-y-3">
                    {videos.length === 0 ? (
                      <div className="text-center py-6 border-2 border-dashed border-white/5 rounded-2xl">
                        <p className="text-white/20 text-xs">Nenhum vídeo</p>
                      </div>
                    ) : (
                      videos.slice(0, 3).map(vid => (
                        <button 
                          key={vid.id}
                          onClick={() => switchStream('video', vid.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${status?.current_source_id === vid.id && status.current_source_type === 'video' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500' : 'bg-black/20 border-white/5 text-white/60 hover:border-white/20'}`}
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <Video size={16} />
                            <span className="text-xs font-medium truncate">{vid.title}</span>
                          </div>
                          <Play size={12} fill="currentColor" />
                        </button>
                      ))
                    )}
                    <button 
                      onClick={() => setActiveTab('videos')}
                      className="w-full text-center text-[10px] font-bold text-emerald-500 hover:underline mt-2 uppercase tracking-widest"
                    >
                      Ver Todos os Vídeos
                    </button>
                  </div>
                </div>

                {/* Painel de Esportes / Placar e Cronômetro */}
                <div className="bg-[#151619] rounded-3xl border border-white/10 p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                      <Trophy size={20} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Sobreposição de Esportes</h3>
                      <p className="text-xs text-white/40">Placar e cronômetro ao vivo em tempo real</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* Toggles Principais */}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => updateSportsState({ scoreboard_enabled: !isScoreboardEnabled })}
                        className={`p-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1.5 ${isScoreboardEnabled ? 'bg-amber-500/10 border-amber-500 text-amber-500' : 'bg-black/20 border-white/5 text-white/40 hover:border-white/10'}`}
                      >
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-60">Modo Placar</span>
                        <span className="text-xs uppercase font-bold">{isScoreboardEnabled ? 'Ativado' : 'Desativado'}</span>
                      </button>

                      <button
                        onClick={() => updateSportsState({ timer_enabled: !isTimerEnabled })}
                        className={`p-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1.5 ${isTimerEnabled ? 'bg-amber-500/10 border-amber-500 text-amber-500' : 'bg-black/20 border-white/5 text-white/40 hover:border-white/10'}`}
                      >
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-60">Modo Cronômetro</span>
                        <span className="text-xs uppercase font-bold">{isTimerEnabled ? 'Ativado' : 'Desativado'}</span>
                      </button>
                    </div>

                    {/* Configuração de Times & Pontuação */}
                    {isScoreboardEnabled && (
                      <div className="space-y-4 pt-4 border-t border-white/5 animate-fade-in">
                        <h4 className="text-xs font-mono uppercase tracking-wider text-white/40">Configurações do Placar</h4>
                        
                        <div className="grid grid-cols-2 gap-4">
                          {/* TIME A */}
                          <div className="bg-black/20 rounded-2xl p-3 border border-white/5 space-y-3">
                            <div>
                              <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Time A</label>
                              <input
                                  type="text"
                                  value={teamAName}
                                  onChange={(e) => setTeamAName(e.target.value)}
                                  onBlur={() => updateSportsState({ team_a_name: teamAName })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      updateSportsState({ team_a_name: teamAName });
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 font-bold"
                                  placeholder="TIME A"
                                />
                            </div>
                            
                            <div className="flex items-center justify-between gap-1">
                              <button
                                onClick={() => updateSportsState({ score_a: Math.max(0, scoreA - 1) })}
                                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white flex items-center justify-center font-bold text-sm transition-all"
                              >
                                -
                              </button>
                              <span className="font-mono text-xl font-extrabold text-white">{scoreA}</span>
                              <button
                                onClick={() => updateSportsState({ score_a: scoreA + 1 })}
                                className="w-8 h-8 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-sm transition-all"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* TIME B */}
                          <div className="bg-black/20 rounded-2xl p-3 border border-white/5 space-y-3">
                            <div>
                              <label className="block text-[10px] font-mono text-white/40 uppercase mb-1">Time B</label>
                              <input
                                  type="text"
                                  value={teamBName}
                                  onChange={(e) => setTeamBName(e.target.value)}
                                  onBlur={() => updateSportsState({ team_b_name: teamBName })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      updateSportsState({ team_b_name: teamBName });
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 font-bold"
                                  placeholder="TIME B"
                                />
                            </div>
                            
                            <div className="flex items-center justify-between gap-1">
                              <button
                                onClick={() => updateSportsState({ score_b: Math.max(0, scoreB - 1) })}
                                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white flex items-center justify-center font-bold text-sm transition-all"
                              >
                                -
                              </button>
                              <span className="font-mono text-xl font-extrabold text-white">{scoreB}</span>
                              <button
                                onClick={() => updateSportsState({ score_b: scoreB + 1 })}
                                className="w-8 h-8 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-sm transition-all"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Controle do Cronômetro */}
                    {isTimerEnabled && (
                      <div className="space-y-4 pt-4 border-t border-white/5 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-mono uppercase tracking-wider text-white/40">Controle do Tempo</h4>
                          <span className="font-mono text-base font-extrabold text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-lg">
                            {String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:{String(timerSeconds % 60).padStart(2, '0')}
                          </span>
                        </div>

                        {/* Botões de Ação do Cronômetro */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateSportsState({ timer_running: !isTimerRunning })}
                            className={`flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${isTimerRunning ? 'bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'}`}
                          >
                            {isTimerRunning ? <Pause size={14} /> : <Play size={14} />}
                            {isTimerRunning ? 'Pausar' : 'Iniciar'}
                          </button>

                          <button
                            onClick={() => {
                              updateSportsState({ timer_running: false, timer_seconds: 0 });
                            }}
                            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                          >
                            <RotateCcw size={14} />
                            Zerar
                          </button>
                        </div>

                        {/* Ajuste Rápido de Minutos */}
                        <div className="grid grid-cols-3 gap-1.5 text-center font-bold">
                          <button
                            onClick={() => updateSportsState({ timer_seconds: Math.max(0, timerSeconds - 60) })}
                            className="py-1.5 rounded-lg bg-black/40 hover:bg-black/60 border border-white/5 text-[10px] font-mono text-white/60 transition-all font-bold"
                          >
                            - 1 Min
                          </button>
                          <button
                            onClick={() => updateSportsState({ timer_seconds: timerSeconds + 60 })}
                            className="py-1.5 rounded-lg bg-[#EAB308]/10 hover:bg-[#EAB308]/20 border border-[#EAB308]/20 text-[10px] font-mono text-[#EAB308] transition-all font-bold"
                          >
                            + 1 Min
                          </button>
                          <button
                            onClick={() => updateSportsState({ timer_seconds: timerSeconds + 300 })}
                            className="py-1.5 rounded-lg bg-[#EAB308]/10 hover:bg-[#EAB308]/20 border border-[#EAB308]/20 text-[10px] font-mono text-[#EAB308] transition-all font-bold"
                          >
                            + 5 Min
                          </button>
                        </div>

                        {/* Ajuste Manual Preciso */}
                        <div className="bg-black/20 p-3 rounded-2xl border border-white/5 space-y-2">
                          <span className="block text-[9px] font-mono uppercase tracking-wider text-white/40">Definir Tempo Manual</span>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <input
                                type="number"
                                min="0"
                                max="99"
                                value={Math.floor(timerSeconds / 60)}
                                onChange={(e) => {
                                  const m = parseInt(e.target.value) || 0;
                                  const s = timerSeconds % 60;
                                  setTimerSeconds(m * 60 + s);
                                }}
                                onBlur={() => updateSportsState({ timer_seconds: timerSeconds })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    updateSportsState({ timer_seconds: timerSeconds });
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-full text-center bg-black/40 border border-white/10 rounded-lg py-1 text-xs text-white focus:outline-none focus:border-amber-500 font-mono font-bold"
                                placeholder="Min"
                              />
                              <span className="block text-center text-[8px] text-white/30 uppercase font-mono mt-0.5">Minutos</span>
                            </div>
                            <span className="text-white/40 font-bold">:</span>
                            <div className="flex-1">
                              <input
                                type="number"
                                min="0"
                                max="59"
                                value={timerSeconds % 60}
                                onChange={(e) => {
                                  const m = Math.floor(timerSeconds / 60);
                                  const s = parseInt(e.target.value) || 0;
                                  setTimerSeconds(m * 60 + (s % 60));
                                }}
                                onBlur={() => updateSportsState({ timer_seconds: timerSeconds })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    updateSportsState({ timer_seconds: timerSeconds });
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-full text-center bg-black/40 border border-white/10 rounded-lg py-1 text-xs text-white focus:outline-none focus:border-amber-500 font-mono font-bold"
                                placeholder="Seg"
                              />
                              <span className="block text-center text-[8px] text-white/30 uppercase font-mono mt-0.5">Segundos</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'cameras' && (
            <motion.div 
              key="cameras"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl"
            >
              <div className="bg-[#151619] rounded-3xl border border-white/10 p-8 mb-8">
                {/* Header with Title & Security Badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400">
                      <Camera size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">Adicionar Nova Câmera no Sistema ITL</h3>
                      <p className="text-xs text-white/40 font-mono">Cadastre fluxos RTSP ou receba transmissões RTMP de câmeras físicas</p>
                    </div>
                  </div>
                  <span className="self-start sm:self-auto bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-mono font-medium px-3 py-1.5 rounded-full flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Criptografia E2EE AES-256 Ativa
                  </span>
                </div>

                {/* Camera Name Input */}
                <div className="mb-6">
                  <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                    Nome Identificador da Câmera <span className="text-emerald-400">*</span>
                  </label>
                  <input 
                    type="text" 
                    value={newCam.name}
                    onChange={(e) => setNewCam({ ...newCam, name: e.target.value })}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="Ex: Runway VIPW Intelbras P9 ou Câmera Centro 01"
                  />
                </div>

                {/* Protocol Selection */}
                <div className="mb-6">
                  <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                    Protocolo de Entrada da Câmera:
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setCamProtocol('rtsp')}
                      className={`py-3.5 px-4 rounded-xl border font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                        camProtocol === 'rtsp'
                          ? 'bg-black/60 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-500/10'
                          : 'bg-black/30 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <span className="text-xs">((o))</span> RTSP (Ativo / Pull)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCamProtocol('rtmp')}
                      className={`py-3.5 px-4 rounded-xl border font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                        camProtocol === 'rtmp'
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-500/10'
                          : 'bg-black/30 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <span className="text-xs">((📡))</span> RTMP (Empurrado / Push)
                    </button>
                  </div>
                </div>

                {/* RTSP Specific Inputs */}
                {camProtocol === 'rtsp' && (
                  <div className="mb-6">
                    <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                      URL de Conexão RTSP <span className="text-emerald-400">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={newCam.rtsp_url}
                      onChange={(e) => setNewCam({ ...newCam, rtsp_url: e.target.value })}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white font-mono placeholder-white/20 focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="rtsp://admin:senha@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0"
                    />
                    <div className="mt-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3">
                      <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                        <span className="font-bold text-emerald-400">MODO RTSP (PULL):</span> O servidor do sistema irá conectar ativamente no IP/Porta da câmera para puxar o sinal de vídeo.
                      </p>
                    </div>
                  </div>
                )}

                {/* RTMP Push Specific Inputs */}
                {camProtocol === 'rtmp' && (
                  <div className="space-y-6 mb-6">
                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                        Chave de Segurança do Fluxo (Stream Key):
                      </label>
                      <div className="flex gap-3">
                        <input 
                          type="text" 
                          value={rtmpStreamKey}
                          onChange={(e) => setRtmpStreamKey(e.target.value)}
                          className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 font-mono text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="cam_epao7f"
                        />
                        <button
                          type="button"
                          onClick={generateNewStreamKey}
                          className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all flex items-center gap-2 text-white/80"
                        >
                          <RefreshCw size={14} /> Gerar
                        </button>
                      </div>
                    </div>

                    {/* RTMP Parameters Container */}
                    {(() => {
                      const currentHost = window.location.hostname;
                      const domain = (status?.system_domain && status.system_domain.trim() !== '' && status.system_domain !== 'centralitl.unityautomacoes.com.br') ? status.system_domain : (currentHost || 'localhost');
                      const rtmpServerUrl = `rtmp://${domain}:1935/live`;
                      const fullRtmpLink = `rtmp://${domain}:1935/live/${rtmpStreamKey}`;
                      
                      return (
                        <div className="bg-black/40 border border-emerald-500/20 rounded-2xl p-6 space-y-4">
                          <p className="text-xs font-medium text-white/80">
                            Configure a transmissão em sua câmera física com os seguintes parâmetros:
                          </p>

                          {/* Servidor RTMP */}
                          <div className="bg-black/60 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <span className="block text-[10px] font-mono text-white/40 uppercase font-bold">SERVIDOR RTMP:</span>
                              <span className="font-mono text-xs text-white/90 truncate block select-all">
                                {rtmpServerUrl}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(rtmpServerUrl, 'rtmp_server')}
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-emerald-400 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-mono shrink-0"
                            >
                              {copiedField === 'rtmp_server' ? '✓ Copiado' : '📋 Copiar'}
                            </button>
                          </div>

                          {/* Chave de Fluxo */}
                          <div className="bg-black/60 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <span className="block text-[10px] font-mono text-white/40 uppercase font-bold">CHAVE DE FLUXO / STREAM KEY:</span>
                              <span className="font-mono text-xs text-emerald-400 font-bold truncate block select-all">
                                {rtmpStreamKey}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(rtmpStreamKey, 'stream_key')}
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-emerald-400 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-mono shrink-0"
                            >
                              {copiedField === 'stream_key' ? '✓ Copiado' : '📋 Copiar'}
                            </button>
                          </div>

                          {/* Link Gerado para Câmera */}
                          <div className="bg-black/60 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <span className="block text-[10px] font-mono text-white/40 uppercase font-bold">LINK GERADO PARA CÂMERA:</span>
                              <span className="font-mono text-xs text-emerald-400 underline truncate block select-all">
                                {fullRtmpLink}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(fullRtmpLink, 'full_link')}
                              className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-mono shrink-0 font-bold"
                            >
                              {copiedField === 'full_link' ? '✓ Copiado' : '📋 Copiar Link'}
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Diagnostic Test Button */}
                    <div>
                      <button
                        type="button"
                        onClick={testRtmpSignal}
                        disabled={isTestingRtmp}
                        className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 text-white/80"
                      >
                        <Activity size={16} className={isTestingRtmp ? "animate-spin text-emerald-400" : "text-emerald-400"} />
                        {isTestingRtmp ? 'Diagnosticando Transmissão...' : '⚡ Diagnosticar / Testar Recepção RTMP'}
                      </button>
                      {rtmpTestResult && (
                        <div className={`mt-3 p-4 rounded-xl border text-xs font-mono leading-relaxed ${
                          rtmpTestResult.type === 'ok' 
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        }`}>
                          {rtmpTestResult.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Save Camera Button */}
                <button 
                  onClick={addCamera}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-8 py-3.5 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <Plus size={20} />
                  Salvar e Cadastrar Câmera
                </button>
              </div>

              {/* Cameras List */}
              <div className="space-y-4">
                <h4 className="font-bold text-lg mb-2 text-white/80">Câmeras Cadastradas</h4>
                {cameras.map(cam => {
                  const isRtmp = cam.rtsp_url && (cam.rtsp_url.startsWith('rtmp://') || cam.rtsp_url.startsWith('rtmps://'));
                  return (
                    <div key={cam.id} className="bg-[#151619] rounded-2xl border border-white/10 p-6 flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-black/40 rounded-xl flex items-center justify-center text-white/40">
                          <Camera size={24} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-lg">{cam.name}</h4>
                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${isRtmp ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                              {isRtmp ? 'RTMP' : 'RTSP'}
                            </span>
                          </div>
                          <p className="text-sm text-white/40 font-mono mt-0.5">{cam.rtsp_url}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => openEditCamModal(cam)}
                          title="Editar Câmera"
                          className="px-3 py-2 bg-white/5 hover:bg-emerald-500/20 text-white/60 hover:text-emerald-400 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold border border-white/5"
                        >
                          <Edit size={16} />
                          <span>Editar</span>
                        </button>
                        <button 
                          onClick={() => deleteCamera(cam.id)}
                          title="Excluir Câmera"
                          className="p-2.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all border border-white/5"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Edit Camera Modal */}
              {editingCam && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                  <div className="bg-[#151619] border border-white/10 rounded-3xl p-8 max-w-xl w-full space-y-6 shadow-2xl">
                    <div className="flex items-center justify-between border-b border-white/10 pb-4">
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <Edit size={22} className="text-emerald-400" />
                        Editar Câmera: {editingCam.name}
                      </h3>
                      <button 
                        onClick={() => setEditingCam(null)}
                        className="text-white/40 hover:text-white font-mono text-xs px-3 py-1 rounded bg-white/5"
                      >
                        ✕ Fechar
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                          Nome da Câmera
                        </label>
                        <input 
                          type="text" 
                          value={editCamName}
                          onChange={(e) => setEditCamName(e.target.value)}
                          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors text-white font-medium"
                          placeholder="Ex: Câmera do Pátio"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                          Tipo de Conexão / Protocolo
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setEditCamProtocol('rtsp')}
                            className={`py-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                              editCamProtocol === 'rtsp'
                                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                                : 'bg-black/40 border-white/10 text-white/60 hover:border-white/20'
                            }`}
                          >
                            Câmera IP (RTSP)
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditCamProtocol('rtmp')}
                            className={`py-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                              editCamProtocol === 'rtmp'
                                ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                                : 'bg-black/40 border-white/10 text-white/60 hover:border-white/20'
                            }`}
                          >
                            Câmera Push (RTMP)
                          </button>
                        </div>
                      </div>

                      {editCamProtocol === 'rtsp' ? (
                        <div>
                          <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                            URL RTSP da Câmera IP
                          </label>
                          <input 
                            type="text" 
                            value={editCamRtspUrl}
                            onChange={(e) => setEditCamRtspUrl(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                            placeholder="rtsp://admin:123456@192.168.1.100:554/cam/realmonitor"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-mono uppercase tracking-wider text-white/60 mb-2">
                            Chave do Fluxo RTMP (Stream Key)
                          </label>
                          <input 
                            type="text" 
                            value={editCamRtmpKey}
                            onChange={(e) => setEditCamRtmpKey(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 font-mono text-amber-400 font-bold focus:outline-none focus:border-amber-500 transition-colors"
                            placeholder="cam_epao7f"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setEditingCam(null)}
                        className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl text-xs font-bold transition-all"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveEditedCamera}
                        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20"
                      >
                        Salvar Alterações
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'videos' && (
            <motion.div 
              key="videos"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl"
            >
              <div className="bg-[#151619] rounded-3xl border border-white/10 p-8 mb-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold">Vídeos Comerciais</h3>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white font-bold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2"
                  >
                    {isUploading ? <Activity className="animate-pulse" size={18} /> : <Upload size={18} />}
                    {isUploading ? 'Enviando...' : 'Upload de Vídeo'}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    accept="video/*" 
                    className="hidden" 
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {videos.length === 0 ? (
                    <div className="col-span-full text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
                      <Video className="w-12 h-12 text-white/10 mx-auto mb-4" />
                      <p className="text-white/30">Nenhum vídeo comercial disponível</p>
                    </div>
                  ) : (
                    videos.map(vid => (
                      <div key={vid.id} className="bg-black/20 rounded-2xl border border-white/5 p-4 flex items-center justify-between group hover:border-white/10 transition-all">
                        <div className="flex items-center gap-4 overflow-hidden">
                          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-500">
                            <Video size={20} />
                          </div>
                          <div className="overflow-hidden">
                            <h4 className="font-bold text-sm truncate">{vid.title}</h4>
                            <p className="text-[10px] text-white/30 font-mono">{new Date(vid.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => switchStream('video', vid.id)}
                            className={`p-2 rounded-lg transition-all ${status?.current_source_id === vid.id && status.current_source_type === 'video' ? 'bg-emerald-500 text-white' : 'text-white/20 hover:text-emerald-500 hover:bg-emerald-500/10'}`}
                          >
                            <Play size={16} fill="currentColor" />
                          </button>
                          <button 
                            onClick={() => deleteVideo(vid.id)}
                            className="p-2 text-white/10 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'local' && (
            <motion.div 
              key="local"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-[#151619] rounded-3xl border border-white/10 overflow-hidden">
                    <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/20">
                      <span className="text-xs font-mono uppercase tracking-widest text-white/40">Preview do Compositor</span>
                      <div className="flex gap-2">
                        {screenStream && <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Tela Ativa</span>}
                        {cameraStream && <span className="bg-purple-500/20 text-purple-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Câmera Ativa</span>}
                      </div>
                    </div>
                    <div className="aspect-video bg-black relative">
                      <canvas 
                        id="local-preview-canvas"
                        className="w-full h-full object-contain"
                        ref={(el) => {
                          if (el && canvasRef.current) {
                            const ctx = el.getContext('2d');
                            const sourceCanvas = canvasRef.current;
                            let active = true;
                            const render = () => {
                              if (!active) return;
                              if (ctx && sourceCanvas) {
                                ctx.drawImage(sourceCanvas, 0, 0, el.width, el.height);
                                requestAnimationFrame(render);
                              }
                            };
                            render();
                          }
                        }}
                        width={1280}
                        height={720}
                      />
                      
                      {!screenStream && !cameraStream && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                          <Monitor size={48} className="mb-4" />
                          <p>Nenhuma fonte local selecionada</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <button 
                        onClick={screenStream ? () => screenStream.getTracks().forEach(t => t.stop()) : startScreenShare}
                        className={`w-full p-6 rounded-3xl border transition-all flex flex-col items-center gap-4 ${screenStream ? 'bg-blue-500/10 border-blue-500 text-blue-500' : 'bg-[#151619] border-white/10 text-white/40 hover:border-white/20'}`}
                      >
                        <Monitor size={32} />
                        <div className="text-center">
                          <p className="font-bold">{screenStream ? 'Trocar Compartilhamento' : 'Compartilhar Tela'}</p>
                          <p className="text-xs opacity-60">Janela ou Tela Inteira</p>
                        </div>
                      </button>
                      {screenStream && (
                        <button 
                          onClick={() => {
                            screenStream.getTracks().forEach(t => t.stop());
                            setScreenStream(null);
                          }}
                          className="w-full py-2 bg-red-500/10 text-red-500 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/20 transition-all"
                        >
                          Parar Tela
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <button 
                        onClick={cameraStream ? () => cameraStream.getTracks().forEach(t => t.stop()) : startCamera}
                        className={`w-full p-6 rounded-3xl border transition-all flex flex-col items-center gap-4 ${cameraStream ? 'bg-purple-500/10 border-purple-500 text-purple-500' : 'bg-[#151619] border-white/10 text-white/40 hover:border-white/20'}`}
                      >
                        <Camera size={32} />
                        <div className="text-center">
                          <p className="font-bold">{cameraStream ? 'Trocar Câmera' : 'Ativar Câmera Local'}</p>
                          <p className="text-xs opacity-60">Webcam do Computador</p>
                        </div>
                      </button>
                      
                      {!cameraStream && (
                        <div className="flex items-center justify-center gap-2 mt-2 bg-black/20 py-2 px-4 rounded-xl border border-white/5">
                          <input 
                            type="checkbox" 
                            id="mic-with-cam"
                            checked={requestAudioWithCamera}
                            onChange={(e) => setRequestAudioWithCamera(e.target.checked)}
                            className="rounded bg-[#1e2025] border-white/10 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <label htmlFor="mic-with-cam" className="text-[10px] font-mono uppercase tracking-wider text-white/40 cursor-pointer select-none">
                            Capturar microfone junto
                          </label>
                        </div>
                      )}

                      {cameraStream && (
                        <button 
                          onClick={() => {
                            cameraStream.getTracks().forEach(t => t.stop());
                            setCameraStream(null);
                          }}
                          className="w-full py-2 bg-red-500/10 text-red-500 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/20 transition-all"
                        >
                          Parar Câmera
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-[#151619] rounded-3xl border border-white/10 p-6">
                    <h3 className="text-lg font-bold mb-4">Configurações PiP</h3>
                    <p className="text-sm text-white/40 mb-6">Posição da câmera sobre a tela</p>
                    
                    <div className="grid grid-cols-2 gap-3">
                      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(pos => (
                        <button
                          key={pos}
                          onClick={() => setPipPosition(pos)}
                          className={`p-3 rounded-xl border text-xs font-mono uppercase transition-all ${pipPosition === pos ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-black/20 border-white/5 text-white/40 hover:border-white/20'}`}
                        >
                          {pos.replace('-', ' ')}
                        </button>
                      ))}
                    </div>

                    {/* Controle de Áudio da Transmissão */}
                    <div className="mt-6 pt-6 border-t border-white/5">
                      <h4 className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3">Controle de Áudio</h4>
                      <button
                        onClick={() => setIsMicEnabled(!isMicEnabled)}
                        className={`w-full p-4 rounded-xl border transition-all flex items-center justify-between ${isMicEnabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-500'}`}
                      >
                        <div className="flex items-center gap-3">
                          {isMicEnabled ? <Mic size={18} /> : <MicOff size={18} />}
                          <span className="text-xs font-bold uppercase tracking-wider">Áudio / Microfone</span>
                        </div>
                        <span className="text-[10px] uppercase font-mono bg-black/40 px-2.5 py-1 rounded-md tracking-wider">
                          {isMicEnabled ? 'Ativado' : 'Mutado'}
                        </span>
                      </button>
                    </div>

                    <div className="mt-8 space-y-4">
                      <button
                        disabled={!screenStream && !cameraStream}
                        onClick={isLocalStreaming ? stopStream : startWebBroadcast}
                        className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${isLocalStreaming ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 disabled:opacity-20 disabled:cursor-not-allowed'}`}
                      >
                        {isLocalStreaming ? <Square size={20} /> : <Play size={20} />}
                        {isLocalStreaming ? 'PARAR TRANSMISSÃO' : 'TRANSMITIR AGORA'}
                      </button>
                      
                      <button 
                        onClick={() => setShowLogs(!showLogs)}
                        className="w-full py-2 text-[10px] font-bold text-emerald-500 hover:bg-emerald-500/10 rounded-xl uppercase tracking-widest transition-all"
                      >
                        {showLogs ? 'Ocultar Logs de Transmissão' : 'Ver Logs de Transmissão'}
                      </button>

                      {showLogs && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className="text-[9px] text-white/40 uppercase tracking-widest">
                                {socketConnected ? 'Socket Conectado' : 'Socket Desconectado'}
                              </span>
                              {!socketConnected && (
                                <button 
                                  onClick={() => socketRef.current?.connect()}
                                  className="text-[9px] text-emerald-500 hover:underline uppercase tracking-widest ml-2"
                                >
                                  Reconectar
                                </button>
                              )}
                            </div>
                            {isLocalStreaming && (
                              <button 
                                onClick={() => startActualRecorder()}
                                className="text-[9px] text-emerald-500 hover:underline uppercase tracking-widest"
                              >
                                Forçar Início Manual
                              </button>
                            )}
                          </div>
                          <div className="bg-black/40 rounded-xl p-3 font-mono text-[10px] h-48 overflow-y-auto space-y-1 border border-white/5">
                            {ffmpegLogs.length === 0 ? (
                              <p className="text-white/20">Aguardando logs...</p>
                            ) : (
                              ffmpegLogs.map((log, i) => (
                                <p key={i} className="text-white/60 break-all">{log}</p>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      <p className="text-[10px] text-center text-white/20 uppercase tracking-widest">
                        A transmissão será enviada diretamente para o YouTube
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl"
            >
              <div className="bg-[#151619] rounded-3xl border border-white/10 p-8 space-y-8">
                <div>
                  <h3 className="text-xl font-bold mb-6">Configurações de Transmissão YouTube</h3>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-white/40 mb-2">Chave de Transmissão do YouTube</label>
                      <div className="flex gap-4">
                        <input 
                          type="password" 
                          value={ytKey}
                          onChange={(e) => setYtKey(e.target.value)}
                          className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="xxxx-xxxx-xxxx-xxxx"
                        />
                        <button 
                          onClick={saveYtKey}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 py-3 rounded-xl transition-all"
                        >
                          Salvar
                        </button>
                      </div>
                      <p className="text-[10px] text-white/20 mt-2 font-mono">Encontrada no painel do YouTube Studio</p>
                    </div>

                    <div className="pt-6 border-t border-white/10">
                      <h4 className="font-bold mb-4">Parâmetros de Qualidade de Saída (Alta Definição)</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-black/20 rounded-xl border border-white/5">
                          <span className="block text-[10px] font-mono text-white/40 uppercase mb-1">Resolução</span>
                          <span className="font-bold text-emerald-400">1080p Full HD</span>
                        </div>
                        <div className="p-4 bg-black/20 rounded-xl border border-white/5">
                          <span className="block text-[10px] font-mono text-white/40 uppercase mb-1">Bitrate de Vídeo</span>
                          <span className="font-bold text-emerald-400">4500 kbps (High Quality)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/10">
                  <h3 className="text-xl font-bold mb-4">Domínio do Sistema ITL (Servidor RTMP)</h3>
                  <p className="text-xs text-white/40 mb-4 leading-relaxed">
                    Este domínio é utilizado na geração automática do endereço RTMP que deve ser inserido nas configurações da câmera física.
                  </p>
                  <div className="flex gap-4">
                    <input 
                      type="text" 
                      value={systemDomainInput}
                      onChange={(e) => setSystemDomainInput(e.target.value)}
                      className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors font-mono text-sm text-white placeholder-white/20"
                      placeholder={window.location.hostname || "seu-dominio-ou-ip.com"}
                    />
                    <button 
                      onClick={saveSystemDomain}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 py-3 rounded-xl transition-all"
                    >
                      Salvar Domínio
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
