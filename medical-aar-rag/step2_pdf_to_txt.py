"""
step2_pdf_to_txt.py

Converts PDF files to text, cleans the text, then saves them at .txt files.

Author: David Sluder
Date: 2025-07-11
"""

from pathlib import Path
import sys, pathlib, pymupdf, re

def clean_pdf_text(text, replace_newlines=True):
    """
    Clean and format text extracted from PDF.
    
    Args:
        text (str): Raw text extracted from PDF
        replace_newlines (bool): If True, replaces newlines with spaces in final output
        
    Returns:
        str: Cleaned and formatted text
    """
    # Replace form feed characters
    text = text.replace(chr(12), '\n')
    
    # Fix multiple consecutive newlines and spaces
    text = re.sub(r'\n\s*\n', '\n\n', text)
    text = re.sub(r' +', ' ', text)
    
    # Clean up whitespace around newlines
    text = re.sub(r'\s*\n\s*', '\n', text)

    # Remove punctuation that repeats (e.g., ...........)
    text = re.sub(r'([^a-zA-Z0-9])\1+', r'\1', text)
    
    # Remove leading/trailing whitespace from each line
    lines = [line.strip() for line in text.split('\n')]
    
    # Remove empty lines while preserving paragraph breaks
    cleaned_lines = []
    prev_empty = False
    
    for line in lines:
        if line:
            cleaned_lines.append(line)
            prev_empty = False
        elif not prev_empty:
            cleaned_lines.append('')
            prev_empty = True
    
    # Join lines back together
    cleaned_text = '\n'.join(cleaned_lines)
    
    # Remove leading/trailing whitespace from final text
    cleaned_text = cleaned_text.strip()
    
    # Replace newlines with spaces if requested
    if replace_newlines:
        cleaned_text = cleaned_text.replace('\n', ' ')
        # Clean up any double spaces that might have been created
        cleaned_text = re.sub(r' +', ' ', cleaned_text)
    
    return cleaned_text

# Get all files to convert to text
pdf_path = Path('./pdf_docs')
pdf_files = [f.name for f in pdf_path.iterdir() if f.is_file()]

# Set destination file path
txt_path = Path('./txt_docs')
# Create directory if it doesn't exist
txt_path.mkdir(parents=True, exist_ok=True)

# Iterate over PDF files
for pdf_file in pdf_files:
    with pymupdf.open(pdf_path / pdf_file) as pdf_doc:
        text = chr(12).join([page.get_text() for page in pdf_doc])
        clean_text = clean_pdf_text(text = text, replace_newlines=True)
    # Save text file
    pathlib.Path(txt_path / pdf_file).with_suffix('.txt').write_bytes(clean_text.encode())