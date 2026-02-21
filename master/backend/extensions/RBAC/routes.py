import shutil
from qdrant_client import models
import psycopg2

import json
import uuid
import hashlib
import os
from main import postgres_ip, QDRANT_IP, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
from fastapi import APIRouter, FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import StreamingResponse
import requests
from pydantic import BaseModel
from typing import List, Optional
from psycopg2 import pool
from fastapi import Depends
from main import verify_api_key
import sys
import os
import bcrypt

# Add master directory to sys.path to allow importing from ingestion_module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../')))
# Add ingestion_module directly to sys.path so its internal imports (like languagedetect) work
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../ingestion_module')))
from ingestion_module.embedding import create_embedding
from qdrant_client import QdrantClient
from langdetect import detect
from sentence_transformers import SentenceTransformer
import ollama

# ---------------------------------------------------------------------------
# Model cache to avoid reloading heavy models
# ---------------------------------------------------------------------------
model_cache = {}

def get_embedding_model(model_name):
    if model_name not in model_cache:
        model_cache[model_name] = SentenceTransformer(model_name)
    return model_cache[model_name]

# Define files directory in the project root
FILES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../files'))

db_pool = psycopg2.pool.SimpleConnectionPool(
    1, 150,
    user=POSTGRES_USER,
    password=POSTGRES_PASSWORD,
    host=postgres_ip.split("//")[1].split(":")[0],
    port=int(postgres_ip.split(":")[-1]),
    database=POSTGRES_DB
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log_action(action: str):
    """Write an entry to audit_general."""
    try:
        conn = db_pool.getconn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO audit_general (timestamp, action) VALUES (NOW(), %s)",
            (action,)
        )
        conn.commit()
        db_pool.putconn(conn)
    except Exception as e:
        print(f"Error logging action: {e}")


def _parse_flags(flags_raw) -> List[str]:
    """
    Parse flags that are stored as a comma-separated TEXT column.
    e.g. "manager,programmer"  →  ["manager", "programmer"]
         ""                    →  []
    """
    if not flags_raw:
        return []
    return [f.strip() for f in str(flags_raw).split(",") if f.strip()]


def _flags_to_str(flags) -> str:
    """
    Convert a list of flags to the canonical comma-separated storage format.
    e.g. ["manager", "programmer"]  →  "manager,programmer"
         []                         →  ""
    """
    if not flags:
        return ""
    return ",".join(str(f).strip().lower() for f in flags if str(f).strip())


def _require_admin(user_id: int) -> None:
    """
    Raise HTTP 403 if the given user_id does not have the 'admin' role.
    Call this at the top of every admin-only endpoint.
    """
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row or row[0] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()

# ---------------------------------------------------------------------------
# DB setup
# ---------------------------------------------------------------------------

