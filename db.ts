import "dotenv/config";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

export interface User {
  id: number;
  username: string;
  password: string;
  role: string;
  permissions?: string[];
  created_at?: Date | string;
}

export interface Camera {
  id: number;
  name: string;
  rtsp_url: string;
  is_active: boolean;
  has_audio?: boolean;
  created_at?: Date | string;
}

export interface Video {
  id: number;
  title: string;
  file_path: string;
  duration?: number;
  created_at?: Date | string;
}

export interface Logo {
  id: number;
  name: string;
  file_path: string;
  created_at?: Date | string;
}

export interface StreamStatus {
  id?: number;
  current_source_type: "camera" | "video" | "web" | "none";
  current_source_id: number | string | null;
  last_camera_id?: number | string | null;
  is_streaming: boolean;
  youtube_key?: string;
  system_domain?: string;
  loop_video?: boolean;
  scoreboard_enabled?: boolean;
  timer_enabled?: boolean;
  team_a_name?: string;
  team_b_name?: string;
  score_a?: number;
  score_b?: number;
  timer_seconds?: number;
  timer_running?: boolean;
  logo_enabled?: boolean;
  active_logo_id?: number | null;
  logo_position?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  block_offline_switch?: boolean;
  mic_narration_enabled?: boolean;
  mic_narration_mode?: "replace" | "mix";
  mic_narration_volume?: number;
  updated_at?: Date | string;
}

export interface AppDatabase {
  users: User[];
  cameras: Camera[];
  videos: Video[];
  logos: Logo[];
  stream_status: StreamStatus;
}

const DB_FILE = path.join(process.cwd(), "data.json");
let memoryDb: AppDatabase | null = null;
let mysqlPool: mysql.Pool | null = null;
let isMySqlConnected = false;

export const isDatabaseMySql = () => isMySqlConnected;

const ALL_TABS = ['dashboard', 'cameras', 'videos', 'local', 'users', 'settings'];

const getDefaultDbState = (): AppDatabase => ({
  users: [
    { id: 1, username: "admin", password: bcrypt.hashSync("admin123", 10), role: "admin", permissions: ALL_TABS },
    { id: 2, username: "suporte@unityautomacoes.com.br", password: bcrypt.hashSync("200616", 10), role: "superadmin", permissions: ALL_TABS }
  ],
  cameras: [
    { id: 1, name: "Câmera 01", rtsp_url: "rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mp4", is_active: true },
    { id: 2, name: "Câmera 02", rtsp_url: "rtsp://demo:demo@static.cartesian.io:554/live/ch0", is_active: true }
  ],
  videos: [],
  logos: [],
  stream_status: {
    current_source_type: "none",
    current_source_id: null,
    last_camera_id: null,
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
    timer_running: false,
    logo_enabled: false,
    active_logo_id: null,
    logo_position: "top_right",
    block_offline_switch: true,
    mic_narration_enabled: false,
    mic_narration_mode: "mix",
    mic_narration_volume: 100
  }
});

