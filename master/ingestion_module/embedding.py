#this is the main file that will be used to embed the documents.
#it will use the rules defined in embeddingrules.py to chunk the documents and embed them.
#it will use the metadata defined in metadata.py to embed the documents.




#imports
import hashlib
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance
from qdrant_client.http.models import PointStruct
#testing imports
import time
import os
import uuid
#CHANGE THIS TO THE CORRECT IP ADDRESS
QDRANT_IP = os.getenv("QDRANT_IP") or "http://localhost:6333"

#TODO: move this out of here


def create_embedding(file_path:str, extra_metadata:dict):
    #first we want to extract the metadata for the file
    
    #for all files the following must be extracted:
    #document_id -> hash
    #chunk_id -> provided by the chunking model
    #text -> chunking model
    #embedding -> embedding model
    #extra_metadata -> based on the flags set in embedding rules
   
   
   
   
    #timing
    start_time = time.time()
   
   
   
   
   
   
    #first lets get the hash of the file
    with open(file_path, "rb") as f:
        document_id = hashlib.sha256(f.read()).hexdigest()
    
    from languagedetect import get_file_language
    #then lets get the language of the document
    language, text = get_file_language(file_path)

    #lets get the file type
    file_type = file_path.split(".")[-1]

    #now we can get the embedding rules for the file
    from embeddingrules import setembeddingrules
    rules = setembeddingrules(language, file_type)
    
    # output for rules -> [{model : modelname}, {chunk_size : int}, {chunk_overlap : int}]
    #now that we have the rules we can chunk the file and get the metadata
    chunk_size = rules[1]["chunk_size"]
    chunk_overlap = rules[1]["chunk_overlap"]
    from chunker import chunks
    chunks = chunks(text,chunk_size,chunk_overlap,language)
    #we can now embed
    
    points = []


    model_name = rules[0]["model"]
    model = SentenceTransformer(model_name,local_files_only=False)
    texts = [chunk['text'] for chunk in chunks]
    client = QdrantClient(url=QDRANT_IP)
    embeddings = model.encode(texts)
    for i, chunk in enumerate(chunks):
        chunk_id = chunk["chunk_id"]
        text = chunk["text"]
        embedding = embeddings[i]

        # Qdrant expects a numeric ID, string ID, vector, and optional payload
        #unwrap the extra_metadata
        extra_metadata = extra_metadata
        for key, value in extra_metadata.items():
            extra_metadata[key] = value
        
        points.append(
            PointStruct(
                id=uuid.uuid4(),  # unique per chunk
                vector=embedding.tolist() if hasattr(embedding, 'tolist') else embedding,
                payload={
                    "document_id": document_id,
                    "chunk_id": chunk_id,
                    "text": text,
                    "filename": file_path.split("/")[-1],
                    **extra_metadata
                }
            )
        )

    if points:
        client.upsert(
            collection_name="documents",
            points=points,
            wait=True
        )
    end_time = time.time()
    print("finished")
    print("time taken: ", end_time - start_time)#test



if __name__ == "__main__":
    qdrant_setup()
