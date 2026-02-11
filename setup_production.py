
import os
import shutil
import sys

def ignore_patterns(path, names):
    # Ignore common artifacts and heavy data folders
    return {
        '__pycache__', 'venv', 'node_modules', 'dist', '.git', '.idea', '.vscode',
        'qdrant_data', 'postgres_data', 'files', '.DS_Store', 'production', 'production_build'
    }

def main():
    # Check for Python 3.12
    if sys.version_info < (3, 12):
        print("Error: Python 3.12+ is required.")
        print("Please ensure Python 3.12 is installed for backend services before proceeding.")
        print("Current version:", sys.version.split()[0])
        response = input("Do you want to continue anyway? (y/n): ").strip().lower()
        if response != 'y':
            return

    print("Welcome to the Knowledge Base Production Setup!")
    print("This script will create a standalone, self-contained deployment bundle.")
    
    # 1. Gather Information
    org_name = input("Enter configuration name (will be used as folder name): ").strip()
    if not org_name:
        print("Organization name is required.")
        return

    print("\n--- Database Configuration ---")
    pg_user = input("Enter PostgreSQL Username [root]: ").strip() or "root"
    pg_pass = input("Enter PostgreSQL Password [blockexe123]: ").strip() or "blockexe123"
    
    print("\n--- Security Configuration ---")
    api_key = input("Enter API Key [blockexe123]: ").strip() or "blockexe123"
    
    print("\n--- Extensions ---")
    print("Available extensions: lectures")
    extensions_input = input("Enter enabled extensions (comma-separated) [lectures]: ").strip() or "lectures"

    print("\n--- Frontend Configuration ---")
    backend_url = input("Enter Backend API URL for Frontend [http://localhost:8000]: ").strip() or "http://localhost:8000"
    
    # 2. Create Directory Structure and Copy Source
    base_dir = os.path.join(os.getcwd(), org_name)
    if os.path.exists(base_dir):
        print(f"\nWarning: Directory '{org_name}' already exists.")
        confirm = input("Overwrite? (y/n): ").lower()
        if confirm != 'y':
            print("Aborting.")
            return
        shutil.rmtree(base_dir)
    
    os.makedirs(base_dir)
    
    print("Copying source code...")
    # Copy Source Directories
    # We copy them into the root of the artifact folder so Docker context '.' works easily
    current_dir = os.getcwd()
    source_root = os.path.join(current_dir, 'master')
    
    dirs_to_copy = ['backend', 'frontend', 'ingestion_module']
    
    for d in dirs_to_copy:
        src = os.path.join(source_root, d)
        dst = os.path.join(base_dir, d)
        if os.path.exists(src):
            shutil.copytree(src, dst, ignore=ignore_patterns)
        else:
            print(f"Warning: Source directory '{d}' not found!")

    # Create directories for other services
    os.makedirs(os.path.join(base_dir, "postgres"))
    os.makedirs(os.path.join(base_dir, "qdrant"))

    # 3. Create Configuration Files

    # .env
    env_content = f"""POSTGRES_USER={pg_user}
POSTGRES_PASSWORD={pg_pass}
POSTGRES_DB=knowledge_base
API_KEY={api_key}
ENABLED_EXTENSIONS={extensions_input}
POSTGRES_IP=http://db:5432
QDRANT_IP=http://qdrant:6333
OLLAMA_HOST=http://host.docker.internal:11434
# For frontend build
VITE_API_URL={backend_url}
VITE_API_KEY={api_key}
"""
    with open(os.path.join(base_dir, ".env"), "w") as f:
        f.write(env_content)
        
    print(f"\nCreated .env file.")

    # README.md
    readme_content = f"""# Production Bundle: {org_name}

This is a standalone deployment bundle for the Knowledge Base application. 
It contains all necessary source code and configuration to run the application in Docker.

## Deployment Instructions

1.  **Transfer**: Copy this entire folder to your production server.
2.  **Configure**: Edit `.env` if you need to change IP addresses or secrets.
    *   If running on multiple servers, set `POSTGRES_IP`, `QDRANT_IP`, `VITE_API_URL` accordingly.
3.  **Run**:
    ```bash
    docker-compose up --build -d
    ```

## Folder Structure
*   `backend/`, `frontend/`, `ingestion_module/`: Source code.
*   `backend.Dockerfile`: Build instructions for the API.
*   `frontend.Dockerfile`: Build instructions for the Web App.
*   `docker-compose.yml`: Service orchestration.
"""
    with open(os.path.join(base_dir, "README.md"), "w") as f:
        f.write(readme_content)

    # 4. Create Dockerfiles

    # Postgres
    with open(os.path.join(base_dir, "postgres", "Dockerfile"), "w") as f:
        f.write("FROM postgres:15-alpine\n")
        
    # Qdrant
    with open(os.path.join(base_dir, "qdrant", "Dockerfile"), "w") as f:
        f.write("FROM qdrant/qdrant:latest\n")

    # Backend
    backend_dockerfile = """# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set working directory to /app
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    build-essential \\
    libpq-dev \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
# We assume context is the root of the bundle, so we access backend/ and ingestion_module/
COPY backend/requirements.txt ./backend/requirements.txt
COPY ingestion_module/requirements.txt ./ingestion_module/requirements.txt

# Install packages
RUN pip install --no-cache-dir -r backend/requirements.txt
RUN pip install --no-cache-dir -r ingestion_module/requirements.txt
RUN python -m spacy download en_core_web_sm

# Copy application code
COPY backend/ ./backend/
COPY ingestion_module/ ./ingestion_module/

# Expose port
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Working directory
WORKDIR /app/backend

# Start uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
"""
    with open(os.path.join(base_dir, "backend.Dockerfile"), "w") as f:
        f.write(backend_dockerfile)

    # Nginx Config
    nginx_conf = """server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}"""
    with open(os.path.join(base_dir, "nginx.conf"), "w") as f:
        f.write(nginx_conf)

    # Frontend
    frontend_dockerfile = """# Stage 1: Build
FROM node:18-alpine as builder

WORKDIR /app

# Copy dependency definitions
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code relative to context
COPY frontend/ ./

# Build args
ARG VITE_API_URL
ARG VITE_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_KEY=$VITE_API_KEY

RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
# Copy config from root of context
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
"""
    with open(os.path.join(base_dir, "frontend.Dockerfile"), "w") as f:
        f.write(frontend_dockerfile)

    # 5. Create docker-compose.yml (Master)
    docker_compose = f"""version: '3.8'

services:
  db:
    build: 
      context: ./postgres
    restart: always
    environment:
      POSTGRES_USER: ${{POSTGRES_USER}}
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD}}
      POSTGRES_DB: ${{POSTGRES_DB}}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${{POSTGRES_USER}} -d ${{POSTGRES_DB}}"]
      interval: 5s
      retries: 5

  qdrant:
    build:
      context: ./qdrant
    restart: always
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

  backend:
    build:
      context: .
      dockerfile: backend.Dockerfile
    restart: always
    ports:
      - "8000:8000"
    volumes:
      - files_data:/files
    environment:
      POSTGRES_IP: ${{POSTGRES_IP}}
      POSTGRES_USER: ${{POSTGRES_USER}}
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD}}
      POSTGRES_DB: ${{POSTGRES_DB}}
      QDRANT_IP: ${{QDRANT_IP}}
      API_KEY: ${{API_KEY}}
      ENABLED_EXTENSIONS: ${{ENABLED_EXTENSIONS}}
      OLLAMA_HOST: ${{OLLAMA_HOST}}
    depends_on:
      db:
        condition: service_healthy
    extra_hosts:
      - "host.docker.internal:host-gateway"

  frontend:
    build:
      context: .
      dockerfile: frontend.Dockerfile
      args:
        VITE_API_URL: ${{VITE_API_URL}}
        VITE_API_KEY: ${{VITE_API_KEY}}
    restart: always
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  postgres_data:
  qdrant_data:
  files_data:
"""
    with open(os.path.join(base_dir, "docker-compose.yml"), "w") as f:
        f.write(docker_compose)

    # 6. Create Split Docker Compose Files

    # Postgres Only
    dc_postgres = f"""version: '3.8'
services:
  db:
    build: 
      context: ./postgres
    restart: always
    environment:
      POSTGRES_USER: ${{POSTGRES_USER}}
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD}}
      POSTGRES_DB: ${{POSTGRES_DB}}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${{POSTGRES_USER}} -d ${{POSTGRES_DB}}"]
      interval: 5s
      retries: 5
volumes:
  postgres_data:
"""
    with open(os.path.join(base_dir, "docker-compose.postgres.yml"), "w") as f:
        f.write(dc_postgres)

    # Qdrant Only
    dc_qdrant = """version: '3.8'
services:
  qdrant:
    build:
      context: ./qdrant
    restart: always
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
volumes:
  qdrant_data:
"""
    with open(os.path.join(base_dir, "docker-compose.qdrant.yml"), "w") as f:
        f.write(dc_qdrant)

    # Backend Only
    dc_backend = f"""version: '3.8'
services:
  backend:
    build:
      context: .
      dockerfile: backend.Dockerfile
    restart: always
    ports:
      - "8000:8000"
    volumes:
      - files_data:/files
    environment:
      POSTGRES_IP: ${{POSTGRES_IP}}
      POSTGRES_USER: ${{POSTGRES_USER}}
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD}}
      POSTGRES_DB: ${{POSTGRES_DB}}
      QDRANT_IP: ${{QDRANT_IP}}
      API_KEY: ${{API_KEY}}
      ENABLED_EXTENSIONS: ${{ENABLED_EXTENSIONS}}
      OLLAMA_HOST: ${{OLLAMA_HOST}}
    extra_hosts:
      - "host.docker.internal:host-gateway"
volumes:
  files_data:
"""
    with open(os.path.join(base_dir, "docker-compose.backend.yml"), "w") as f:
        f.write(dc_backend)

    # Frontend Only
    dc_frontend = f"""version: '3.8'
services:
  frontend:
    build:
      context: .
      dockerfile: frontend.Dockerfile
      args:
        VITE_API_URL: ${{VITE_API_URL}}
        VITE_API_KEY: ${{VITE_API_KEY}}
    restart: always
    ports:
      - "80:80"
"""
    with open(os.path.join(base_dir, "docker-compose.frontend.yml"), "w") as f:
        f.write(dc_frontend)

    print(f"\nBundle created successfully in '{base_dir}'!")
    print(f"You can now move directory '{org_name}' to any machine.")
    print("Generated split docker-compose files for distributed deployment:")
    print("- docker-compose.postgres.yml")
    print("- docker-compose.qdrant.yml")
    print("- docker-compose.backend.yml")
    print("- docker-compose.frontend.yml")


if __name__ == "__main__":
    main()