export async function initDatabase(): Promise<AppDatabase> {
  const dbHost = process.env.DB_HOST;
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;

  // 1. Check if MySQL config is present
  if (dbHost && dbName && dbUser !== undefined) {
    try {
      console.log(`[DATABASE] Conectando ao MySQL (${dbHost} / banco: ${dbName} / usuário: ${dbUser})...`);
      
      const pool = mysql.createPool({
        host: dbHost,
        user: dbUser,
        password: dbPassword || "",
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 4000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      });

      // Test connection
      const [testResult] = await pool.query("SELECT 1 as connected");
      console.log("[DATABASE] Conexão MySQL estabelecida com sucesso!");
      mysqlPool = pool;
      isMySqlConnected = true;

      // Create Tables if not exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS cameras (
          id BIGINT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          rtsp_url TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          has_audio BOOLEAN NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS videos (
          id BIGINT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          file_path VARCHAR(255) NOT NULL,
          duration INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS logos (
          id BIGINT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          file_path VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS stream_status (
          id INT PRIMARY KEY DEFAULT 1,
          current_source_type VARCHAR(50) DEFAULT 'none',
          current_source_id VARCHAR(100) NULL,
          last_camera_id VARCHAR(100) NULL,
          is_streaming BOOLEAN DEFAULT FALSE,
          youtube_key TEXT NULL,
          system_domain VARCHAR(255) NULL,
          loop_video BOOLEAN DEFAULT FALSE,
          scoreboard_enabled BOOLEAN DEFAULT FALSE,
          timer_enabled BOOLEAN DEFAULT FALSE,
          team_a_name VARCHAR(100) DEFAULT 'TIME A',
          team_b_name VARCHAR(100) DEFAULT 'TIME B',
          score_a INT DEFAULT 0,
          score_b INT DEFAULT 0,
          timer_seconds INT DEFAULT 0,
          timer_running BOOLEAN DEFAULT FALSE,
          logo_enabled BOOLEAN DEFAULT FALSE,
          active_logo_id BIGINT NULL,
          logo_position VARCHAR(50) DEFAULT 'top_right',
          block_offline_switch BOOLEAN DEFAULT TRUE,
          mic_narration_enabled BOOLEAN DEFAULT FALSE,
          mic_narration_mode VARCHAR(50) DEFAULT 'replace',
          mic_narration_volume INT DEFAULT 100,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // Safe schema migrations for missing columns
      const safeAddColumn = async (table: string, colDef: string) => {
        try {
          await pool.query(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
        } catch (e: any) {
          // Ignore error if column already exists (ER_DUP_FIELDNAME)
        }
      };

      await safeAddColumn("users", "permissions TEXT NULL");
      await safeAddColumn("cameras", "has_audio BOOLEAN NULL");
      await safeAddColumn("stream_status", "last_camera_id VARCHAR(100) NULL");
      await safeAddColumn("stream_status", "block_offline_switch BOOLEAN DEFAULT TRUE");
      await safeAddColumn("stream_status", "mic_narration_enabled BOOLEAN DEFAULT FALSE");
      await safeAddColumn("stream_status", "mic_narration_mode VARCHAR(50) DEFAULT 'replace'");
      await safeAddColumn("stream_status", "mic_narration_volume INT DEFAULT 100");
      await safeAddColumn("stream_status", "scoreboard_enabled BOOLEAN DEFAULT FALSE");
      await safeAddColumn("stream_status", "timer_enabled BOOLEAN DEFAULT FALSE");
      await safeAddColumn("stream_status", "team_a_name VARCHAR(100) DEFAULT 'TIME A'");
      await safeAddColumn("stream_status", "team_b_name VARCHAR(100) DEFAULT 'TIME B'");
      await safeAddColumn("stream_status", "score_a INT DEFAULT 0");
      await safeAddColumn("stream_status", "score_b INT DEFAULT 0");
      await safeAddColumn("stream_status", "timer_seconds INT DEFAULT 0");
      await safeAddColumn("stream_status", "timer_running BOOLEAN DEFAULT FALSE");
      await safeAddColumn("stream_status", "logo_enabled BOOLEAN DEFAULT FALSE");
      await safeAddColumn("stream_status", "active_logo_id BIGINT NULL");
      await safeAddColumn("stream_status", "logo_position VARCHAR(50) DEFAULT 'top_right'");

      // Load users from MySQL or insert default users
      const [userRows]: any = await pool.query("SELECT * FROM users");
      let users: User[] = userRows.map((r: any) => {
        let permissions: string[] = ALL_TABS;
        if (r.permissions) {
          try {
            permissions = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
          } catch (e) {
            permissions = ALL_TABS;
          }
        }
        return {
          id: Number(r.id),
          username: r.username,
          password: r.password,
          role: r.username === "suporte@unityautomacoes.com.br" ? "superadmin" : (r.role || "admin"),
          permissions: r.username === "suporte@unityautomacoes.com.br" ? ALL_TABS : (Array.isArray(permissions) ? permissions : ALL_TABS),
          created_at: r.created_at
        };
      });
      if (users.length === 0) {
        const defaultUsers = [
          { username: "admin", password: bcrypt.hashSync("admin123", 10), role: "admin", permissions: JSON.stringify(ALL_TABS) },
          { username: "suporte@unityautomacoes.com.br", password: bcrypt.hashSync("200616", 10), role: "superadmin", permissions: JSON.stringify(ALL_TABS) }
        ];
        for (const u of defaultUsers) {
          await pool.query("INSERT INTO users (username, password, role, permissions) VALUES (?, ?, ?, ?)", [u.username, u.password, u.role, u.permissions]);
        }
        const [reloadedUsers]: any = await pool.query("SELECT * FROM users");
        users = reloadedUsers.map((r: any) => ({
          id: Number(r.id),
          username: r.username,
          password: r.password,
          role: r.username === "suporte@unityautomacoes.com.br" ? "superadmin" : (r.role || "admin"),
          permissions: ALL_TABS,
          created_at: r.created_at
        }));
      }

      // Load cameras from MySQL
      const [cameraRows]: any = await pool.query("SELECT * FROM cameras ORDER BY id ASC");
      let cameras: Camera[] = cameraRows.map((r: any) => ({
        id: Number(r.id),
        name: r.name,
        rtsp_url: r.rtsp_url,
        is_active: Boolean(r.is_active),
        has_audio: r.has_audio !== null ? Boolean(r.has_audio) : undefined,
        created_at: r.created_at
      }));

      // If MySQL cameras table is empty, check if data.json has cameras to migrate!
      if (cameras.length === 0 && fs.existsSync(DB_FILE)) {
        try {
          const localJson = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
          if (localJson.cameras && Array.isArray(localJson.cameras) && localJson.cameras.length > 0) {
            console.log(`[DATABASE] Migrando ${localJson.cameras.length} câmeras do data.json para o MySQL...`);
            for (const c of localJson.cameras) {
              await pool.query(
                "INSERT INTO cameras (id, name, rtsp_url, is_active, has_audio) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), rtsp_url=VALUES(rtsp_url)",
                [c.id || Date.now(), c.name, c.rtsp_url, c.is_active !== false, c.has_audio ?? null]
              );
            }
            const [migratedCameras]: any = await pool.query("SELECT * FROM cameras ORDER BY id ASC");
            cameras = migratedCameras.map((r: any) => ({
              id: Number(r.id),
              name: r.name,
              rtsp_url: r.rtsp_url,
              is_active: Boolean(r.is_active),
              has_audio: r.has_audio !== null ? Boolean(r.has_audio) : undefined
            }));
          }
        } catch (e) {
          console.warn("[DATABASE] Aviso ao migrar câmeras do json:", e);
        }
      }

      // Load videos from MySQL
      const [videoRows]: any = await pool.query("SELECT * FROM videos ORDER BY id ASC");
      const videos: Video[] = videoRows.map((r: any) => ({
        id: Number(r.id),
        title: r.title,
        file_path: r.file_path,
        duration: r.duration,
        created_at: r.created_at
      }));

      // Load logos from MySQL
      const [logoRows]: any = await pool.query("SELECT * FROM logos ORDER BY id ASC");
      const logos: Logo[] = logoRows.map((r: any) => ({
        id: Number(r.id),
        name: r.name,
        file_path: r.file_path,
        created_at: r.created_at
      }));

      // Load stream_status from MySQL
      const [statusRows]: any = await pool.query("SELECT * FROM stream_status WHERE id = 1");
      let statusRow = statusRows[0];
      if (!statusRow) {
        await pool.query(`
          INSERT INTO stream_status (
            id, current_source_type, current_source_id, last_camera_id, is_streaming, youtube_key, 
            system_domain, loop_video, scoreboard_enabled, timer_enabled, team_a_name, team_b_name, 
            score_a, score_b, timer_seconds, timer_running, logo_enabled, active_logo_id, logo_position, 
            block_offline_switch, mic_narration_enabled, mic_narration_mode, mic_narration_volume
          ) VALUES (
            1, 'none', NULL, NULL, 0, '', '', 0, 0, 0, 'TIME A', 'TIME B', 0, 0, 0, 0, 0, NULL, 'top_right', 1, 0, 'replace', 100
          )
        `);
        const [reloadedStatus]: any = await pool.query("SELECT * FROM stream_status WHERE id = 1");
        statusRow = reloadedStatus[0];
      }

      const stream_status: StreamStatus = {
        id: 1,
        current_source_type: statusRow.current_source_type || "none",
        current_source_id: statusRow.current_source_id || null,
        last_camera_id: statusRow.last_camera_id || null,
        is_streaming: Boolean(statusRow.is_streaming),
        youtube_key: statusRow.youtube_key || "",
        system_domain: statusRow.system_domain || "",
        loop_video: Boolean(statusRow.loop_video),
        scoreboard_enabled: Boolean(statusRow.scoreboard_enabled),
        timer_enabled: Boolean(statusRow.timer_enabled),
        team_a_name: statusRow.team_a_name || "TIME A",
        team_b_name: statusRow.team_b_name || "TIME B",
        score_a: Number(statusRow.score_a || 0),
        score_b: Number(statusRow.score_b || 0),
        timer_seconds: Number(statusRow.timer_seconds || 0),
        timer_running: Boolean(statusRow.timer_running),
        logo_enabled: Boolean(statusRow.logo_enabled),
        active_logo_id: statusRow.active_logo_id ? Number(statusRow.active_logo_id) : null,
        logo_position: statusRow.logo_position || "top_right",
        block_offline_switch: statusRow.block_offline_switch !== 0 && statusRow.block_offline_switch !== false,
        mic_narration_enabled: Boolean(statusRow.mic_narration_enabled),
        mic_narration_mode: statusRow.mic_narration_mode || "replace",
        mic_narration_volume: Number(statusRow.mic_narration_volume ?? 100)
      };

      memoryDb = {
        users,
        cameras,
        videos,
        logos,
        stream_status
      };

      // Backup to local data.json
      fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb, null, 2));
      console.log(`[DATABASE] Banco MySQL carregado com sucesso (${cameras.length} câmeras, ${videos.length} vídeos, ${logos.length} logos).`);
      return memoryDb;
    } catch (err: any) {
      console.error("[DATABASE] Erro ao conectar ou inicializar MySQL:", err?.message || err);
      console.log("[DATABASE] Recorrendo ao armazenamento local (data.json)...");
      isMySqlConnected = false;
      mysqlPool = null;
    }
  }

  // 2. Fallback to data.json
  if (!fs.existsSync(DB_FILE)) {
    const defaultData = getDefaultDbState();
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
    memoryDb = defaultData;
  } else {
    try {
      memoryDb = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    } catch (e) {
      memoryDb = getDefaultDbState();
      fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb, null, 2));
    }
  }

  if (!memoryDb!.stream_status) memoryDb!.stream_status = getDefaultDbState().stream_status;
  if (!memoryDb!.logos) memoryDb!.logos = [];
  if (!memoryDb!.videos) memoryDb!.videos = [];
  if (!memoryDb!.cameras) memoryDb!.cameras = [];
  if (!memoryDb!.users) memoryDb!.users = getDefaultDbState().users;

  return memoryDb!;
}

