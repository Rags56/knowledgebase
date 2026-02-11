# Knowledge Base System - Usage & Deployment Guide

This guide explains how to deploy the Knowledge Base system using the automated `setup_production.py` script, and details the manual steps required for setting up the AI model and developing new extensions.

## 1. Automated Deployment

The system is designed to be deployed as a self-contained bundle using the `setup_production.py` script. This script automates the configuration of the Backend, Frontend, PostgreSQL, and Qdrant services.

### Prerequisites
- **Python 3.12+** (for running the setup script)
- **Docker & Docker Compose** (installed on the target server)
- **Ollama** (installed on the target server for AI inference)

### Step 1: Generate the Production Bundle
1. Navigate to the project root directory (the parent of the `master` folder).
2. Run the setup script:
   ```bash
   python setup_production.py
   ```
3. Follow the interactive prompts:
   - **Configuration Name**: The name of the output folder.
   - **Database Credentials**: Username and password for PostgreSQL.
   - **API Key**: Security key for backend/frontend communication.
   - **Extensions**: Comma-separated list of enabled extensions (e.g., `lectures`).
   - **Frontend URL**: The full URL where the backend will be accessible (e.g., `http://YOUR_SERVER_IP:8000`).

The script will create a new directory (e.g., `my-deployment/`) containing all source code, Dockerfiles, and a ready-to-use `docker-compose.yml`.

### Step 2: Running on the Server
1. Transfer the generated folder to your production server.
2. Ensure **Ollama** is running (see Section 2).
3. Start the services:
   ```bash
   cd my-deployment
   docker-compose up -d --build
   ```
   This will spin up:
   - **Backend**: API server on Port 8000
   - **Frontend**: Nginx server on Port 80
   - **PostgreSQL**: Port 5432
   - **Qdrant**: Port 6333

---

## 2. Server-Side Manual Configuration (Ollama)

The system relies on a local LLM runner (Ollama). This is **not** included in the Docker bundle and must be running on the host machine.

### Instructions
1. **Install Ollama**: Follow instructions at [ollama.com](https://ollama.com).
2. **Download the Model**: The system defaults to `llama3:8b`. You must pull this specific model:
   ```bash
   ollama pull llama3:8b
   ```
3. **Start the Service**:
   ```bash
   ollama serve
   ```
   *Note: The Docker containers are configured to communicate with Ollama on the host via `host.docker.internal`.*

   *Note: The Docker containers are configured to communicate with Ollama on the host via `host.docker.internal`.*

---

## 2.5 Distributed Deployment (Multi-Server)

By default, the `docker-compose.yml` file runs all services on a single machine. For production scenarios requiring scalability, you can split these services across multiple servers (e.g., one DB server, one App server).

### Steps for a 2-Server Setup (Database + App):

1. **Prepare the Bundle**: Generate the deployment bundle using `setup_production.py` as usual.
2. **Copy Bundle**: Transfer the **entire** deployment folder to **both** Server A (Database) and Server B (App).

#### Server A: Databases (Postgres + Qdrant)
1. Navigate to the deployment folder.
2. Run the specific database compose files:
   ```bash
   docker-compose -f docker-compose.postgres.yml -f docker-compose.qdrant.yml up -d
   ```
   *Alternatively, you can run them individually.*
3. **Important**: Ensure the server's firewall allows incoming traffic on ports `5432` (Postgres) and `6333` (Qdrant) from Server B.

#### Server B: Application (Backend + Frontend)
1. Navigate to the deployment folder.
2. **Edit `.env`**:
   Update the IPs to point to Server A:
   ```ini
   POSTGRES_IP=http://<IP_OF_SERVER_A>:5432
   QDRANT_IP=http://<IP_OF_SERVER_A>:6333
   ```
3. Run the application compose files:
   ```bash
   docker-compose -f docker-compose.backend.yml -f docker-compose.frontend.yml up -d
   ```

*Note: You can further split the Backend and Frontend onto separate servers by copying the bundle to a third server and running only `docker-compose.frontend.yml` on it (updating `VITE_API_URL` to point to the backend server).*

---

## 3. Developing & Adding Extensions (Manual Step)

The `setup_production.py` script copies the codebase as it exists at the time of execution. To add new functionality or extensions, you must modify the source code in the `master` directory **before** running the setup script.

### How to Add a New Extension
If you want to add a new module (e.g., "research_papers"):

1. **Backend Extension**:
   - Create a new directory: `master/backend/extensions/research_papers/`.
   - Create a `routes.py` file inside it.
   - Implement a `router` (FastAPI APIRouter) and a `setup_database_extension()` function.
   
2. **Ingestion Rules**:
   - Edit `master/ingestion_module/embeddingrules.py` to define how files for this extension should be chunked/embedded.
   - Edit `master/ingestion_module/metadata.py` to add any required metadata fields.

3. **Deploy**:
   - Run `python setup_production.py`.
   - When prompted for **Extensions**, enter: `lectures,research_papers`.

---

## 4. System Usage

Once deployed, the system exposes the following interfaces:

- **Web Interface**: `http://YOUR_SERVER_IP/`
- **Backend API Docs**: `http://YOUR_SERVER_IP:8000/docs`

### Core Functionality
- **User Management**: Create users via the API or Admin panel (if configured).
- **Lectures/Classes**: Create knowledge scopes (Lectures) to organize documents.
- **RAG Chat**: Users can chat with the AI, which uses Qdrant to retrieve relevant context from the uploaded documents.
