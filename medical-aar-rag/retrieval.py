# rag/retrieval.py
import torch
from sentence_transformers import util

def search_and_retrieve(query: str, embedding_model, pages_and_chunks: list[dict], embeddings: torch.Tensor, top_k: int = 5) -> list[dict]:
    query_embedding = embedding_model.encode(query, convert_to_tensor=True)
    dot_scores = util.dot_score(query_embedding, embeddings)[0]
    top_results = torch.topk(dot_scores, k=top_k)
    context = []
    for score, idx in zip(top_results[0], top_results[1]):
        context.append({
            "text": pages_and_chunks[idx]["sentence_chunk"],
            "page_number": pages_and_chunks[idx]["page_number"],
            "document_name": pages_and_chunks[idx]["document_name"]
        })
    return context