export const getDb = (): AppDatabase => {
  if (!memoryDb) {
    if (fs.existsSync(DB_FILE)) {
      try {
        memoryDb = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      } catch (e) {
        memoryDb = getDefaultDbState();
      }
    } else {
      memoryDb = getDefaultDbState();
    }
  }
  return memoryDb!;
};

export const writeSportsFiles = (status: any) => {
  try {
    const cwd = process.cwd();
    const writeAtomic = (filename: string, content: string) => {
      const targetPath = path.resolve(cwd, filename);
      const tmpPath = path.resolve(cwd, `${filename}.tmp`);
      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, targetPath);
    };

    writeAtomic("teama.txt", (status?.team_a_name || "TIME A").toUpperCase());
    writeAtomic("teamb.txt", (status?.team_b_name || "TIME B").toUpperCase());
    writeAtomic("scorea.txt", String(status?.score_a ?? 0));
    writeAtomic("scoreb.txt", String(status?.score_b ?? 0));
    const mins = Math.floor((status?.timer_seconds || 0) / 60);
    const secs = (status?.timer_seconds || 0) % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    writeAtomic("timer.txt", timeStr);
  } catch (err) {
    console.error("Erro ao gravar arquivos do painel esportivo:", err);
  }
};

export const saveDb = (data: AppDatabase) => {
  memoryDb = data;
  writeSportsFiles(data.stream_status);

  // 1. Synchronous write to local JSON backup to guarantee no race conditions or lost records
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[DATABASE] Erro ao gravar data.json:", err);
  }

  // 2. Asynchronous write to MySQL if connected
  if (mysqlPool && isMySqlConnected) {
    (async () => {
      try {
        const s = data.stream_status;
        await mysqlPool.query(`
          UPDATE stream_status SET
            current_source_type = ?,
            current_source_id = ?,
            last_camera_id = ?,
            is_streaming = ?,
            youtube_key = ?,
            system_domain = ?,
            loop_video = ?,
            scoreboard_enabled = ?,
            timer_enabled = ?,
            team_a_name = ?,
            team_b_name = ?,
            score_a = ?,
            score_b = ?,
            timer_seconds = ?,
            timer_running = ?,
            logo_enabled = ?,
            active_logo_id = ?,
            logo_position = ?,
            block_offline_switch = ?,
            mic_narration_enabled = ?,
            mic_narration_mode = ?,
            mic_narration_volume = ?
          WHERE id = 1
        `, [
          s.current_source_type || 'none',
          s.current_source_id !== null ? String(s.current_source_id) : null,
          s.last_camera_id !== null && s.last_camera_id !== undefined ? String(s.last_camera_id) : null,
          s.is_streaming ? 1 : 0,
          s.youtube_key || '',
          s.system_domain || '',
          s.loop_video ? 1 : 0,
          s.scoreboard_enabled ? 1 : 0,
          s.timer_enabled ? 1 : 0,
          s.team_a_name || 'TIME A',
          s.team_b_name || 'TIME B',
          s.score_a || 0,
          s.score_b || 0,
          s.timer_seconds || 0,
          s.timer_running ? 1 : 0,
          s.logo_enabled ? 1 : 0,
          s.active_logo_id || null,
          s.logo_position || 'top_right',
          s.block_offline_switch !== false ? 1 : 0,
          s.mic_narration_enabled ? 1 : 0,
          s.mic_narration_mode || 'replace',
          s.mic_narration_volume ?? 100
        ]);
      } catch (err: any) {
        console.error("[DATABASE] Erro ao sincronizar stream_status no MySQL:", err?.message || err);
      }
    })();
  }
};

