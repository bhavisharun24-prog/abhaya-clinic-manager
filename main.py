import os
import socket
import asyncio
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.db import init_db
from backend.backups import backup_scheduler_loop
from backend.websocket import manager
from backend.routes import router as api_router

# Define UPLOAD and static asset locations
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(CURRENT_DIR, "uploads")
FRONTEND_DIST = os.path.join(CURRENT_DIR, "frontend", "dist")

if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR, exist_ok=True)

# Application Lifespan Events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Initialize and seed SQLite database
    try:
        init_db()
    except Exception as e:
        print(f"Error initializing database: {e}")

    # 2. Launch database backups background task
    backup_task = asyncio.create_task(backup_scheduler_loop())
    
    yield
    
    # Cancel backup scheduler on shutdown
    backup_task.cancel()
    try:
        await backup_task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="Abhaya Medical Care - Clinic Management System", lifespan=lifespan)

# CORS configuration for offline local network clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve patient photo and report uploads
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Attach REST API router
app.include_router(api_router, prefix="/api")

# WebSocket Endpoint for real-time doctor -> pharmacist events
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep socket open and listen for pings
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "PING":
                    await websocket.send_json({"type": "PONG"})
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket exception: {e}")
        manager.disconnect(websocket)

# Host React production files statically (single page application support)
if os.path.exists(FRONTEND_DIST):
    # Serve built assets (js, css, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
    
    # Catch-all to serve index.html for client routing
    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        # Prevent API routes and uploads from falling back to index.html
        if full_path.startswith("api") or full_path.startswith("uploads") or full_path.startswith("ws"):
            raise HTTPException(status_code=404, detail="Not Found")
            
        index_path = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return "Frontend compiled but index.html missing."
else:
    @app.get("/")
    def read_root():
        return {
            "message": "Abhaya Medical Care Backend running successfully in Development Mode.",
            "instructions": "Run 'npm run dev' inside the 'frontend/' folder to launch the React interface."
        }

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Does not send actual data, just binds socket interface
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

if __name__ == "__main__":
    import uvicorn
    local_ip = get_local_ip()
    port = 5000
    
    print("=========================================================================")
    print("Abhaya Medical Care Server (Python/FastAPI) initiating...")
    print(f"- Access locally on Doctor PC: http://localhost:{port}")
    print(f"- Access on Pharmacist PC (LAN): http://{local_ip}:{port}")
    print(f"- WebSocket interface address: ws://{local_ip}:{port}/ws")
    print("=========================================================================")
    
    # Run Uvicorn server on port 5000, listening on all interfaces (0.0.0.0)
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