def setup_database_extension():
    conn = db_pool.getconn()
    cursor = conn.cursor()

    # users – flags stored as comma-separated TEXT (e.g. "manager,programmer")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id       SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            flags    TEXT         NOT NULL DEFAULT '',
            role     VARCHAR(50)  NOT NULL DEFAULT 'user'
                     CHECK (role IN ('admin', 'user'))
        )
    """)

    # files – flags stored as comma-separated TEXT; empty string = PUBLIC
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id          SERIAL PRIMARY KEY,
            filename    VARCHAR(512) NOT NULL,
            document_id VARCHAR(255),
            flags       TEXT         NOT NULL DEFAULT '',
            hash        VARCHAR(64)
        )
    """)

    # org_flags registry: canonical list of all valid org-level flags
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS org_flags (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(100) UNIQUE NOT NULL,
            description TEXT         DEFAULT ''
        )
    """)
    #add default user
    # Seeded on first boot using the Postgres DB credentials (POSTGRES_USER / POSTGRES_PASSWORD).
    # INSERT fires only when the users table is empty → fully idempotent on restarts.
    _default_pw_hash = bcrypt.hashpw(
        POSTGRES_PASSWORD.encode('utf-8'), bcrypt.gensalt()
    ).decode('utf-8')
    cursor.execute(
        """
        INSERT INTO users (username, password, flags, role)
        SELECT %s, %s, '', 'admin'
        WHERE NOT EXISTS (SELECT 1 FROM users LIMIT 1)
        """,
        (POSTGRES_USER, _default_pw_hash)
    )



    # ── Migrations for existing installations ──────────────────────────────
    # If flags columns are still TEXT[] (old schema), convert them to TEXT.
    cursor.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='flags'
                  AND data_type='ARRAY'
            ) THEN
                ALTER TABLE users ALTER COLUMN flags TYPE TEXT
                    USING array_to_string(flags, ',');
                ALTER TABLE users ALTER COLUMN flags SET DEFAULT '';
            END IF;
        END$$;
    """)
    cursor.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='files' AND column_name='flags'
                  AND data_type='ARRAY'
            ) THEN
                ALTER TABLE files ALTER COLUMN flags TYPE TEXT
                    USING array_to_string(flags, ',');
                ALTER TABLE files ALTER COLUMN flags SET DEFAULT '';
            END IF;
        END$$;
    """)
    # Ensure audit_id column exists on ai_chats
  
    conn.commit()
    db_pool.putconn(conn)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    username: str
    password: str
    flags: List[str] = []       # Org-level flags, e.g. ["manager", "programmer"]
    role: str = "user"          # System-level role: "admin" | "user"


class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    flags: Optional[List[str]] = None
    role: Optional[str] = None


class FileFlags(BaseModel):
    file_id: int
    flags: List[str]            # Org-level flags placed on this file


class FlagCreate(BaseModel):
    name: str                   # e.g. "manager", "programmer"
    description: Optional[str] = ""


class RAGRequest(BaseModel):
    query: str
    session_id: str
    user_id: int


class FeedbackRequest(BaseModel):
    audit_id: int
    rating: str                 # 'up' | 'down'
    feedback: Optional[str] = None


# ---------------------------------------------------------------------------
# FLAG MANAGEMENT  (admin only)
# ---------------------------------------------------------------------------
# The `org_flags` table is the canonical registry of every valid organisational
# flag/department in the system (e.g. "manager", "programmer").
# Admins create/delete flags here; those flag names are then assigned to users
# and files via the user and file management endpoints.
# ---------------------------------------------------------------------------

@router.post('/admin/flags', tags=["Admin – Flags"])
def create_flag(
    admin_id: int,
    payload: FlagCreate,
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Register a new organisational flag (e.g. `manager`, `programmer`).

    Once created the flag name can be assigned to users (`set-user-flags`) and
    to files (`set-file-flags` / `upload-file`).
    """
    _require_admin(admin_id)

    name = payload.name.strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="Flag name cannot be empty")

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO org_flags (name, description) VALUES (%s, %s) RETURNING id",
            (name, payload.description or "")
        )
        new_id = cursor.fetchone()[0]
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=409, detail=f"Flag '{name}' already exists")
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} created org flag '{name}' (id={new_id})")
    return {"status": "ok", "id": new_id, "name": name, "description": payload.description}


@router.get('/admin/flags', tags=["Admin – Flags"])
def list_flags(admin_id: int, dependencies=Depends(verify_api_key)):
    """
    **Admin only.** Return the full list of registered organisational flags.
    """
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description FROM org_flags ORDER BY name")
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "flags": [
            {"id": r[0], "name": r[1], "description": r[2]}
            for r in rows
        ]
    }


@router.get('/admin/flags/{flag_id}', tags=["Admin – Flags"])
def get_flag(flag_id: int, admin_id: int, dependencies=Depends(verify_api_key)):
    """
    **Admin only.** Get details for a single flag by its id.
    """
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description FROM org_flags WHERE id = %s", (flag_id,))
        row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="Flag not found")

    return {"id": row[0], "name": row[1], "description": row[2]}


