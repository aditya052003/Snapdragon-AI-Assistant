from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import requests
import fitz  # PyMuPDF

app = FastAPI(
    title="Snapdragon AI Assistant",
    description="Local AI assistant powered by Ollama",
    version="1.0.0"
)

# Allow requests from the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ollama configuration
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.2:1b"


# Request models
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


class CodeRequest(BaseModel):
    message: str


# Generate a response using Ollama
def generate_response(prompt: str) -> str:
    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False
            },
            timeout=180
        )

        response.raise_for_status()
        data = response.json()

        return data.get("response", "").strip()

    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Cannot connect to Ollama. Make sure Ollama is running."
        )

    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=504,
            detail="The AI model took too long to respond. Please try again."
        )

    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=500,
            detail=f"Ollama error: {str(e)}"
        )


# Home endpoint
@app.get("/")
def home():
    return {
        "message": "Snapdragon AI Assistant Backend is running!",
        "model": MODEL,
        "status": "online"
    }


# Health check
@app.get("/health")
def health():
    try:
        response = requests.get(
            "http://localhost:11434/api/tags",
            timeout=5
        )
        response.raise_for_status()

        return {
            "status": "healthy",
            "ollama": "connected",
            "model": MODEL
        }

    except requests.exceptions.RequestException:
        return {
            "status": "error",
            "ollama": "not connected",
            "model": MODEL
        }


# 1. AI Chat with conversation history
@app.post("/api/chat")
def chat(request: ChatRequest):
    user_message = request.message.strip()

    if not user_message:
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty."
        )

    # Keep only the last 10 valid conversation messages
    conversation = []

    for item in request.history[-10:]:
        if item.role in ("user", "assistant"):
            conversation.append(
                f"{item.role.capitalize()}: {item.content}"
            )

    history_text = "\n".join(conversation)

    prompt = f"""You are Snapdragon AI Assistant, a helpful and friendly AI assistant.
Answer clearly and accurately. Use simple language when possible.

Previous conversation:
{history_text if history_text else "No previous conversation."}

User: {user_message}

Assistant:"""

    answer = generate_response(prompt)

    return {
        "reply": answer
    }


# 2. PDF Summarizer
@app.post("/api/summarize")
async def summarize_pdf(file: UploadFile = File(...)):
    # Check file type
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF file."
        )

    # Read uploaded file
    contents = await file.read()

    # Limit PDF size to 10 MB
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="PDF file is too large. Maximum size is 10 MB."
        )

    if not contents:
        raise HTTPException(
            status_code=400,
            detail="The uploaded PDF is empty."
        )

    try:
        # Extract text from PDF
        pdf_document = fitz.open(
            stream=contents,
            filetype="pdf"
        )

        extracted_text = ""

        for page in pdf_document:
            extracted_text += page.get_text() + "\n"

        pdf_document.close()

        if not extracted_text.strip():
            raise HTTPException(
                status_code=400,
                detail="No readable text found. The PDF may contain scanned images."
            )

        # Limit text sent to the AI model
        extracted_text = extracted_text[:12000]

        prompt = f"""You are an expert document summarizer.

Summarize the following PDF in clear and simple language.

Include:
1. Main topic
2. Important points
3. Key findings
4. Important conclusions

Use headings and bullet points where appropriate.
Do not invent information that is not in the document.

PDF content:
{extracted_text}

Summary:"""

        summary = generate_response(prompt)

        return {
            "filename": file.filename,
            "summary": summary
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process PDF: {str(e)}"
        )


# 3. Code Assistant
@app.post("/api/code")
def code_assistant(request: CodeRequest):
    user_message = request.message.strip()

    if not user_message:
        raise HTTPException(
            status_code=400,
            detail="Please enter a coding question."
        )

    prompt = f"""You are an expert programming assistant.

Help the user with programming questions.
Explain code in simple language.
When asked to write code, provide complete and working code.
When debugging, identify the error and explain how to fix it.
Use code blocks for code.

User's coding question:
{user_message}

Answer:"""

    answer = generate_response(prompt)

    return {
        "reply": answer
    }