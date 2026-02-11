from fastapi import FastAPI, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
import importlib
import psycopg2
#import env 
import os
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance
from qdrant_client.http.models import PointStruct
postgres_ip = os.getenv("POSTGRES_IP") or "http://localhost:5432" 
POSTGRES_USER = os.getenv("POSTGRES_USER") or "root"
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD") or "blockexe123"
POSTGRES_DB = os.getenv("POSTGRES_DB") or "knowledge_base"
QDRANT_IP = os.getenv("QDRANT_IP") or "http://localhost:6333"
API_KEY = os.getenv("API_KEY") or "blockexe123"
app = FastAPI()

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

# Always load core
from core.routes import router as core_router
app.include_router(core_router)

# Enabled extensions (config / env / DB / feature flags)
extensions_env = os.getenv("ENABLED_EXTENSIONS", "lectures")
ENABLED_EXTENSIONS = [ext.strip() for ext in extensions_env.split(",") if ext.strip()]

@app.on_event("startup")
def setup_database():
    #setup the main database components for postgresql
    conn = psycopg2.connect(
        host=postgres_ip.split("//")[1].split(":")[0], #take only the first part of the ip - http
        port=int(postgres_ip.split(":")[-1]), #take only the second part of the ip
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB
    )
    #create users table (id) (password) (optional if we want auth) flags (optional)
    cursor = conn.cursor() 
    cursor.execute("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, password VARCHAR(255), flags VARCHAR(255))")
    
    #create two audit tables
    #general audit -> timestamp + action
    cursor.execute("CREATE TABLE IF NOT EXISTS audit_general (id SERIAL PRIMARY KEY, timestamp TIMESTAMP, action VARCHAR(255))")
    #ai audit table -> id + timestamp + user + query + files accessed + output + rating (thumbs up/down) + feedback
    cursor.execute("CREATE TABLE IF NOT EXISTS audit_ai (id SERIAL PRIMARY KEY, timestamp TIMESTAMP, user_id INT REFERENCES users(id), query TEXT, files_accessed TEXT, output TEXT, rating VARCHAR(255), feedback TEXT)")
    #ai chats    
    cursor.execute("CREATE TABLE IF NOT EXISTS ai_chats (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), session_id VARCHAR(255), turn INT, role VARCHAR(10), message TEXT, timestamp TIMESTAMP DEFAULT NOW())")
    #sessions table
    cursor.execute("CREATE TABLE IF NOT EXISTS sessions ( session_id TEXT PRIMARY KEY,user_id INT NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT now(),expires_at TIMESTAMP NOT NULL)")
    conn.commit()
    conn.close()
    qdrant_setup()

def qdrant_setup():
    client = QdrantClient(url=QDRANT_IP)
    
    # Check if the collection exists
    if not client.collection_exists("documents"):
        client.create_collection(
            collection_name="documents",
            vectors_config=VectorParams(size=384, distance=Distance.COSINE)
        )
    
#call the setup_database_extension function from the extension file
for ext in ENABLED_EXTENSIONS:
    module_path = f"extensions.{ext}.routes"
    module = importlib.import_module(module_path)
    module.setup_database_extension()


for ext in ENABLED_EXTENSIONS:
    module_path = f"extensions.{ext}.routes"
    module = importlib.import_module(module_path)
    app.include_router(module.router)