@router.put('/admin/flags/{flag_id}', tags=["Admin – Flags"])
def update_flag(
    flag_id: int,
    admin_id: int,
    payload: FlagCreate,
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Rename a flag and/or update its description.

    This performs a **cascade rename**: the old flag name is replaced with the
    new name in every `users.flags` and `files.flags` comma-separated column,
    and Qdrant payload metadata is updated for every affected document.
    """
    _require_admin(admin_id)

    new_name = payload.name.strip().lower()
    if not new_name:
        raise HTTPException(status_code=400, detail="Flag name cannot be empty")

    # ── 1. Get the current name before renaming ──────────────────────────────
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM org_flags WHERE id = %s", (flag_id,))
        old_row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not old_row:
        raise HTTPException(status_code=404, detail="Flag not found")

    old_name = old_row[0]
    if old_name == new_name and (payload.description or "") == "":
        # No real change – but still return OK
        return {"status": "ok", "id": flag_id, "name": new_name, "description": payload.description}

    # ── 2. Update org_flags registry ─────────────────────────────────────────
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE org_flags SET name = %s, description = %s WHERE id = %s RETURNING id",
            (new_name, payload.description or "", flag_id)
        )
        if not cursor.fetchone():
            conn.rollback()
            raise HTTPException(status_code=404, detail="Flag not found")
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=409, detail=f"Flag name '{new_name}' is already taken")
    finally:
        db_pool.putconn(conn)

    if old_name == new_name:
        log_action(f"Admin {admin_id} updated description of org flag '{old_name}'")
        return {"status": "ok", "id": flag_id, "name": new_name, "description": payload.description}

    # ── 3. Cascade: rename in users.flags (comma-separated TEXT) ─────────────
    # Pattern handles four cases:
    #   sole value:    "manager"           → replaced whole string
    #   start:         "manager,programmer" → "new,programmer"
    #   middle:        "x,manager,y"       → "x,new,y"
    #   end:           "x,manager"         → "x,new"
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE users
            SET flags = regexp_replace(
                regexp_replace(
                    regexp_replace(
                        regexp_replace(flags,
                            '^' || %s || '$', %s),      -- sole value
                        '^' || %s || ',', %s || ','),    -- leading
                    ',' || %s || '$', ',' || %s),        -- trailing
                ',' || %s || ',', ',' || %s || ',')      -- middle
            WHERE flags ~ ('(^|,)' || %s || '(,|$)')
            """,
            (
                old_name, new_name,
                old_name, new_name,
                old_name, new_name,
                old_name, new_name,
                old_name
            )
        )
        users_updated = cursor.rowcount
        conn.commit()
    finally:
        db_pool.putconn(conn)

    # ── 4. Cascade: rename in files.flags + collect document_ids ─────────────
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE files
            SET flags = regexp_replace(
                regexp_replace(
                    regexp_replace(
                        regexp_replace(flags,
                            '^' || %s || '$', %s),
                        '^' || %s || ',', %s || ','),
                    ',' || %s || '$', ',' || %s),
                ',' || %s || ',', ',' || %s || ',')
            WHERE flags ~ ('(^|,)' || %s || '(,|$)')
            RETURNING document_id, flags
            """,
            (
                old_name, new_name,
                old_name, new_name,
                old_name, new_name,
                old_name, new_name,
                old_name
            )
        )
        updated_files = cursor.fetchall()   # [(document_id, new_flags_str), ...]
        files_updated = len(updated_files)
        conn.commit()
    finally:
        db_pool.putconn(conn)

    # ── 5. Cascade: update Qdrant payload for affected documents ─────────────
    if updated_files:
        client = QdrantClient(url=QDRANT_IP)
        for doc_id, new_flags_str in updated_files:
            if not doc_id:
                continue
            new_flags_list = _parse_flags(new_flags_str)
            client.set_payload(
                collection_name="documents",
                payload={
                    "flags": new_flags_str,          # comma-separated
                    "is_public": len(new_flags_list) == 0
                },
                points=models.FilterSelector(
                    filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="document_id",
                                match=models.MatchValue(value=doc_id)
                            )
                        ]
                    )
                )
            )

    log_action(
        f"Admin {admin_id} renamed org flag '{old_name}' → '{new_name}' "
        f"(users updated: {users_updated}, files updated: {files_updated})"
    )
    return {
        "status": "ok",
        "id": flag_id,
        "old_name": old_name,
        "new_name": new_name,
        "description": payload.description,
        "cascade": {"users_updated": users_updated, "files_updated": files_updated}
    }


@router.delete('/admin/flags/{flag_id}', tags=["Admin – Flags"])
def delete_flag(flag_id: int, admin_id: int, dependencies=Depends(verify_api_key)):
    """
    **Admin only.** Remove an organisational flag from the registry.

    ⚠️  This only removes the flag definition. It does **not** strip the flag
    name from existing users or files — do that first if needed.
    """
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM org_flags WHERE id = %s RETURNING name", (flag_id,))
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Flag not found")
        conn.commit()
        deleted_name = row[0]
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} deleted org flag id={flag_id} ('{deleted_name}')")
    return {"status": "ok", "deleted": {"id": flag_id, "name": deleted_name}}


@router.get('/admin/flags/{flag_id}/users', tags=["Admin – Flags"])
def get_users_with_flag(flag_id: int, admin_id: int, dependencies=Depends(verify_api_key)):
    """
    **Admin only.** List every user that currently carries the given organisational flag.

    Useful for auditing who belongs to a department before renaming or deleting
    the flag.
    """
    _require_admin(admin_id)

    # Resolve flag name first
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM org_flags WHERE id = %s", (flag_id,))
        flag_row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not flag_row:
        raise HTTPException(status_code=404, detail="Flag not found")

    flag_name = flag_row[0]

    # Find users whose comma-separated flags column contains this flag name
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, username, flags, role
            FROM users
            WHERE flags ~ ('(^|,)' || %s || '(,|$)')
            ORDER BY id
            """,
            (flag_name,)
        )
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "flag": {"id": flag_id, "name": flag_name},
        "users": [
            {
                "id": r[0],
                "username": r[1],
                "flags": _parse_flags(r[2]),
                "role": r[3]
            }
            for r in rows
        ]
    }


