from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from api._lib.routers import personnel, competitions, nominations

app = FastAPI(title="FIBA Americas Nominations API", root_path="/api")

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


# Vercel serverless handler
handler = Mangum(app, lifespan="off")