// Database CRUD Helpers with immediate sync
export async function dbAddCamera(cam: Camera) {
  const db = getDb();
  if (!db.cameras) db.cameras = [];
  const existingIdx = db.cameras.findIndex(c => c.id === cam.id);
  if (existingIdx >= 0) {
    db.cameras[existingIdx] = cam;
  } else {
    db.cameras.push(cam);
  }
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query(
        "INSERT INTO cameras (id, name, rtsp_url, is_active, has_audio) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), rtsp_url=VALUES(rtsp_url), is_active=VALUES(is_active), has_audio=VALUES(has_audio)",
        [cam.id, cam.name, cam.rtsp_url, cam.is_active !== false ? 1 : 0, cam.has_audio !== undefined ? (cam.has_audio ? 1 : 0) : null]
      );
    } catch (e: any) {
      console.error("[DATABASE] Erro ao inserir câmera no MySQL:", e?.message || e);
    }
  }
}

export async function dbUpdateCamera(id: number, updates: Partial<Camera>) {
  const db = getDb();
  const index = db.cameras.findIndex(c => c.id === id);
  if (index !== -1) {
    db.cameras[index] = { ...db.cameras[index], ...updates };
    saveDb(db);

    if (mysqlPool && isMySqlConnected) {
      try {
        const cam = db.cameras[index];
        await mysqlPool.query(
          "UPDATE cameras SET name = ?, rtsp_url = ?, is_active = ?, has_audio = ? WHERE id = ?",
          [cam.name, cam.rtsp_url, cam.is_active !== false ? 1 : 0, cam.has_audio !== undefined ? (cam.has_audio ? 1 : 0) : null, id]
        );
      } catch (e: any) {
        console.error("[DATABASE] Erro ao atualizar câmera no MySQL:", e?.message || e);
      }
    }
    return db.cameras[index];
  }
  return null;
}

