"""
step4_cli_chatbot.py

Allows someone to interact with a RAG-LLM via command line.

Loads vector db, embedding model, and text generation model. Specifies 
similarity function and chunk count. Creates prompt using user input,
similar chunks, and additional instructions. Passes text generation model
response back to user.

Author: David Sluder
Date: 2025-07-11
"""

print("Loading libraries.")
from pathlib import Path
from llama_cpp import Llama
from sentence_transformers import SentenceTransformer
import pickle 
import pandas as pd
import spacy
from PyPDF2 import PdfReader
from statistics import mode, StatisticsError
from dateparser import parse
import re

# Import vector database
print("Loading vector database.")
VECTOR_DB_PATH = Path("./vector_db.pkl")
with open(VECTOR_DB_PATH, 'rb') as file:
    VECTOR_DB = pickle.load(file)

nlp = spacy.load("en_core_web_sm")


# Define similarity function
def cosine_similarity(a, b):
  dot_product = sum([x * y for x, y in zip(a, b)])
  norm_a = sum([x ** 2 for x in a]) ** 0.5
  norm_b = sum([x ** 2 for x in b]) ** 0.5
  return dot_product / (norm_a * norm_b)

# Define function to calculate similarity and pull back most similar chunks
def retrieve(query, top_n=3):
  # Create embedding for user prompt
  query_embedding = embedding_model.encode(query)
  # Temporary list to store (chunk, similarity) pairs
  similarities = []
  # Iterate over embeddings in vector database and calc similarity
  for chunk, embedding in VECTOR_DB:
    similarity = cosine_similarity(query_embedding, embedding)
    similarities.append((chunk, similarity))
  # Sort by similarity in descending order
  similarities.sort(key=lambda x: x[1], reverse=True)
  # Return the top N most relevant chunks
  return similarities[:top_n]

# Load the models
print("Loading embedding model.")
embedding_model = SentenceTransformer("./models/embed/" + "all-MiniLM-L6-v2")
print("Loading text generation model.")
text_gen_model = Llama(
    model_path="./models/text_gen/Llama-3.2-1B-Instruct-Q4_K_L.gguf",
    n_ctx=2048,
    n_threads=8,
    verbose=False
)

def clean_text(text):
    """Clean text for consistent NLP processing."""
    text = re.sub(r'\s+', ' ', text)  # normalize whitespace
    text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)  # remove control chars
    return text.strip()

def extract_entities(text):
    hospital_keywords = re.compile(r'\b(hospital|clinic|medical center|health center|medical centre|infirmary)\b', re.IGNORECASE)
    """Extract standardized dates and hospital mentions."""
    text = clean_text(text)
    doc = nlp(text)

    # --- Dates (NER + regex fallback) ---
    date_pattern = r'\b(?:\d{1,2}[-/ ]?\w{3,9}[-/ ]?\d{2,4}|\w{3,9}\s+\d{1,2},?\s+\d{4})\b'
    regex_dates = re.findall(date_pattern, text)
    dates = list({ent.text for ent in doc.ents if ent.label_ == "DATE"} | set(regex_dates))

    # --- Hospitals (ORG/FAC with hospital keywords) ---
    hospitals = [
    ent.text for ent in doc.ents
    if ent.label_ in ["ORG", "FAC"] and hospital_keywords.search(ent.text)
    ]

    # --- Standardize and find mode date ---
    from dateutil import parser
    parsed_dates = []
    for d in dates:
        try:
            parsed = parser.parse(d, fuzzy=True)
            parsed_dates.append(parsed.date().isoformat())
        except Exception:
            continue

    try:
        mode_date = mode(parsed_dates)
    except StatisticsError:
        mode_date = None

    return parsed_dates, mode_date, hospitals


def main():

    txt_path = Path('./txt_docs')
    txt_files = list(txt_path.glob("*.txt"))

    my_df = pd.DataFrame(columns=["filename", "summary", "mode_date", "hospitals"])



    for txt_file in txt_files:

        with open(txt_file, "r", encoding="utf-8", errors="replace") as file:
            text = file.read()


        retrieved_knowledge = [(text, 1.0)]  # adjust if you’re using real retrieval
        context = "\n".join([f" - {chunk}" for chunk, _ in retrieved_knowledge])
        instruction_prompt = f"""You are a helpful chatbot. Use only the following pieces of context to answer the question. Don't make up any new information:
        {context}"""


        response = text_gen_model.create_chat_completion(
            messages=[
            {"role": "system", "content": instruction_prompt},
            {"role": "user", "content": "Summarize this document:"},
            ],
            stream=False
        )
        summary_text = response["choices"][0]["message"]["content"]


        parsed_dates, mode_date, hospitals = extract_entities(text)

        my_df.loc[len(my_df)] = {
        "filename": txt_file.name,
        "summary": summary_text,
        "mode_date": mode_date,
        "hospitals": hospitals
        }

    my_df.to_csv("results.csv", index=False)
    print("✅ Done! Results saved to results.csv")

if __name__ == "__main__":
    main()