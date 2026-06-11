import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

WALK_SPEED_M_PER_MIN = 80.0
MAX_SOURCE_WALK_M = 1000.0
MAX_TRAVEL_MINS = 100
INTERCHANGE_BUFFER_S = 60

# Footpath generation (ingestion)
FOOTPATH_RADIUS_M = 200.0
FOOTPATH_MAX_DEGREE = 10
FOOTPATH_MIN_DUR_S = 60
SAME_PARENT_TRANSFER_S = 180
DEFAULT_TRANSFER_S = 120

CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