export async function dbDeleteCamera(id: number) {
  const db = getDb();
  db.cameras = db.cameras.filter(c => c.id !== id);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query("DELETE FROM cameras WHERE id = ?", [id]);
    } catch (e: any) {
      console.error("[DATABASE] Erro ao excluir câmera no MySQL:", e?.message || e);
    }
  }
}

export async function dbAddVideo(video: Video) {
  const db = getDb();
  db.videos.push(video);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query(
        "INSERT INTO videos (id, title, file_path, duration) VALUES (?, ?, ?, ?)",
        [video.id, video.title, video.file_path, video.duration || 0]
      );
    } catch (e: any) {
      console.error("[DATABASE] Erro ao inserir vídeo no MySQL:", e?.message || e);
    }
  }
}

export async function dbDeleteVideo(id: number) {
  const db = getDb();
  db.videos = db.videos.filter(v => v.id !== id);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query("DELETE FROM videos WHERE id = ?", [id]);
    } catch (e: any) {
      console.error("[DATABASE] Erro ao excluir vídeo no MySQL:", e?.message || e);
    }
  }
}

export async function dbAddLogo(logo: Logo) {
  const db = getDb();
  if (!db.logos) db.logos = [];
  db.logos.push(logo);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query(
        "INSERT INTO logos (id, name, file_path) VALUES (?, ?, ?)",
        [logo.id, logo.name, logo.file_path]
      );
    } catch (e: any) {
      console.error("[DATABASE] Erro ao inserir logo no MySQL:", e?.message || e);
    }
  }
}

