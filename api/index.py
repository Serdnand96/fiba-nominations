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

app.include_router(personnel.router)
app.include_router(competitions.router)
app.include_router(nominations.router)


@app.get("/")
def root():
    return {"message": "FIBA Americas Nominations API"}
