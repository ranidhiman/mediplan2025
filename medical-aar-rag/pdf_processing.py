# rag/pdf_processing.py
import os
import glob
import fitz  # PyMuPDF
from tqdm import tqdm
from spacy.lang.en import English

def text_formatter(text: str) -> str:
    return text.replace("\n", " ").strip()

def open_and_read_pdf(pdf_path: str) -> list[dict]:
    doc = fitz.open(pdf_path)
    pages_and_texts = []
    for page_number, page in tqdm(enumerate(doc), desc=f"Reading {os.path.basename(pdf_path)}"):
        text = page.get_text()
        text = text_formatter(text)
        pages_and_texts.append({
            "document_name": os.path.basename(pdf_path),
            "page_number": page_number,
            "page_char_count": len(text),
            "page_word_count": len(text.split()),
            "page_sentence_count_raw": len(text.split(". ")),
            "page_token_count": len(text) / 4,
            "text": text
        })
    return pages_and_texts

def load_all_pdfs_from_folder(folder_path: str) -> list[dict]:
    pdf_paths = glob.glob(os.path.join(folder_path, "*.pdf"))
    if not pdf_paths:
        raise FileNotFoundError(f"No PDF files found in {folder_path}.")
    all_pages = []
    for pdf_path in pdf_paths:
        print(f"Processing {pdf_path}...")
        pages = open_and_read_pdf(pdf_path)
        all_pages.extend(pages)
    return all_pages

def initialize_spacy() -> English:
    nlp = English()
    nlp.add_pipe("sentencizer")
    test_doc = nlp("This is a sentence. This another sentence.")
    if len(list(test_doc.sents)) < 2:
        raise RuntimeError("Sentencizer is not working properly.")
    return nlp

def split_list(input_list: list, slice_size: int) -> list:
    return [input_list[i:i + slice_size] for i in range(0, len(input_list), slice_size)]

def process_pages_and_chunks(pages_and_texts: list[dict], nlp, chunk_size: int = 10) -> list[dict]:

    for item in tqdm(pages_and_texts, desc="Processing pages"):
        sentences = list(nlp(item["text"]).sents)
        sentences = [str(sentence) for sentence in sentences]
        item["sentences"] = sentences
        item["page_sentence_count_spacy"] = len(sentences)
        item["sentence_chunks"] = split_list(sentences, chunk_size)
        item["num_chunks"] = len(item["sentence_chunks"])

    pages_and_chunks = []
    for item in tqdm(pages_and_texts, desc="Building chunks"):
        for sentence_chunk in item["sentence_chunks"]:
            joined_chunk = " ".join(sentence_chunk).replace("  ", " ").strip()
            chunk_dict = {
                "document_name": item["document_name"],
                "page_number": item["page_number"],
                "sentence_chunk": joined_chunk,
                "chunk_char_count": len(joined_chunk),
                "chunk_word_count": len(joined_chunk.split()),
                "chunk_token_count": len(joined_chunk) / 4
            }
            pages_and_chunks.append(chunk_dict)
    return pages_and_chunks
