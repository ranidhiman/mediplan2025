"""
rag_api.py - Flask API for RAG system with citation support
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

# Load document index for citations
print("Loading document index...")
DOC_INDEX_PATH = Path("./doc_index.pkl")
DOC_INDEX = {}
if DOC_INDEX_PATH.exists():
    with open(DOC_INDEX_PATH, 'rb') as file:
        DOC_INDEX = pickle.load(file)
    print(f"Loaded {len(DOC_INDEX)} documents in index")
else:
    print("No document index found - citations will be unavailable")

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

    for item in VECTOR_DB:
        # Handle both old format (tuple) and new format (dict)
        if isinstance(item, dict):
            chunk = item['chunk']
            embedding = item['embedding']
            doc_hash = item.get('doc_hash', 'UNKNOWN')
            doc_name = item.get('doc_name', 'Unknown Document')
        else:
            # Legacy format: (chunk, embedding)
            chunk, embedding = item
            doc_hash = 'LEGACY'
            doc_name = 'Legacy Document'

        similarity = cosine_similarity(query_embedding, embedding)
        similarities.append({
            'chunk': chunk,
            'similarity': similarity,
            'doc_hash': doc_hash,
            'doc_name': doc_name
        })

    similarities.sort(key=lambda x: x['similarity'], reverse=True)
    return similarities[:top_n]

def query_rag(user_query):
    retrieved_knowledge = retrieve(user_query, top_n=3)

    # Build context with citation markers
    context_parts = []
    citations = {}

    for item in retrieved_knowledge:
        doc_hash = item['doc_hash']
        doc_name = item['doc_name']
        chunk = item['chunk']

        # Add to citations dict (dedupe)
        if doc_hash not in citations:
            citations[doc_hash] = {
                'hash': doc_hash,
                'name': doc_name,
                'similarity': item['similarity']
            }

        context_parts.append(f"[#{doc_hash}]: {chunk}")

    context = "\n".join(context_parts)

    instruction_prompt = f"""You are a helpful military medical operations assistant. Use only the following pieces of context to answer the question. When you use information, cite it with the hash tag shown (e.g., [#ABC123]). Don't make up any new information.

Context:
{context}"""

    response = text_gen_model.create_chat_completion(
        messages=[
            {"role": "system", "content": instruction_prompt},
            {"role": "user", "content": user_query},
        ],
        stream=False
    )

    return {
        'answer': response["choices"][0]["message"]["content"],
        'citations': list(citations.values())
    }

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        user_message = data.get('message', '')

        if not user_message:
            return jsonify({'error': 'Message is required'}), 400

        print(f"Query: {user_message}")
        result = query_rag(user_message)
        print(f"Response: {result['answer']}")
        print(f"Citations: {[c['hash'] for c in result['citations']]}")

        return jsonify({
            'response': result['answer'],
            'citations': result['citations']
        })

    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/documents', methods=['GET'])
def list_documents():
    """List all indexed documents with their hashes"""
    return jsonify({
        'documents': list(DOC_INDEX.values()),
        'count': len(DOC_INDEX)
    })

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'message': 'RAG API is running',
        'documents_indexed': len(DOC_INDEX)
    })

if __name__ == '__main__':
    print("✅ RAG API ready!")
    print(f"📚 {len(DOC_INDEX)} documents indexed")
    app.run(host='0.0.0.0', port=5002, debug=True)