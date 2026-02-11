def setembeddingrules(language: str, file_type: str) -> list:
    rules = []

    if language == "en":
        # define the embedding model
        rules.append({"model": "sentence-transformers/all-MiniLM-L6-v2"})

        if file_type == "pdf":
            rules.append({"chunk_size": 1000, "chunk_overlap": 200})
        if file_type == "docx":
            rules.append({"chunk_size": 1200, "chunk_overlap": 150})
        if file_type == "pptx":
            rules.append({"chunk_size": 500, "chunk_overlap": 80})
        

    if language == "ar":
        # define the embedding model
        rules.append({"model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"})

        if file_type == "pdf":
            rules.append({"chunk_size": 900, "chunk_overlap": 230})
        if file_type == "docx":
            rules.append({"chunk_size": 1100, "chunk_overlap": 170})
        if file_type == "pptx":
            rules.append({"chunk_size": 450, "chunk_overlap": 92})

    return rules