@router.get('/admin/flags/{flag_id}/files', tags=["Admin – Flags"])
def get_files_with_flag(flag_id: int, admin_id: int, dependencies=Depends(verify_api_key)):
    """
    **Admin only.** List every file that carries the given organisational flag.
    """
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM org_flags WHERE id = %s", (flag_id,))
        flag_row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not flag_row:
        raise HTTPException(status_code=404, detail="Flag not found")

    flag_name = flag_row[0]

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, filename, flags, hash
            FROM files
            WHERE flags ~ ('(^|,)' || %s || '(,|$)')
            ORDER BY id
            """,
            (flag_name,)
        )
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "flag": {"id": flag_id, "name": flag_name},
        "files": [
            {
                "id": r[0],
                "filename": r[1],
                "flags": _parse_flags(r[2]),
                "hash": r[3]
            }
            for r in rows
        ]
    }


# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------

@router.post('/login', tags=["Auth"])
def login(username: str, password: str, dependencies=Depends(verify_api_key)):
    """
    Authenticate a user by username + password.
    Returns user_id, flags (org-level), and role (system-level).
    """
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, username, password, flags, role FROM users WHERE username = %s",
            (username,)
        )
        user = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    stored_hash = user[2]
    if not bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    log_action(f"User {user[0]} ({username}) logged in")
    return {
        "status": "ok",
        "user_id": user[0],
        "username": user[1],
        "flags": _parse_flags(user[3]),
        "role": user[4]
    }


# ---------------------------------------------------------------------------
# USER MANAGEMENT  (admin only)
# ---------------------------------------------------------------------------

@router.post('/admin/create-user', tags=["Admin - Users"])
def create_user(
    admin_id: int,
    user: UserCreate,
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Create a new user.

    - `flags`  – list of org-level flags (e.g. ["manager", "programmer"])
    - `role`   – system role: "admin" or "user"
    """
    _require_admin(admin_id)

    hashed = bcrypt.hashpw(user.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (username, password, flags, role) VALUES (%s, %s, %s, %s) RETURNING id",
            (user.username, hashed, _flags_to_str(user.flags), user.role)
        )
        new_id = cursor.fetchone()[0]
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=409, detail="Username already exists")
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} created user {new_id} ({user.username}) flags={user.flags} role={user.role}")
    return {"status": "ok", "user_id": new_id}


@router.put('/admin/update-user/{user_id}', tags=["Admin - Users"])
def update_user(
    user_id: int,
    admin_id: int,
    payload: UserUpdate,
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Update username, password, flags, and/or role for an existing user.
    """
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        if payload.username is not None:
            cursor.execute("UPDATE users SET username = %s WHERE id = %s", (payload.username, user_id))
        if payload.password is not None:
            hashed = bcrypt.hashpw(payload.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            cursor.execute("UPDATE users SET password = %s WHERE id = %s", (hashed, user_id))
        if payload.flags is not None:
            cursor.execute("UPDATE users SET flags = %s WHERE id = %s", (_flags_to_str(payload.flags), user_id))
        if payload.role is not None:
            if payload.role not in ("admin", "user"):
                raise HTTPException(status_code=400, detail="role must be 'admin' or 'user'")
            cursor.execute("UPDATE users SET role = %s WHERE id = %s", (payload.role, user_id))
        conn.commit()
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} updated user {user_id}")
    return {"status": "ok"}


@router.put('/admin/set-user-flags/{user_id}', tags=["Admin - Users"])
def set_user_flags(
    user_id: int,
    admin_id: int,
    flags: List[str] = Query(...),
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Replace the org-level flags of a user.

    Flags represent organisational roles/departments (e.g. manager, programmer).
    """
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET flags = %s WHERE id = %s", (_flags_to_str(flags), user_id))
        conn.commit()
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} set flags for user {user_id}: {flags}")
    return {"status": "ok"}


