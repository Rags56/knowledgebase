SETUP STEPS:
1. GO into metadata.py and set the booleans based on what the client wants.
2. GO into embeddingrules.py and set the chunk size and overlap based on research/client file types
3. docker compose the qdrant container
4. change the ip address in embedding.py to the correct ip address
sentence-transformers/all-MiniLM-L6-v2
sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2

#docker compose up -d --build
#docker qdrant