export async function dbDeleteLogo(id: number) {
  const db = getDb();
  db.logos = (db.logos || []).filter(l => l.id !== id);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query("DELETE FROM logos WHERE id = ?", [id]);
    } catch (e: any) {
      console.error("[DATABASE] Erro ao excluir logo no MySQL:", e?.message || e);
    }
  }
}

export async function dbAddUser(user: User): Promise<User> {
  const db = getDb();
  if (!user.permissions || !Array.isArray(user.permissions) || user.permissions.length === 0) {
    user.permissions = ALL_TABS;
  }
  db.users.push(user);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      const [result]: any = await mysqlPool.query(
        "INSERT INTO users (id, username, password, role, permissions) VALUES (?, ?, ?, ?, ?)",
        [user.id, user.username, user.password, user.role || 'user', JSON.stringify(user.permissions)]
      );
      if (result.insertId && !user.id) {
        user.id = Number(result.insertId);
      }
    } catch (e: any) {
      console.error("[DATABASE] Erro ao inserir usuário no MySQL:", e?.message || e);
    }
  }
  return user;
}

export async function dbUpdateUser(id: number, updates: Partial<User>): Promise<User | null> {
  const db = getDb();
  const index = db.users.findIndex(u => u.id === id);
  if (index === -1) return null;

  const current = db.users[index];
  
  // Protected superadmin checks
  const isSuperAdmin = current.username === "suporte@unityautomacoes.com.br";
  if (isSuperAdmin) {
    // Cannot change username or remove superadmin role / permissions
    updates.username = "suporte@unityautomacoes.com.br";
    updates.role = "superadmin";
    updates.permissions = ALL_TABS;
  }

  const updated: User = {
    ...current,
    ...updates,
    permissions: isSuperAdmin ? ALL_TABS : (updates.permissions || current.permissions || ALL_TABS)
  };

  db.users[index] = updated;
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      const fields: string[] = [];
      const values: any[] = [];

      if (updates.username !== undefined) {
        fields.push("username = ?");
        values.push(updated.username);
      }
      if (updates.password !== undefined) {
        fields.push("password = ?");
        values.push(updated.password);
      }
      if (updates.role !== undefined) {
        fields.push("role = ?");
        values.push(updated.role);
      }
      if (updates.permissions !== undefined) {
        fields.push("permissions = ?");
        values.push(JSON.stringify(updated.permissions));
      }

      if (fields.length > 0) {
        values.push(id);
        await mysqlPool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
      }
    } catch (e: any) {
      console.error("[DATABASE] Erro ao atualizar usuário no MySQL:", e?.message || e);
    }
  }

  return updated;
}

