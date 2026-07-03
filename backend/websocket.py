from fastapi import WebSocket
from typing import List
import json

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, type: str, data: dict):
        payload = {
            "type": type,
            "data": data
        }
        # Send json to all active connections
        disconnected_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
            except Exception as e:
                print(f"Error sending message to client: {e}")
                disconnected_connections.append(connection)

        # Cleanup failed connections
        for conn in disconnected_connections:
            self.disconnect(conn)

manager = ConnectionManager()
