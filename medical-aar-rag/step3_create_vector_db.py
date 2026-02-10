"""
step3_create_vector_db.py

Pulls in specified embedding model and iterates over all files in ./txt_docs to
split each file into smaller chunks, vectorize them via the embedding model,
and add them to a list object in memory. Saves final vector database to disk as
./vector_db.pkl

Now includes document hashing for citation tracking.

Author: David Sluder
Date: 2025-07-11
"""

from sentence_transformers import SentenceTransformer
from pathlib import Path
import pickle
import hashlib

# Generate short hash for document
def generate_doc_hash(content, length=6):
    full_hash = hashlib.sha256(content.encode()).hexdigest()
    return full_hash[:length].upper()

# Add chunk to database with source tracking
def add_chunk_to_database(chunk, doc_hash, doc_name):
    embedding = embedding_model.encode(chunk)
    vector_db.append({
        'chunk': chunk,
        'embedding': embedding,
        'doc_hash': doc_hash,
        'doc_name': doc_name
    })

# Break single string into chunks of specified size/overlap
def chunk_text_with_overlap(text, chunk_size=500, overlap=50):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

# Load embedding model
embedding_model = SentenceTransformer("./models/embed/" + "all-MiniLM-L6-v2")

# Document index: maps hash -> document info
doc_index = {}

# Break text files up into chunks with source tracking
txt_path = Path('./txt_docs')
txt_files = [f.name for f in txt_path.iterdir() if f.is_file()]

vector_db = []
total_chunks = 0

for txt_file in txt_files:
    with open((txt_path / txt_file), 'r', encoding='utf-8', errors='replace') as file:
        content = file.read()

    # Generate hash for this document
    doc_hash = generate_doc_hash(content)
    doc_name = txt_file.replace('.txt', '')

    # Store in document index
    doc_index[doc_hash] = {
        'name': doc_name,
        'file': txt_file,
        'hash': doc_hash
    }

    print(f"Processing: {doc_name} [#{doc_hash}]")

    # Chunk and add to database
    chunks = chunk_text_with_overlap(content)
    for chunk in chunks:
        add_chunk_to_database(chunk, doc_hash, doc_name)
        total_chunks += 1

print(f"\nTotal: {total_chunks} chunks from {len(txt_files)} documents")

# Save vector database
vector_db_path = Path("./vector_db.pkl")
with open(vector_db_path, 'wb') as file:
    pickle.dump(vector_db, file)

# Save document index
doc_index_path = Path("./doc_index.pkl")
with open(doc_index_path, 'wb') as file:
    pickle.dump(doc_index, file)

print(f"\nDocument Index:")
for hash_id, info in doc_index.items():
    print(f"  #{hash_id}: {info['name']}")