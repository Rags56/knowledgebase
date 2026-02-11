import psycopg2
from fastapi import APIRouter, FastAPI
import requests
import psycopg2
from psycopg2 import OperationalError


router = APIRouter()
#TODO: switch all ips to env variables
from main import QDRANT_IP, postgres_ip

#general status
@router.get('/')
def health():
    return {'status': 'ok'}

#vector database health (QDRANT)
@router.get('/health/vector')
def vector_health():
    try:
        #curl qdrant ip
        response = requests.get(QDRANT_IP)
        if response.status_code == 200:
            return {'status': 'ok'}
        else:
            return {'status': 'error'}
    except Exception as e:
        return {'status': 'error'}
    
#get postgres health
@router.get('/health/db')
def db_health():
    try:
        conn = psycopg2.connect(
            host=postgres_ip.split("//")[1].split(":")[0], #take only the first part of the ip - http
            port=int(postgres_ip.split(":")[-1]), #take only the second part of the ip
            user="root",
            password="blockexe123",
            database="knowledge_base"
        )
        conn.close()
        return {'status': 'ok'}
    except OperationalError:
        return {'status': 'error'}
    except Exception as e:
        return {'status': 'error'}

