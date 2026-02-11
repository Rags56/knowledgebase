import shutil
from qdrant_client import models
import psycopg2


import json
import uuid
import hashlib
import os
from main import postgres_ip, QDRANT_IP, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
from fastapi import APIRouter, FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
import requests
from pydantic import BaseModel
from typing import List, Optional
from psycopg2 import pool
from fastapi import Depends
from main import verify_api_key
import sys
import os
# Add master directory to sys.path to allow importing from ingestion_module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../')))
# Add ingestion_module directly to sys.path so its internal imports (like languagedetect) work
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../ingestion_module')))
from ingestion_module.embedding import create_embedding
from qdrant_client import QdrantClient
from langdetect import detect
from sentence_transformers import SentenceTransformer
import ollama

# Model cache to avoid reloading heavy models
model_cache = {}

def get_embedding_model(model_name):
    if model_name not in model_cache:
        # Load on CPU/GPU as available
        model_cache[model_name] = SentenceTransformer(model_name)
    return model_cache[model_name]

# Define files directory in the project root
FILES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../files'))

db_pool = psycopg2.pool.SimpleConnectionPool(1, 150, user=POSTGRES_USER, password=POSTGRES_PASSWORD, host=postgres_ip.split("//")[1].split(":")[0], port=int(postgres_ip.split(":")[-1]), database=POSTGRES_DB)

def log_action(action: str):
    try:
        conn = db_pool.getconn()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO audit_general (timestamp, action) VALUES (NOW(), %s)", (action,))
        conn.commit()
        db_pool.putconn(conn)
    except Exception as e:
        print(f"Error logging action: {e}")


router = APIRouter()
def setup_database_extension():
    conn = db_pool.getconn()
    cursor = conn.cursor()
    #table will be like this 
    #id + name + files (json array: [{filename, hash, document_id}])
    cursor.execute("CREATE TABLE IF NOT EXISTS lecture (id SERIAL PRIMARY KEY, name VARCHAR(255), files TEXT)")
    # Migration: Add audit_id to ai_chats if not exists
    cursor.execute("ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS audit_id INT")
    conn.commit()
    db_pool.putconn(conn)



#intialize the user model
class UserCreate(BaseModel):
    user_id: int
    flags: List[str] = [] 


#fake login
@router.post('/login')
def login(user_id: int, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    db_pool.putconn(conn)
    if user:
        return {'status': 'ok'}
    else:
        return {'status': 'not found'}


@router.post('/create-user')
def create_user(user: UserCreate, dependencies=Depends(verify_api_key)):
    user_id = user.user_id
    flags = user.flags
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO users (id, flags) VALUES (%s, %s)", (user_id, flags))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Created user {user_id} with flags {flags}")
    return {'status': 'ok'}

#lecture model
class LectureCreate(BaseModel):
    lecture_id: int
    name: str
    files: List[str] = []

@router.post('/create-lecture')
def create_lecture(lecture: LectureCreate, dependencies=Depends(verify_api_key)):
    name = lecture.name
    files = lecture.files
    lecture_id = lecture.lecture_id
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO lecture (id, name, files) VALUES (%s, %s, %s)", (lecture_id, name, files))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Created lecture {lecture_id}: {name}")
    return {'status': 'ok'}



