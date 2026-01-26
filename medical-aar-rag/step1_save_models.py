"""
step1_save_models.py

Saves specified embedding and text generation model files locally.

Author: David Sluder
Date: 2025-07-11
"""

import os
from sentence_transformers import SentenceTransformer
from huggingface_hub import hf_hub_download

# Create model directories if they don't exist
current_path = os.getcwd()
directories = [
    'models',
    'models/embed',
    'models/text_gen'
]
for directory in directories:
    full_path = current_path + directory
    os.makedirs(full_path, exist_ok=True)

# Specify embedding and text generation models
embed_model_repo = "sentence-transformers/all-MiniLM-L6-v2"
text_gen_model_repo = "bartowski/Llama-3.2-1B-Instruct-GGUF"

text_gen_model_file = "Llama-3.2-1B-Instruct-Q4_K_L.gguf"

# Download embedding model
current_path = os.getcwd()
embed_model_repo = "sentence-transformers/all-MiniLM-L6-v2"
embed_model_object = SentenceTransformer(embed_model_repo)
embed_model_object.save(current_path + '/models/embed/all-MiniLM-L6-v2')

# Download text generation model
hf_hub_download(repo_id = text_gen_model_repo, filename = text_gen_model_file, local_dir = current_path + '/models/text_gen')