@router.put('/admin/set-user-role/{user_id}', tags=["Admin - Users"])
def set_user_role(
    user_id: int,
    admin_id: int,
    role: str,
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Change the system-level role of a user ('admin' or 'user').
    """
    _require_admin(admin_id)
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'user'")

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))
        conn.commit()
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} set role for user {user_id} to '{role}'")
    return {"status": "ok"}


@router.delete('/admin/delete-user/{user_id}', tags=["Admin - Users"])
def delete_user(
    user_id: int,
    admin_id: int,
    dependencies=Depends(verify_api_key)
):
    """**Admin only.** Permanently delete a user."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} deleted user {user_id}")
    return {"status": "ok"}


@router.get('/admin/get-all-users', tags=["Admin - Users"])
def get_all_users(admin_id: int, dependencies=Depends(verify_api_key)):
    """**Admin only.** Return all users (id, username, flags, role). Passwords are excluded."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, flags, role FROM users ORDER BY id")
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "users": [
            {
                "id": r[0],
                "username": r[1],
                "flags": _parse_flags(r[2]),
                "role": r[3]
            }
            for r in rows
        ]
    }


@router.get('/user/me', tags=["Users"])
def get_user(user_id: int, dependencies=Depends(verify_api_key)):
    """Return profile for the given user (id, username, flags, role)."""
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, flags, role FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": row[0],
        "username": row[1],
        "flags": _parse_flags(row[2]),
        "role": row[3]
    }


# ---------------------------------------------------------------------------
# FILE MANAGEMENT  (admin only for upload/delete/set-flags)
# ---------------------------------------------------------------------------

def _delete_qdrant_vectors(document_id: str):
    """Remove all Qdrant vectors associated with a document_id."""
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


@router.post("/admin/upload-file", tags=["Admin - Files"])
def upload_file(
    admin_id: int,
    flags: List[str] = Query(default=[]),
    file: UploadFile = File(...),
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Upload a file and associate it with org-level flags.

    - `flags`  – list of org flags that are allowed to see this file.
                 Leave empty to make it **public** (visible to all users regardless of flags).
    - File is stored on disk and embedded into Qdrant with the given flags as metadata.
    """
    _require_admin(admin_id)

    file_content = file.file.read()
    file_hash = hashlib.md5(file_content).hexdigest()
    file_name = file.filename

    # Check if file already exists by name
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, document_id, hash FROM files WHERE filename = %s", (file_name,))
        existing = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    document_id = str(uuid.uuid4())
    action = "uploaded"

    if existing:
        existing_id, existing_doc_id, existing_hash = existing
        if existing_hash == file_hash:
            log_action(f"Admin {admin_id}: file upload skipped (duplicate): {file_name}")
            return {"message": "File already exists with the same content.", "filename": file_name}

        # File changed – delete old vectors and reuse document record
        document_id = existing_doc_id or document_id
        if existing_doc_id:
            _delete_qdrant_vectors(existing_doc_id)
        conn = db_pool.getconn()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE files SET hash = %s, document_id = %s, flags = %s WHERE id = %s",
                (file_hash, document_id, _flags_to_str(flags), existing_id)
            )
            conn.commit()
        finally:
            db_pool.putconn(conn)
        action = "updated"
    else:
        conn = db_pool.getconn()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO files (filename, document_id, flags, hash) VALUES (%s, %s, %s, %s)",
                (file_name, document_id, _flags_to_str(flags), file_hash)
            )
            conn.commit()
        finally:
            db_pool.putconn(conn)

    # Save file to disk
    os.makedirs(FILES_DIR, exist_ok=True)
    file_path = os.path.join(FILES_DIR, file_name)
    with open(file_path, "wb") as f:
        f.write(file_content)

    # Embed with flags metadata so Qdrant can filter by them.
    # flags stored as comma-separated string: "manager,programmer" or ""
    flags_csv = _flags_to_str(flags)
    create_embedding(
        file_path,
        extra_metadata={
            "document_id": document_id,
            "flags": flags_csv,          # e.g. "manager,programmer" or ""
            "is_public": len(flags) == 0
        }
    )

    log_action(f"Admin {admin_id}: file {action}: {file_name} flags={flags}")
    return {
        "message": f"File {action} successfully.",
        "filename": file_name,
        "document_id": document_id,
        "flags": flags,
        "hash": file_hash
    }


