-- StreamControl Database Schema

CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cameras (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    rtsp_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    has_audio BOOLEAN NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS videos (
    id BIGINT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    duration INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS logos (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

-- Initial default users (Passwords: admin123 and 200616)
INSERT INTO users (username, password, role) 
VALUES 
    ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
    ('suporte@unityautomacoes.com.br', '$2a$10$D8b46g3O/Yt8sQ1h19q/POGx2K55rE9YwQf4h.i67U0T11oZ22P0e', 'admin')
ON DUPLICATE KEY UPDATE role = 'admin';

-- Initial stream_status row
INSERT INTO stream_status (id, is_streaming, current_source_type) 
VALUES (1, 0, 'none') 
ON DUPLICATE KEY UPDATE id = 1;
