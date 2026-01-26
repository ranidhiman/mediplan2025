"""
rag_api.py - Flask API for RAG system
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
from llama_cpp import Llama
from sentence_transformers import SentenceTransformer
import pickle

app = Flask(__name__)
CORS(app)

print("Loading vector database...")
VECTOR_DB_PATH = Path("./vector_db.pkl")
with open(VECTOR_DB_PATH, 'rb') as file:
    VECTOR_DB = pickle.load(file)

print("Loading embedding model...")
embedding_model = SentenceTransformer("./models/embed/all-MiniLM-L6-v2")

print("Loading text generation model...")
text_gen_model = Llama(
    model_path="./models/text_gen/Llama-3.2-1B-Instruct-Q4_K_L.gguf",
    n_ctx=2048,
    n_threads=8,
    verbose=False
)

def cosine_similarity(a, b):
    dot_product = sum([x * y for x, y in zip(a, b)])
    norm_a = sum([x ** 2 for x in a]) ** 0.5
    norm_b = sum([x ** 2 for x in b]) ** 0.5
    return dot_product / (norm_a * norm_b)

def retrieve(query, top_n=3):
    query_embedding = embedding_model.encode(query)
    similarities = []
    
    for chunk, embedding in VECTOR_DB:
        similarity = cosine_similarity(query_embedding, embedding)
        similarities.append((chunk, similarity))
    
    similarities.sort(key=lambda x: x[1], reverse=True)
    return similarities[:top_n]

def query_rag(user_query):
    retrieved_knowledge = retrieve(user_query, top_n=3)
    context = "\n".join([f" - {chunk}" for chunk, _ in retrieved_knowledge])
    
    instruction_prompt = f"""You are a helpful military medical operations assistant. Use only the following pieces of context to answer the question. Don't make up any new information:

{context}"""
    
    response = text_gen_model.create_chat_completion(
        messages=[
            {"role": "system", "content": instruction_prompt},
            {"role": "user", "content": user_query},
        ],
        stream=False
    )
    
    return response["choices"][0]["message"]["content"]

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        user_message = data.get('message', '')
        
        if not user_message:
            return jsonify({'error': 'Message is required'}), 400
        
        print(f"Query: {user_message}")
        answer = query_rag(user_message)
        print(f"Response: {answer}")
        
        return jsonify({'response': answer})
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'message': 'RAG API is running'})

if __name__ == '__main__':
    print("✅ RAG API ready!")
    app.run(host='0.0.0.0', port=5002, debug=True)