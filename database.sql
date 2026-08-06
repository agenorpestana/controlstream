# StreamControl Database Schema

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cameras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rtsp_url VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS videos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    duration INT, -- in seconds
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stream_status (
    id INT PRIMARY KEY DEFAULT 1,
    current_source_type ENUM('camera', 'video', 'none') DEFAULT 'none',
    current_source_id INT,
    is_streaming BOOLEAN DEFAULT FALSE,
    youtube_key VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Initial user
INSERT INTO users (username, password, role) VALUES ('suporte@unityautomacoes.com.br', '$2a$10$vI8Z8.8Z8.8Z8.8Z8.8Z8.uO1V7v8w9x0y1z2a3b4c5d6e7f8g9h0i', 'admin');
