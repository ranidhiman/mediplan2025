"""
step3_create_vector_db.py

Pulls in specified embedding model and iterates over all files in ./txt_docs to
split each file into smaller chunks, vectorize them via the embedding model,
and add them to a list object in memory. Saves final vector database to disk as
./vector_db.pkl

Author: David Sluder
Date: 2025-07-11
"""

from sentence_transformers import SentenceTransformer
from pathlib import Path
import pickle

# Add chunk to database
# Requires vector_db and embedding_model as global variables
def add_chunk_to_database(chunk):
  embedding = embedding_model.encode(chunk)
  vector_db.append((chunk, embedding))

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

# Break text files up into chunks
txt_chunks = []
txt_path = Path('./txt_docs')
txt_files = [f.name for f in txt_path.iterdir() if f.is_file()]
for txt_file in txt_files:
  with open((txt_path / txt_file), 'r', encoding='utf-8', errors='replace') as file:
    txt_line = file.read()
  chunked_lines = chunk_text_with_overlap(txt_line)
  txt_chunks.extend(chunked_lines)

# Add each individual chunk to vector database
vector_db = []
for i, chunk in enumerate(txt_chunks):
  add_chunk_to_database(chunk)
  if i % 100 == 0:
    print(f'Added chunk {i+1}/{len(txt_chunks)} to the database object')

# Save vector database as binary file
vector_db_path = Path("./vector_db.pkl")
with open(vector_db_path, 'wb') as file:
    pickle.dump(vector_db, file)