@router.post("/upload-file/{lecture_id}")
def upload_file(
    lecture_id: str,
    file: UploadFile = File(...),
    dependencies=Depends(verify_api_key)
):
    # 1. Read file and compute hash
    file_content = file.file.read()
    file_hash = hashlib.md5(file_content).hexdigest()
    file_name = file.filename

    # Store files in lecture-specific folder
    lecture_dir = os.path.join(FILES_DIR, lecture_id)
    os.makedirs(lecture_dir, exist_ok=True)
    file_path = os.path.join(lecture_dir, file_name)

    # 2. Check if file already exists in DB for this lecture
    existing_file = get_file_record(lecture_id, file_name)
    document_id = str(uuid.uuid4()) # Default new ID

    if existing_file:
        document_id = existing_file.get("document_id") # Reuse existing ID if updating
        if existing_file["hash"] == file_hash:
            # 3. File already exists with same content -> skip
            log_action(f"File upload skipped (duplicate): {file_name} in lecture {lecture_id}")
            return {"message": "File already exists with the same content.", "lecture_id": lecture_id}
        else:
            # 5. Filename exists but different hash -> update
            # Use existing document_id for deletion and new embedding
            if document_id:
                delete_qdrant_vectors(document_id)
            update_file_record(lecture_id, file_name, file_hash) # record keeps same document_id
            action = "updated"
    else:
        # New file -> insert into DB
        # We use the generated document_id
        insert_file_record(lecture_id, file_name, file_hash, document_id)
        action = "uploaded"

    # Save the file
    with open(file_path, "wb") as f:
        f.write(file_content)

    # Create embeddings
    # Pass document_id so it matches what we store in SQL
    create_embedding(file_path, extra_metadata={"class_id": lecture_id, "document_id": document_id})

    log_action(f"File {action}: {file_name} in lecture {lecture_id}")
    return {"message": f"File {action} successfully.", "lecture_id": lecture_id, "filename": file_name, "hash": file_hash}

@router.post('/bulkupload/{lecture_id}')
def bulkupload_files(lecture_id: str, files: List[UploadFile] = File(...), dependencies=Depends(verify_api_key)):
    #delete all files for this lecture
    delete_all_files(lecture_id)
    for file in files:
        upload_file(lecture_id, file)
    return {"message": "Files uploaded successfully.", "lecture_id": lecture_id}


#db schema -> lecture , files (array of file objects in JSON)
def get_file_record(lecture_id: str, filename: str):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT files FROM lecture WHERE id = %s", (lecture_id,))
    result = cursor.fetchone()
    db_pool.putconn(conn)
    
    if result and result[0]:
        try:
            files_list = json.loads(result[0])
            for f in files_list:
                if f.get("filename") == filename:
                    return f
        except json.JSONDecodeError:
            pass
    return None

def insert_file_record(lecture_id: str, filename: str, file_hash: str, document_id: str):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    
    # Use passed document_id
    new_file = {
        "filename": filename,
        "hash": file_hash,
        "document_id": document_id
    }
    
    # Fetch existing
    cursor.execute("SELECT files FROM lecture WHERE id = %s", (lecture_id,))
    result = cursor.fetchone()
    
    current_files = []
    if result and result[0]:
        try:
            loaded_files = json.loads(result[0])
            if isinstance(loaded_files, list):
                current_files = loaded_files
            else:
                # If it's not a list (e.g. dict or string), handle appropriately
                # Assuming schema corruption or legacy data, we might want to start fresh or wrap it
                # For safety, let's just ignore non-list data or maybe wrap if it looks like a single file object?
                # But our schema expects a list.
                current_files = [] 
        except json.JSONDecodeError:
            pass
            
    # Append and Update
    current_files.append(new_file)
    cursor.execute("UPDATE lecture SET files = %s WHERE id = %s", (json.dumps(current_files), lecture_id))
    conn.commit()
    db_pool.putconn(conn)

def delete_qdrant_vectors(document_id: str):
    client = QdrantClient(url=QDRANT_IP)
    client.delete(
        collection_name="documents",
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="document_id",
                        match=models.MatchValue(value=document_id)
                    )
                ]
            )
        )
    ) 
    
