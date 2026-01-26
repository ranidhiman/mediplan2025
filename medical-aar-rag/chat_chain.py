# rag/chat_chain.py
from langchain_ollama import OllamaLLM
from langchain_core.prompts import ChatPromptTemplate

def create_chat_chain() -> any:

    template = """
Conversation History:
{history}

You have the following context:
{context}

Using the above context, please first list the key insights or reasoning steps you can extract. Then, based on these insights, answer the question below. If the context does not contain enough information to answer, say "I don't know."

Question: {question}

Chain-of-Thought:
[Your reasoning here]

Answer:
"""
    model = OllamaLLM(model="llama3", temperature=0.5)
    # can use llama3.3, llama3, llama2, tinyllama
    prompt = ChatPromptTemplate.from_template(template)
    chain = prompt | model
    return chain

def handle_conversation(chain, embedding_model, pages_and_chunks, embeddings) -> None:
    conversation_history = ""  
    print("Welcome to the AI chatbot. Type 'exit' to quit.")
    
    while True:
        user_input = input("You: ")
        if user_input.lower() == "exit":
            break
        
        from rag.retrieval import search_and_retrieve
        context = search_and_retrieve(user_input, embedding_model, pages_and_chunks, embeddings, top_k=5)
        if not context:
            print("Bot: Sorry, I couldn't find relevant information.")
            continue
        
        conversation_history += f"User: {user_input}\n"
        
        aggregated_context = "\n\n".join([c["text"] for c in context])
        
        result = chain.invoke({
            "history": conversation_history,
            "context": aggregated_context,
            "question": user_input
        })
        
        conversation_history += f"Bot: {result}\n"
        
        print("Bot:", result)
        
        print()
        
        for c in context:
            source_info = f"Source: {c['document_name']} (Page {c['page_number']})"
            print(source_info)
