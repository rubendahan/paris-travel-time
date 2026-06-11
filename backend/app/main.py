import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse

from app import config
from app.api.routes import router
from app.core.csa import query_one_to_all
from app.core.network import load_network
from app.core.walkgrid import load_walkmask


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.network = load_network(config.DATA_DIR)
    app.state.network.walkmask = load_walkmask()
    wm = app.state.network.walkmask
    print(f"walkmask: {'%dx%d cells' % (wm.w, wm.h) if wm else 'absent (crow-fly walking)'}")
    t0 = time.perf_counter()
    # warm numba JIT (both kernels) so the first user query isn't 1-2s slower
    query_one_to_all(app.state.network, [(48.8566, 2.3522)], 8 * 3600, 15)
    query_one_to_all(app.state.network, [(48.8566, 2.3522)], 8 * 3600, 15, direction="arrive")
    print(f"JIT warm-up: {time.perf_counter() - t0:.1f}s")
    yield


app = FastAPI(title="Paris Travel Time", lifespan=lifespan, default_response_class=ORJSONResponse)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(router)