@router.post("/delete-all-files")
def delete_all_files(lecture_id: str, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT files FROM lecture WHERE id = %s", (lecture_id,))
    result = cursor.fetchone()
    if result and result[0]:
        try:
            files_list = json.loads(result[0])
            for f in files_list:
                delete_qdrant_vectors(f["document_id"])
        except json.JSONDecodeError:
            pass
    #delete files in the "files folder"
    lecture_dir = os.path.join(FILES_DIR, lecture_id)
    if os.path.exists(lecture_dir):
        shutil.rmtree(lecture_dir)
    cursor.execute("UPDATE lecture SET files = %s WHERE id = %s", (json.dumps([]), lecture_id))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Deleted all files for lecture {lecture_id}")
    return {"message": "All files deleted successfully."}


@router.post("/delete-file/{lecture_id}")
def delete_file(lecture_id: str, filename: str, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT files FROM lecture WHERE id = %s", (lecture_id,))
    result = cursor.fetchone()
    
    if result and result[0]:
        try:
            files_list = json.loads(result[0])
            new_files_list = []
            deleted = False
            for f in files_list:
                if f.get("filename") == filename:
                    # Delete from Qdrant
                    if f.get("document_id"):
                        delete_qdrant_vectors(f["document_id"])
                    # Delete from FS
                    file_path = os.path.join(FILES_DIR, lecture_id, filename)
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    deleted = True
                else:
                    new_files_list.append(f)
            
            if deleted:
                cursor.execute("UPDATE lecture SET files = %s WHERE id = %s", (json.dumps(new_files_list), lecture_id))
                conn.commit()
                log_action(f"Deleted file {filename} from lecture {lecture_id}")
            else:
                 # Ensure we return properly even if not deleted from logic perspective but DB op was fine
                 pass
                 
        except json.JSONDecodeError:
            pass
            
            pass
            
    db_pool.putconn(conn)
    return {"status": "ok", "message": "File deleted"}


def update_file_record(lecture_id: str, filename: str, new_hash: str):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    
    cursor.execute("SELECT files FROM lecture WHERE id = %s", (lecture_id,))
    result = cursor.fetchone()
    
    if result and result[0]:
        try:
            files_list = json.loads(result[0])
            updated = False
            for f in files_list:
                if f.get("filename") == filename:
                    f["hash"] = new_hash
                    updated = True
                    break
            
            if updated:
                cursor.execute("UPDATE lecture SET files = %s WHERE id = %s", (json.dumps(files_list), lecture_id))
                conn.commit()
        except json.JSONDecodeError:
            pass
        except json.JSONDecodeError:
            pass
    db_pool.putconn(conn)



#add student flags
@router.post('/add-student-flags')
def add_student_flags(user_id: int, flags: List[str], dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET flags = %s WHERE id = %s", (flags, user_id))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Added student flags for user {user_id}: {flags}")
    return {'status': 'ok'}

#edit lecture
@router.post('/edit-lecture')
def edit_lecture(lecture_id: int, name: str, files: List[str] = [], dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("UPDATE lecture SET name = %s, files = %s WHERE id = %s", (name, files, lecture_id))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Edited lecture {lecture_id}: name={name}")
    return {'status': 'ok'}

#delete student
@router.post('/delete-student')
def delete_student(user_id: int, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Deleted student {user_id}")
    return {'status': 'ok'}

#delete lecture
@router.post('/delete-lecture')
def delete_lecture(lecture_id: int, dependencies=Depends(verify_api_key)):
    #delete all files for this lecture
    delete_all_files(lecture_id)
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM lecture WHERE id = %s", (lecture_id,))
    conn.commit()
    db_pool.putconn(conn)
    log_action(f"Deleted lecture {lecture_id}")
    return {'status': 'ok'}


#get student lectures
@router.get('/get-lectures')
def get_lectures(user_id: int, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    
    # Get flags string for the user
    cursor.execute("SELECT flags FROM users WHERE id = %s", (user_id,))
    user_row = cursor.fetchone()
    
    lectures = []
    if user_row and user_row[0]:
        # Parse flags string. Assuming it could be "1,2,3" or "{1,2,3}" or "[1, 2]"
        flags_str = str(user_row[0])
        # remove potential wrapper chars
        clean_str = flags_str.replace("{", "").replace("}", "").replace("[", "").replace("]", "").replace("'", "").replace('"', "")
        
        # Split and clean
        flag_ids = [fid.strip() for fid in clean_str.split(",") if fid.strip()]
        
        if flag_ids:
            # Query lectures. CAST to integer array if needed, but psycopg2 handles list of strings for ANY usually if adaptable? 
            # Safest is to cast ids to int if possible, or let pg handle casting from string to int column
            # lecture.id is integer. Passing string to ANY(%s) works if strings are numerals.
            cursor.execute("SELECT id, name FROM lecture WHERE id = ANY(%s::int[])", (flag_ids,))
            lectures = cursor.fetchall()
            
    db_pool.putconn(conn)
    # Convert list of tuples to list of dicts for better client consumption, 
    # or keep as tuples if frontend expects it. Original code returned fetchall() -> tuples.
    # But usually API should return objects. 
    # Let's return list of dicts.
    return [{"id": l[0], "name": l[1]} for l in lectures]

#get logs
@router.get('/get-logs')
def get_logs(dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_general")
    logs = cursor.fetchall()
    db_pool.putconn(conn)
    return logs

#rag system
#database -> 
# ai_chats (id user_id session_id turn role message timestamp)

@router.post('/rag')
def rag(query: str, session_id: str, user_id: int, lecture_id: int, dependencies=Depends(verify_api_key)):
    # 1. Manage Sessions
    # If session_id is "-1" or -1, generate a new UUID
    if str(session_id) == "-1":
        # Prefix session with lecture_id for filtering
        session_id = f"{lecture_id}-{uuid.uuid4()}"

    # 2. Query Vector DB (Retrieval)
    # Detect language to choose correct embedding model
    try:
        lang = detect(query)
    except:
        lang = "en"

    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    if lang == "ar":
        model_name = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    embedding_model = get_embedding_model(model_name)
    query_vector = embedding_model.encode(query).tolist()

    client = QdrantClient(url=QDRANT_IP)
    
    # Search with filter for specific lecture_id (class_id)
    hits = client.query_points(
        collection_name="documents",
        query=query_vector,
        query_filter=models.Filter(
            must=[
                models.FieldCondition(
                    key="class_id",
                    match=models.MatchValue(value=str(lecture_id))
                )
            ]
        ),
        limit=1000,
    ).points

    # 3. Content & Generation
    context_chunks = [hit.payload.get("text", "") for hit in hits]
    context_text = "\n\n".join(context_chunks)
    
    files_accessed_set = set([hit.payload.get("filename", "unknown") for hit in hits])
    files_accessed_str = json.dumps(list(files_accessed_set))
    # Truncate files_accessed if too long for DB (VARCHAR(255))
    if len(files_accessed_str) > 255:
        files_accessed_str = files_accessed_str[:252] + "..."

    system_prompt = "You are a helpful teaching assistant. Answer the question based on the provided context accurately. If the answer is not in the context, state that you do not know based on the provided materials."
    user_prompt = f"Context:\n{context_text}\n\nQuestion: {query}"

    # 4. Chat History Management
    history_messages = []
    if str(session_id) != "-1":
        conn = None
        try:
            conn = db_pool.getconn()
            cursor = conn.cursor()
            # specialized query to get last 10 messages
            cursor.execute("SELECT role, message FROM ai_chats WHERE session_id = %s ORDER BY timestamp DESC LIMIT 10", (str(session_id),))
            rows = cursor.fetchall()
            db_pool.putconn(conn)
            conn = None # Set to None so finally/except doesn't try to put it back again if we were doing that
            
            for row in reversed(rows):
                role = row[0]
                content = row[1]
                if role == "system":
                    role = "assistant"
                history_messages.append({"role": role, "content": content})
        except Exception as e:
            print(f"Error fetching history: {e}")
            if conn:
                db_pool.putconn(conn)

    # 5. Generation (No Streaming)
    # Construct messages list
    messages = [{'role': 'system', 'content': system_prompt}]
    messages.extend(history_messages)
    messages.append({'role': 'user', 'content': user_prompt})

    try:
        # Generate full response
        response = ollama.chat(model='llama3:8b', messages=messages, stream=False)
        full_response = response['message']['content']

        # 6. Logging & Audit
        conn = db_pool.getconn()
        audit_id = None
        try:
            cursor = conn.cursor()
            
            # Log User Query
            cursor.execute(
                "INSERT INTO ai_chats (user_id, session_id, turn, role, message, timestamp) VALUES (%s, %s, %s, %s, %s, NOW())",
                (user_id, session_id, 1, "user", query)
            )
            
            # Log to audit_ai
            cursor.execute(
                "INSERT INTO audit_ai (timestamp, user_id, query, files_accessed, output) VALUES (NOW(), %s, %s, %s, %s) RETURNING id",
                (user_id, query, files_accessed_str, full_response)
            )
            result = cursor.fetchone()
            if result:
                audit_id = result[0]

            # Log AI Response with audit_id
            cursor.execute(
                "INSERT INTO ai_chats (user_id, session_id, turn, role, message, timestamp, audit_id) VALUES (%s, %s, %s, %s, %s, NOW(), %s)",
                (user_id, session_id, 2, "system", full_response, audit_id)
            )
            
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"Database logging error: {e}")
        finally:
            db_pool.putconn(conn)

        return {
            "session_id": session_id,
            "response": full_response,
            "audit_id": audit_id
        }

    except Exception as e:
        print(f"Ollama generation error: {e}")
        return {"error": str(e)}

@router.post('/update-audit-ai')
def update_audit_ai(audit_id: int, rating: str = None, feedback: str = None, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        if rating:
            cursor.execute("UPDATE audit_ai SET rating = %s WHERE id = %s", (rating, audit_id))
        if feedback:
            cursor.execute("UPDATE audit_ai SET feedback = %s WHERE id = %s", (feedback, audit_id))
        conn.commit()
    except Exception as e:
        conn.rollback()
        # raise expected exceptions instead of 500 ideally, but simple for now
        # fastapi usually handlers generic exceptions as 500
        print(f"Update audit error: {e}")
    finally:
        db_pool.putconn(conn)
    return {"status": "success", "message": "Audit log updated"}


#get all lectures
@router.get('/get-all-lectures')
def get_all_lectures(dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM lecture")
    lectures = cursor.fetchall()
    db_pool.putconn(conn)
    return {'lectures': lectures}

#get all users
@router.get('/get-all-users')
def get_all_users(dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users")
    users = cursor.fetchall()
    db_pool.putconn(conn)
    return {'users': users}

#get user chat sessions
#get user chat sessions
@router.get('/get-user-chat-sessions')
def get_user_chat_sessions(user_id: int, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    # Get unique sessions led by most recent
    cursor.execute("""
        SELECT session_id, MAX(timestamp) as last_active 
        FROM ai_chats 
        WHERE user_id = %s 
        GROUP BY session_id 
        ORDER BY last_active DESC
    """, (user_id,))
    chat_sessions = [{"session_id": row[0], "timestamp": row[1]} for row in cursor.fetchall()]
    db_pool.putconn(conn)
    return {'chat_sessions': chat_sessions}


#get chat history
@router.get('/get-chat-history')
def get_chat_history(session_id: str, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    cursor = conn.cursor()
    # Select additional columns from joined audit_ai table using LEFT JOIN on audit_id
    cursor.execute("""
        SELECT c.id, c.user_id, c.session_id, c.turn, c.role, c.message, c.timestamp, c.audit_id, a.rating
        FROM ai_chats c 
        LEFT JOIN audit_ai a ON c.audit_id = a.id 
        WHERE c.session_id = %s
    """, (session_id,))
    chat_history = cursor.fetchall()
    db_pool.putconn(conn)
    return {'chat_history': chat_history}

class FeedbackRequest(BaseModel):
    audit_id: int
    rating: str  # 'up', 'down'
    feedback: Optional[str] = None  # Optional

@router.post("/submit-feedback")
def submit_feedback(req: FeedbackRequest, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE audit_ai SET rating = %s, feedback = %s WHERE id = %s",
            (req.rating, req.feedback, req.audit_id)
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db_pool.putconn(conn)
    return {"status": "ok"}

@router.get("/get-all-feedbacks")
def get_all_feedbacks(dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        # Join with users to get user info if possible, but keep it simple
        cursor.execute("SELECT id, timestamp, user_id, query, output, rating, feedback FROM audit_ai ORDER BY timestamp DESC")
        rows = cursor.fetchall()
        feedbacks = []
        for row in rows:
            feedbacks.append({
                "id": row[0],
                "timestamp": row[1],
                "user_id": row[2],
                "query": row[3],
                "output": row[4],
                "rating": row[5],
                "feedback": row[6]
            })
    except Exception as e:
        feedbacks = []
        print(f"Error fetching logs: {e}")
    finally:
        db_pool.putconn(conn)
    return {"feedbacks": feedbacks}
    