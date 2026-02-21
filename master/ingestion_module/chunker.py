#this file splits the files into chunks


from typing import List
import re


def split_sentences_ar(text:str) -> List[str]:
    sentences = re.split(r'[.!؟!\n…]+', text)
    return [s.strip() for s in sentences if s.strip()]

def semantic_chunks(nlp:object,text: str, chunk_size: int = 500, chunk_overlap: int = 50, language: str = "en") -> List[str]:

    if language == "en":
        doc = nlp(text)
        sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
    elif language == "ar":
        sentences = split_sentences_ar(text)

    chunks = []
    current_chunk = ""

    for sent in sentences:
        if len(current_chunk) + len(sent) + 1 > chunk_size:
            chunks.append(current_chunk.strip())
            if chunk_overlap > 0:
                # keep overlap
                current_chunk = current_chunk[-chunk_overlap:] + " " + sent
            else:
                current_chunk = sent
        else:
            current_chunk += " " + sent

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks

    

def chunks(text:str,chunk_size:int, chunk_overlap:int,language:str) -> list[dict]:
    import spacy

    # Load model once per language
    if language == "en":
        nlp = spacy.load("en_core_web_sm")
    elif language == "ar":
        nlp = None
    else:
        raise ValueError(f"Unsupported language: {language}")
    #now that we have the text we can chunk it
    raw_chunks = semantic_chunks(nlp,text, chunk_size, chunk_overlap,language)

    chunks = []
    for i, chunk in enumerate(raw_chunks):
        chunks.append({"chunk_id": i, "text": chunk})
    
    return chunks