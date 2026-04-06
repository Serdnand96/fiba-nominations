"""
Local development server.
Run from the project root:
    python -m uvicorn api.index:app --reload --port 8000
"""

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.index:app", host="0.0.0.0", port=8000, reload=True)