@router.post("/admin/bulk-upload", tags=["Admin - Files"])
def bulk_upload(
    admin_id: int,
    flags: List[str] = Query(default=[]),
    files: List[UploadFile] = File(...),
    dependencies=Depends(verify_api_key)
):
    """**Admin only.** Upload multiple files at once with the same org flags."""
    _require_admin(admin_id)
    results = []
    for f in files:
        result = upload_file(admin_id=admin_id, flags=flags, file=f)
        results.append(result)
    return {"results": results}


@router.put("/admin/set-file-flags/{file_id}", tags=["Admin - Files"])
def set_file_flags(
    file_id: int,
    admin_id: int,
    flags: List[str] = Query(...),
    dependencies=Depends(verify_api_key)
):
    """
    **Admin only.** Replace the org-level flags on an existing file.

    Pass an empty list to make the file public (no flags → accessible to everyone).
    """
    _require_admin(admin_id)

    flags_csv = _flags_to_str(flags)
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        # Update DB flags (comma-separated)
        cursor.execute("UPDATE files SET flags = %s WHERE id = %s", (flags_csv, file_id))
        # Fetch document_id to update Qdrant payload
        cursor.execute("SELECT document_id FROM files WHERE id = %s", (file_id,))
        row = cursor.fetchone()
        conn.commit()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    document_id = row[0]
    if document_id:
        # Overwrite the payload stored in every Qdrant point for this document
        client = QdrantClient(url=QDRANT_IP)
        client.set_payload(
            collection_name="documents",
            payload={"flags": flags_csv, "is_public": len(flags) == 0},  # comma-separated
            points=models.FilterSelector(
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

    log_action(f"Admin {admin_id} set file flags: file_id={file_id} flags={flags}")
    return {"status": "ok", "file_id": file_id, "flags": flags}


@router.delete("/admin/delete-file/{file_id}", tags=["Admin - Files"])
def delete_file(
    file_id: int,
    admin_id: int,
    dependencies=Depends(verify_api_key)
):
    """**Admin only.** Delete a file from disk, Qdrant, and the files table."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filename, document_id FROM files WHERE id = %s", (file_id,))
        row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    filename, document_id = row

    # Remove from Qdrant
    if document_id:
        _delete_qdrant_vectors(document_id)

    # Remove from disk
    file_path = os.path.join(FILES_DIR, filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    # Remove from DB
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM files WHERE id = %s", (file_id,))
        conn.commit()
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} deleted file {file_id}: {filename}")
    return {"status": "ok", "message": f"File '{filename}' deleted"}


@router.delete("/admin/delete-all-files", tags=["Admin - Files"])
def delete_all_files(admin_id: int, dependencies=Depends(verify_api_key)):
    """**Admin only.** Delete every file in the system."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filename, document_id FROM files")
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    for row in rows:
        fid, fname, doc_id = row
        if doc_id:
            _delete_qdrant_vectors(doc_id)
        file_path = os.path.join(FILES_DIR, fname)
        if os.path.exists(file_path):
            os.remove(file_path)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM files")
        conn.commit()
    finally:
        db_pool.putconn(conn)

    log_action(f"Admin {admin_id} deleted ALL files")
    return {"status": "ok", "message": "All files deleted"}


@router.get("/admin/get-all-files", tags=["Admin - Files"])
def get_all_files(admin_id: int, dependencies=Depends(verify_api_key)):
    """**Admin only.** Return full file list with id, filename, flags, and hash."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filename, document_id, flags, hash FROM files ORDER BY id")
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "files": [
            {
                "id": r[0],
                "filename": r[1],
                "document_id": r[2],
                "flags": _parse_flags(r[3]),
                "hash": r[4]
            }
            for r in rows
        ]
    }


@router.get("/files", tags=["Files"])
def get_accessible_files(user_id: int, dependencies=Depends(verify_api_key)):
    """
    Return the files accessible to the given user based on their org flags.

    A user can see:
    1. Files whose flags list **contains at least one of the user's flags**.
    2. Files with **no flags** (public files).
    """
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT flags FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    user_flags = _parse_flags(row[0])

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        if user_flags:
            # Build OR conditions: public (empty flags) OR any user flag appears in file flags.
            # Flags are stored as comma-separated TEXT, so we use regex per flag.
            flag_conditions = " OR ".join(
                ["flags ~ '(^|,)' || %s || '(,|$)'" for _ in user_flags]
            )
            sql = f"""
                SELECT id, filename, flags
                FROM files
                WHERE flags = ''
                   OR ({flag_conditions})
                ORDER BY id
            """
            cursor.execute(sql, user_flags)
        else:
            # User has no flags → only public files (empty flags string)
            cursor.execute(
                "SELECT id, filename, flags FROM files WHERE flags = '' ORDER BY id"
            )
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "files": [
            {"id": r[0], "filename": r[1], "flags": _parse_flags(r[2])}
            for r in rows
        ]
    }


# ---------------------------------------------------------------------------
# RAG  –  Role-Aware Retrieval
# ---------------------------------------------------------------------------

@router.post('/rag', tags=["RAG"])
def rag(
    query: str,
    session_id: str,
    user_id: int,
    dependencies=Depends(verify_api_key)
):
    """
    Role-aware RAG endpoint.

    The retrieval is scoped by the **user's org flags**:
    - Vectors whose `flags` field is `[]` (public) are **always** included.
    - Vectors whose `flags` field contains **at least one** of the user's flags are included.

    This means a user with flags=["manager"] sees manager-tagged files + every public file.
    A user with no flags sees only public files.
    """
    # ── 1. Resolve user flags ────────────────────────────────────────────────
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT flags FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    user_flags = _parse_flags(row[0])

    # ── 2. Session management ────────────────────────────────────────────────
    if str(session_id) == "-1":
        session_id = str(uuid.uuid4())

    # ── 3. Embed the query ───────────────────────────────────────────────────
    try:
        lang = detect(query)
    except Exception:
        lang = "en"

    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    if lang == "ar":
        model_name = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    embedding_model = get_embedding_model(model_name)
    query_vector = embedding_model.encode(query).tolist()

    # ── 4. RBAC-Aware Qdrant search ──────────────────────────────────────────
    #
    # Strategy: retrieve ALL results and post-filter by flag visibility, OR
    # build a Qdrant filter that matches public docs + docs with the user's flags.
    #
    # We use post-filtering here for simplicity and full recall; for large
    # collections you can push the filter into Qdrant directly.
    #
    client = QdrantClient(url=QDRANT_IP)
    hits = client.query_points(
        collection_name="documents",
        query=query_vector,
        limit=1000,
    ).points

    # Filter hits: keep if public (empty flags) OR user holds at least one matching flag
    def _is_accessible(payload: dict) -> bool:
        if payload.get("is_public", False):
            return True
        # flags stored as comma-separated string in Qdrant payload
        doc_flags = _parse_flags(payload.get("flags", ""))
        if not doc_flags:
            return True   # empty = public
        return bool(set(doc_flags) & set(user_flags))

    accessible_hits = [h for h in hits if _is_accessible(h.payload)]

    # ── 5. Build context ─────────────────────────────────────────────────────
    context_chunks = [h.payload.get("text", "") for h in accessible_hits]
    context_text = "\n\n".join(context_chunks)

    files_accessed_set = set(h.payload.get("filename", "unknown") for h in accessible_hits)
    files_accessed_str = json.dumps(list(files_accessed_set))
    if len(files_accessed_str) > 255:
        files_accessed_str = files_accessed_str[:252] + "..."

    system_prompt = (
        "You are a helpful assistant. Answer the question based on the provided context accurately. "
        "If the answer is not in the context, state that you do not know based on the provided materials."
    )
    user_prompt = f"Context:\n{context_text}\n\nQuestion: {query}"

    # ── 6. Chat history ──────────────────────────────────────────────────────
    history_messages = []
    if str(session_id) != "-1":
        conn = None
        try:
            conn = db_pool.getconn()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT role, message FROM ai_chats WHERE session_id = %s ORDER BY timestamp DESC LIMIT 10",
                (str(session_id),)
            )
            rows = cursor.fetchall()
            db_pool.putconn(conn)
            conn = None
            for row in reversed(rows):
                role = "assistant" if row[0] == "system" else row[0]
                history_messages.append({"role": role, "content": row[1]})
        except Exception as e:
            print(f"Error fetching history: {e}")
            if conn:
                db_pool.putconn(conn)

    # ── 7. Generate answer ───────────────────────────────────────────────────
    messages = [{'role': 'system', 'content': system_prompt}]
    messages.extend(history_messages)
    messages.append({'role': 'user', 'content': user_prompt})

    try:
        response = ollama.chat(model='llama3:8b', messages=messages, stream=False)
        full_response = response['message']['content']

        # ── 8. Audit logging ─────────────────────────────────────────────────
        audit_id = None
        conn = db_pool.getconn()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO ai_chats (user_id, session_id, turn, role, message, timestamp) VALUES (%s, %s, %s, %s, %s, NOW())",
                (user_id, session_id, 1, "user", query)
            )
            cursor.execute(
                "INSERT INTO audit_ai (timestamp, user_id, query, files_accessed, output) VALUES (NOW(), %s, %s, %s, %s) RETURNING id",
                (user_id, query, files_accessed_str, full_response)
            )
            result = cursor.fetchone()
            if result:
                audit_id = result[0]
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
            "audit_id": audit_id,
            "files_used": list(files_accessed_set)
        }

    except Exception as e:
        print(f"Ollama generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# FEEDBACK / AUDIT
# ---------------------------------------------------------------------------

@router.post('/update-audit-ai', tags=["Audit"])
def update_audit_ai(
    audit_id: int,
    rating: str = None,
    feedback: str = None,
    dependencies=Depends(verify_api_key)
):
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
        print(f"Update audit error: {e}")
    finally:
        db_pool.putconn(conn)
    return {"status": "success", "message": "Audit log updated"}


@router.post("/submit-feedback", tags=["Audit"])
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


@router.get("/admin/get-all-feedbacks", tags=["Admin - Audit"])
def get_all_feedbacks(admin_id: int, dependencies=Depends(verify_api_key)):
    """**Admin only.** Return all AI audit records with ratings and feedback."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, timestamp, user_id, query, output, rating, feedback FROM audit_ai ORDER BY timestamp DESC"
        )
        rows = cursor.fetchall()
    except Exception as e:
        rows = []
        print(f"Error fetching feedbacks: {e}")
    finally:
        db_pool.putconn(conn)

    return {
        "feedbacks": [
            {
                "id": r[0],
                "timestamp": r[1],
                "user_id": r[2],
                "query": r[3],
                "output": r[4],
                "rating": r[5],
                "feedback": r[6]
            }
            for r in rows
        ]
    }