export async function dbDeleteUser(id: number): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const user = db.users.find(u => u.id === id);
  if (!user) return { success: false, error: "Usuário não encontrado" };

  // Crucial requirement: suporte@unityautomacoes.com.br CANNOT BE DELETED
  if (user.username.trim().toLowerCase() === "suporte@unityautomacoes.com.br") {
    return { success: false, error: "O usuário Super Admin (suporte@unityautomacoes.com.br) é protegido pelo sistema e não pode ser excluído!" };
  }

  db.users = db.users.filter(u => u.id !== id);
  saveDb(db);

  if (mysqlPool && isMySqlConnected) {
    try {
      await mysqlPool.query("DELETE FROM users WHERE id = ?", [id]);
    } catch (e: any) {
      console.error("[DATABASE] Erro ao excluir usuário no MySQL:", e?.message || e);
    }
  }

  return { success: true };
}

export async function findUserByCredentials(rawUsername: string, rawPassword: string): Promise<User | null> {
  const username = (rawUsername || "").trim().toLowerCase();
  const password = rawPassword || "";

  if (!username || !password) return null;

  // 1. If MySQL is connected, check real-time in MySQL
  if (mysqlPool && isMySqlConnected) {
    try {
      const [rows]: any = await mysqlPool.query("SELECT * FROM users WHERE LOWER(TRIM(username)) = ?", [username]);
      if (rows && rows.length > 0) {
        const dbUser = rows[0];
        const isBcrypt = dbUser.password && (dbUser.password.startsWith("$2a$") || dbUser.password.startsWith("$2b$") || dbUser.password.startsWith("$2y$"));
        let valid = false;
        if (isBcrypt) {
          try {
            valid = bcrypt.compareSync(password, dbUser.password);
          } catch (e) {}
        }
        if (!valid && dbUser.password === password) {
          valid = true;
        }
        // Master fallback check for default credentials
        if (!valid) {
          if (username === "suporte@unityautomacoes.com.br" && password === "200616") valid = true;
          if (username === "admin" && (password === "admin123" || password === "admin")) valid = true;
        }

        if (valid) {
          let permissions = ALL_TABS;
          if (dbUser.permissions) {
            try {
              permissions = typeof dbUser.permissions === 'string' ? JSON.parse(dbUser.permissions) : dbUser.permissions;
            } catch (e) {
              permissions = ALL_TABS;
            }
          }
          const isSuper = dbUser.username === "suporte@unityautomacoes.com.br";
          return {
            id: Number(dbUser.id),
            username: dbUser.username,
            password: dbUser.password,
            role: isSuper ? "superadmin" : (dbUser.role || "admin"),
            permissions: isSuper ? ALL_TABS : (Array.isArray(permissions) ? permissions : ALL_TABS)
          };
        }
      }
    } catch (e) {
      console.error("[DATABASE] Erro ao buscar usuário no MySQL:", e);
    }
  }

  // 2. Local memoryDb / data.json fallback
  const db = getDb();
  const localUser = (db.users || []).find((u: any) => (u.username || "").trim().toLowerCase() === username);

  if (localUser) {
    const isBcrypt = localUser.password && (localUser.password.startsWith("$2a$") || localUser.password.startsWith("$2b$") || localUser.password.startsWith("$2y$"));
    let valid = false;
    if (isBcrypt) {
      try {
        valid = bcrypt.compareSync(password, localUser.password);
      } catch (e) {}
    }
    if (!valid && localUser.password === password) {
      valid = true;
    }
    if (!valid) {
      if (username === "suporte@unityautomacoes.com.br" && password === "200616") valid = true;
      if (username === "admin" && (password === "admin123" || password === "admin")) valid = true;
    }

    if (valid) {
      const isSuper = localUser.username === "suporte@unityautomacoes.com.br";
      return {
        ...localUser,
        role: isSuper ? "superadmin" : (localUser.role || "admin"),
        permissions: isSuper ? ALL_TABS : (localUser.permissions || ALL_TABS)
      };
    }
  }

  // 3. Fallback for default built-in users if database users table was somehow empty/corrupted
  if (username === "suporte@unityautomacoes.com.br" && password === "200616") {
    return { id: 2, username: "suporte@unityautomacoes.com.br", password: "", role: "superadmin", permissions: ALL_TABS };
  }
  if (username === "admin" && (password === "admin123" || password === "admin")) {
    return { id: 1, username: "admin", password: "", role: "admin", permissions: ALL_TABS };
  }

  return null;
}
