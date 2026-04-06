from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api._lib.routers import personnel, competitions, nominations

app = FastAPI(title="FIBA Americas Nominations API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers under /api prefix to match Vercel's routing
app.include_router(personnel.router, prefix="/api")
app.include_router(competitions.router, prefix="/api")
app.include_router(nominations.router, prefix="/api")


@app.get("/api")
@app.get("/api/")
def root():
    return {"message": "FIBA Americas Nominations API"}