@router.get('/admin/get-logs', tags=["Admin - Audit"])
def get_logs(admin_id: int, dependencies=Depends(verify_api_key)):
    """**Admin only.** Return all general audit log entries."""
    _require_admin(admin_id)

    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, timestamp, action FROM audit_general ORDER BY timestamp DESC")
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "logs": [{"id": r[0], "timestamp": r[1], "action": r[2]} for r in rows]
    }


# ---------------------------------------------------------------------------
# CHAT HISTORY (users can read their own sessions)
# ---------------------------------------------------------------------------

@router.get('/get-user-chat-sessions', tags=["Chat"])
def get_user_chat_sessions(user_id: int, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT session_id, MAX(timestamp) AS last_active
            FROM ai_chats
            WHERE user_id = %s
            GROUP BY session_id
            ORDER BY last_active DESC
            """,
            (user_id,)
        )
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)
    return {"chat_sessions": [{"session_id": r[0], "timestamp": r[1]} for r in rows]}


@router.get('/get-chat-history', tags=["Chat"])
def get_chat_history(session_id: str, dependencies=Depends(verify_api_key)):
    conn = db_pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT c.id, c.user_id, c.session_id, c.turn, c.role,
                   c.message, c.timestamp, c.audit_id, a.rating
            FROM ai_chats c
            LEFT JOIN audit_ai a ON c.audit_id = a.id
            WHERE c.session_id = %s
            ORDER BY c.timestamp ASC
            """,
            (session_id,)
        )
        rows = cursor.fetchall()
    finally:
        db_pool.putconn(conn)

    return {
        "chat_history": [
            {
                "id": r[0],
                "user_id": r[1],
                "session_id": r[2],
                "turn": r[3],
                "role": r[4],
                "message": r[5],
                "timestamp": r[6],
                "audit_id": r[7],
                "rating": r[8]
            }
            for r in rows
        ]
    }